import { ApiError, binding, config, json, record, type tenant } from "./server";
import {
  GmailClient,
  headerValue,
  hasAttachmentOrUncertainty,
  createOAuthTransaction,
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  refreshGoogleToken,
  revokeGoogleToken,
  encryptTokens,
  decryptTokens,
  type GmailMessage,
  type GoogleTokens,
} from "@/packages/integrations";
import { classify, senderAddress, type MessageMetadata } from "@/packages/core";
import { z } from "zod";
type Tenant = Awaited<ReturnType<typeof tenant>>;
function oauthConfig(req: Request) {
  const clientId = config("GOOGLE_CLIENT_ID"),
    clientSecret = config("GOOGLE_CLIENT_SECRET"),
    key = config("TOKEN_ENCRYPTION_KEY"),
    redirectUri =
      config("GOOGLE_REDIRECT_URI") ??
      `${new URL(req.url).origin}/api/oauth/callback`;
  if (!clientId || !clientSecret || !key)
    throw new ApiError(
      503,
      "Gmail connection is not configured yet. Demo Mode is ready to use.",
    );
  return { clientId, clientSecret, key, redirectUri };
}
export async function clientFor(t: Tenant, req: Request) {
  const c = oauthConfig(req),
    db = binding();
  const initial = await db
    .prepare("SELECT email FROM credentials WHERE tenant=?")
    .bind(t.id)
    .first<{ email: string }>();
  if (!initial) throw new ApiError(409, "Connect Gmail first.");
  const pinnedEmail = initial.email;
  return new GmailClient({
    accessToken: async () => {
      const row = await db
        .prepare(
          "SELECT encrypted,updated,email FROM credentials WHERE tenant=?",
        )
        .bind(t.id)
        .first<{ encrypted: string; updated: number; email: string }>();
      if (!row || row.email !== pinnedEmail)
        throw new ApiError(
          409,
          "Gmail account changed. Stop and review a fresh plan.",
        );
      let tokens = await decryptTokens(row.encrypted, c.key, t.id);
      if (row.updated + tokens.expires_in * 1000 < Date.now() + 60000) {
        if (!tokens.refresh_token)
          throw new ApiError(401, "Reconnect Gmail to renew access.");
        const next = await refreshGoogleToken({
          ...c,
          refreshToken: tokens.refresh_token,
        });
        tokens = {
          ...next,
          refresh_token: next.refresh_token ?? tokens.refresh_token,
        };
        const refreshed = await db
          .prepare(
            "UPDATE credentials SET encrypted=?,updated=? WHERE tenant=? AND email=? AND encrypted=?",
          )
          .bind(
            await encryptTokens(tokens, c.key, t.id),
            Date.now(),
            t.id,
            pinnedEmail,
            row.encrypted,
          )
          .run();
        if (!refreshed.meta.changes)
          throw new ApiError(
            409,
            "Gmail connection changed during refresh. Review a fresh plan.",
          );
      }
      return tokens.access_token;
    },
  });
}
export function metadata(m: GmailMessage): MessageMetadata {
  return {
    id: m.id,
    threadId: m.threadId ?? m.id,
    sender: senderAddress(headerValue(m, "From")),
    subject: headerValue(m, "Subject"),
    labels: m.labelIds ?? [],
    date: Number(m.internalDate),
    size: m.sizeEstimate ?? 0,
    listId: headerValue(m, "List-ID") || undefined,
    unsubscribe: headerValue(m, "List-Unsubscribe") || undefined,
    replied: !!headerValue(m, "In-Reply-To") || !!headerValue(m, "References"),
    attachment: hasAttachmentOrUncertainty(m),
  };
}
export async function gmailRoute(req: Request, path: string, t: Tenant) {
  const db = binding();
  if (path === "oauth/start" && req.method === "GET") {
    const c = oauthConfig(req),
      transaction = await createOAuthTransaction();
    await db
      .prepare(
        "INSERT INTO oauth_transactions(state,tenant,verifier,expires) VALUES(?,?,?,?)",
      )
      .bind(
        transaction.state,
        t.id,
        transaction.verifier,
        transaction.expiresAt,
      )
      .run();
    return Response.redirect(
      buildGoogleAuthorizationUrl({ ...c, transaction, scope: "modify" }),
      302,
    );
  }
  if (path === "oauth/callback" && req.method === "GET") {
    const url = new URL(req.url),
      returnedState = url.searchParams.get("state") ?? "",
      code = url.searchParams.get("code") ?? "";
    if (url.searchParams.has("error"))
      return Response.redirect(
        `${url.origin}/?view=settings&gmail=declined`,
        302,
      );
    const transaction = await db
      .prepare(
        "DELETE FROM oauth_transactions WHERE state=? AND tenant=? AND expires>? RETURNING verifier,expires",
      )
      .bind(returnedState, t.id, Date.now())
      .first<{ verifier: string; expires: number }>();
    if (!transaction || !code)
      throw new ApiError(
        400,
        "The Gmail connection expired. Please start again.",
      );
    const c = oauthConfig(req);
    const tokens = await exchangeGoogleCode({
      ...c,
      code,
      returnedState,
      transaction: {
        state: returnedState,
        verifier: transaction.verifier,
        challenge: "",
        expiresAt: transaction.expires,
      },
    });
    if (
      !tokens.scope
        ?.split(" ")
        .includes("https://www.googleapis.com/auth/gmail.modify")
    )
      throw new ApiError(403, "The required Gmail permission was not granted.");
    const gmail = new GmailClient({ accessToken: tokens.access_token });
    const profile = await gmail.getProfile();
    const existing = await db
      .prepare("SELECT encrypted,email FROM credentials WHERE tenant=?")
      .bind(t.id)
      .first<{ encrypted: string; email: string }>();
    let stored: GoogleTokens = tokens;
    if (!tokens.refresh_token && existing?.email === profile.emailAddress) {
      const old = await decryptTokens(existing.encrypted, c.key, t.id);
      stored = { ...tokens, refresh_token: old.refresh_token };
    }
    if (!stored.refresh_token)
      throw new ApiError(
        409,
        "Google did not return offline access. Revoke this app in your Google account and reconnect.",
      );
    await db.batch([
      ...(existing && existing.email !== profile.emailAddress
        ? ["messages", "mail_groups", "plans", "actions", "jobs"].map((table) =>
            db
              .prepare(
                `DELETE FROM ${table} WHERE tenant=? ${table === "messages" ? "" : "AND source='gmail'"}`,
              )
              .bind(t.id),
          )
        : []),
      db
        .prepare(
          "INSERT INTO credentials(tenant,encrypted,email,updated) VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET encrypted=excluded.encrypted,email=excluded.email,updated=excluded.updated",
        )
        .bind(
          t.id,
          await encryptTokens(stored, c.key, t.id),
          profile.emailAddress,
          Date.now(),
        ),
      db
        .prepare("UPDATE tenants SET settings=? WHERE id=?")
        .bind(JSON.stringify({ ...t.settings, source: "gmail" }), t.id),
    ]);
    await record(t.id, "gmail", "connected", {
      message: "Gmail connected. Scanning reads metadata only.",
    });
    return Response.redirect(`${url.origin}/?view=report&gmail=connected`, 302);
  }
  if (req.method !== "POST")
    throw new ApiError(404, "Gmail action unavailable.");
  const body = await req.json();
  if (path === "gmail/disconnect") {
    const c = oauthConfig(req),
      row = await db
        .prepare("SELECT encrypted FROM credentials WHERE tenant=?")
        .bind(t.id)
        .first<{ encrypted: string }>();
    let revocationConfirmed = true;
    if (row) {
      try {
        const tokens = await decryptTokens(row.encrypted, c.key, t.id);
        await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
      } catch {
        revocationConfirmed = false;
      }
    }
    await db.batch([
      db.prepare("DELETE FROM credentials WHERE tenant=?").bind(t.id),
      db.prepare("DELETE FROM oauth_transactions WHERE tenant=?").bind(t.id),
      db
        .prepare("UPDATE tenants SET settings=? WHERE id=?")
        .bind(
          JSON.stringify({ ...t.settings, source: "demo", autopilot: "off" }),
          t.id,
        ),
      db
        .prepare(
          `UPDATE jobs SET status='cancelled',lease=0 WHERE tenant=? AND source='gmail'`,
        )
        .bind(t.id),
      db
        .prepare(
          `UPDATE plans SET status='cancelled' WHERE tenant=? AND source='gmail' AND status!='executed'`,
        )
        .bind(t.id),
    ]);
    await record(t.id, "gmail", "disconnected", {
      message:
        "Local Gmail access removed. Stored analysis can be deleted in Data & Privacy.",
    });
    return json({
      disconnected: true,
      revocationConfirmed,
      manualRevokeUrl: revocationConfirmed
        ? null
        : "https://myaccount.google.com/connections",
    });
  }
  if (path === "gmail/scan") {
    const gmail = await clientFor(t, req);
    let job = await db
      .prepare(
        `SELECT * FROM jobs WHERE tenant=? AND source='gmail' AND status IN ('running','interrupted') ORDER BY updated DESC LIMIT 1`,
      )
      .bind(t.id)
      .first<{
        id: string;
        cursor: string | null;
        processed: number;
        lease: number;
      }>();
    if (!job) {
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO jobs(id,tenant,source,cursor,processed,status,updated,lease) VALUES(?,?,'gmail',NULL,0,'running',?,0)`,
        )
        .bind(id, t.id, Date.now())
        .run();
      job = { id, cursor: null, processed: 0, lease: 0 };
    }
    const claim = await db
      .prepare(
        "UPDATE jobs SET lease=?,status=? WHERE id=? AND tenant=? AND lease<?",
      )
      .bind(Date.now() + 120000, "running", job.id, t.id, Date.now())
      .run();
    if (!claim.meta.changes)
      throw new ApiError(
        409,
        "A scan is already processing. Try again shortly.",
      );
    try {
      const page = await gmail.listMessages({
        pageToken: job.cursor ?? undefined,
        maxResults: 25,
      });
      const messages: MessageMetadata[] = [];
      for (const row of page.messages ?? [])
        messages.push(metadata(await gmail.getSafetyMessage(row.id)));
      await db.batch(
        messages.map((m) =>
          db
            .prepare(
              "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,classification=excluded.classification,updated=excluded.updated",
            )
            .bind(
              `${t.id}:${m.id}`,
              t.id,
              m.id,
              JSON.stringify(m),
              JSON.stringify(classify(m, t.settings.protectedSenders)),
              Date.now(),
            ),
        ),
      );
      const total = await db
        .prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?")
        .bind(t.id)
        .first<{ n: number }>();
      await db
        .prepare(
          "UPDATE jobs SET cursor=?,processed=?,status=?,updated=?,lease=0 WHERE id=? AND tenant=?",
        )
        .bind(
          page.nextPageToken ?? null,
          total?.n ?? 0,
          page.nextPageToken ? "running" : "complete",
          Date.now(),
          job.id,
          t.id,
        )
        .run();
      await refreshGroups(t);
      return json({
        processed: total?.n ?? 0,
        complete: !page.nextPageToken,
        jobId: job.id,
      });
    } catch (e) {
      await db
        .prepare("UPDATE jobs SET status=?,lease=0 WHERE id=? AND tenant=?")
        .bind("interrupted", job.id, t.id)
        .run();
      throw e;
    }
  }
  if (path === "gmail/preview") {
    const input = z
      .object({
        ids: z.array(z.string().min(1).max(300)).min(1).max(50),
        action: z.enum(["trash", "archive"]).default("trash"),
      })
      .strict()
      .parse(body);
    const rows = await db
      .prepare(
        `SELECT gmail_id,metadata FROM messages WHERE tenant=? AND id IN (${input.ids.map(() => "?").join(",")}) LIMIT 50`,
      )
      .bind(t.id, ...input.ids)
      .all<{ gmail_id: string; metadata: string }>();
    const candidates = rows.results
      .map((r) => ({
        id: r.gmail_id,
        metadata: JSON.parse(r.metadata) as MessageMetadata,
      }))
      .filter(
        (m) =>
          classify(m.metadata, t.settings.protectedSenders).action === "TRASH",
      );
    if (!candidates.length)
      throw new ApiError(409, "No safe message candidates matched.");
    const planId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        planId,
        t.id,
        "gmail",
        JSON.stringify({ messages: candidates, action: input.action }),
        "pending",
        Date.now(),
        Date.now() + 900000,
      )
      .run();
    return json({
      id: planId,
      total: candidates.length,
      messages: candidates.map((m) => ({
        id: m.id,
        subject: m.metadata.subject,
      })),
      action: input.action,
    });
  }
  if (path === "gmail/execute") {
    const input = z
      .object({ planId: z.string(), approved: z.literal(true) })
      .strict()
      .parse(body);
    const plan = await db
      .prepare(`SELECT * FROM plans WHERE id=? AND tenant=? AND source='gmail'`)
      .bind(input.planId, t.id)
      .first<{ status: string; data: string; expires: number }>();
    if (!plan || plan.expires < Date.now())
      throw new ApiError(409, "Plan expired. Review a fresh plan.");
    if (plan.status === "executed") return json({ duplicate: true });
    const readyClient = await clientFor(t, req);
    const lock = await db
      .prepare(
        `UPDATE plans SET status='executing' WHERE id=? AND tenant=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM plans busy WHERE busy.tenant=? AND busy.source='gmail' AND busy.status='executing') AND NOT EXISTS(SELECT 1 FROM actions WHERE actions.tenant=plans.tenant AND status='restoring')`,
      )
      .bind(input.planId, t.id, t.id)
      .run();
    if (!lock.meta.changes)
      throw new ApiError(
        409,
        "This cleanup is already running or needs manual recovery.",
      );
    const gmail = readyClient,
      data = JSON.parse(plan.data) as {
        messages: { id: string; metadata: MessageMetadata }[];
        action: "trash" | "archive";
      };
    let done = 0,
      skipped = 0,
      failed = 0;
    for (const m of data.messages) {
      const actionId = `${input.planId}:${m.id}`;
      await db
        .prepare(
          "INSERT OR IGNORE INTO actions(id,tenant,source,plan_id,kind,data,created,status) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          actionId,
          t.id,
          "gmail",
          input.planId,
          data.action,
          JSON.stringify({ gmailId: m.id, originalLabels: m.metadata.labels }),
          Date.now(),
          "pending",
        )
        .run();
      try {
        if (plan.expires < Date.now())
          throw new ApiError(409, "Cleanup approval expired.");
        const current = metadata(await gmail.getSafetyMessage(m.id));
        const prefs = await db
          .prepare("SELECT settings FROM tenants WHERE id=? AND deleted=0")
          .bind(t.id)
          .first<{ settings: string }>();
        if (!prefs) throw new Error("Account no longer active");
        const protectedSenders = JSON.parse(prefs.settings).protectedSenders;
        const thread = await gmail.getThread(current.threadId);
        const hasReply =
          !thread.messages?.length ||
          thread.id !== current.threadId ||
          thread.messages.some((x) => x.labelIds?.includes("SENT"));
        if (
          hasReply ||
          classify(current, protectedSenders).action !== "TRASH" ||
          JSON.stringify(current) !== JSON.stringify(m.metadata)
        ) {
          skipped++;
          await db
            .prepare("UPDATE actions SET status=? WHERE id=? AND tenant=?")
            .bind("skipped", actionId, t.id)
            .run();
          continue;
        }
        await db
          .prepare("UPDATE actions SET status=?,data=? WHERE id=? AND tenant=?")
          .bind(
            "attempting",
            JSON.stringify({ gmailId: m.id, originalLabels: current.labels }),
            actionId,
            t.id,
          )
          .run();
        if (data.action === "trash") await gmail.trashMessage(m.id);
        else await gmail.archiveMessage(m.id);
        await db
          .prepare("UPDATE actions SET status=? WHERE id=? AND tenant=?")
          .bind("success", actionId, t.id)
          .run();
        current.labels =
          data.action === "trash"
            ? [...current.labels.filter((l) => l !== "INBOX"), "TRASH"]
            : current.labels.filter((l) => l !== "INBOX");
        await db
          .prepare(
            "UPDATE messages SET metadata=?,classification=?,updated=? WHERE tenant=? AND gmail_id=?",
          )
          .bind(
            JSON.stringify(current),
            JSON.stringify(classify(current, protectedSenders)),
            Date.now(),
            t.id,
            m.id,
          )
          .run();
        done++;
      } catch {
        failed++;
        await db
          .prepare(
            "UPDATE actions SET status=? WHERE id=? AND tenant=? AND status NOT IN (?,?)",
          )
          .bind("uncertain", actionId, t.id, "success", "skipped")
          .run();
      }
    }
    await db
      .prepare("UPDATE plans SET status=? WHERE id=? AND tenant=?")
      .bind(failed ? "partial" : "executed", input.planId, t.id)
      .run();
    await refreshGroups(t);
    return json({ total: done, skipped, failed, action: data.action });
  }
  if (path === "gmail/undo") {
    const input = z.object({ actionId: z.string() }).strict().parse(body);
    const a = await db
      .prepare(
        `SELECT * FROM actions WHERE id=? AND tenant=? AND source='gmail' AND kind IN ('trash','archive') AND status='success'`,
      )
      .bind(input.actionId, t.id)
      .first<{ data: string; kind: string; created: number }>();
    if (!a || Date.now() - a.created > 29 * 86400000)
      throw new ApiError(
        409,
        "Recovery unavailable. Check Gmail Trash directly.",
      );
    const undoClient = await clientFor(t, req);
    const lock = await db
      .prepare(
        `UPDATE actions SET status='restoring' WHERE id=? AND tenant=? AND status='success' AND NOT EXISTS(SELECT 1 FROM plans WHERE tenant=? AND source='gmail' AND status='executing') AND NOT EXISTS(SELECT 1 FROM actions other WHERE other.tenant=? AND other.status='restoring')`,
      )
      .bind(input.actionId, t.id, t.id, t.id)
      .run();
    if (!lock.meta.changes)
      throw new ApiError(409, "Undo already in progress.");
    const gmail = undoClient,
      d = JSON.parse(a.data) as { gmailId: string; originalLabels: string[] };
    try {
      if (a.kind === "trash") await gmail.untrashMessage(d.gmailId);
      if (d.originalLabels.includes("INBOX"))
        await gmail.restoreInbox(d.gmailId);
      const m = metadata(await gmail.getMessage(d.gmailId));
      await db.batch([
        db
          .prepare(`UPDATE actions SET status='undone' WHERE id=? AND tenant=?`)
          .bind(input.actionId, t.id),
        db
          .prepare(
            "UPDATE messages SET metadata=?,classification=?,updated=? WHERE tenant=? AND gmail_id=?",
          )
          .bind(
            JSON.stringify(m),
            JSON.stringify(classify(m, t.settings.protectedSenders)),
            Date.now(),
            t.id,
            d.gmailId,
          ),
      ]);
      await refreshGroups(t);
      return json({ restored: true });
    } catch {
      await db
        .prepare(
          `UPDATE actions SET status='restore_uncertain' WHERE id=? AND tenant=?`,
        )
        .bind(input.actionId, t.id)
        .run();
      throw new ApiError(
        503,
        "Undo could not be confirmed. Check Gmail before retrying.",
      );
    }
  }
  if (path === "gmail/messages") {
    const input = z
      .object({
        sender: z.string().max(320).optional(),
        offset: z.number().int().min(0).default(0),
      })
      .strict()
      .parse(body);
    const rows = await db
      .prepare(
        `SELECT id,gmail_id,metadata,classification FROM messages WHERE tenant=? ${input.sender ? "AND json_extract(metadata,'$.sender')=?" : ""} ORDER BY updated DESC LIMIT 50 OFFSET ?`,
      )
      .bind(t.id, ...(input.sender ? [input.sender] : []), input.offset)
      .all();
    return json({
      messages: rows.results.map((m) => ({
        ...m,
        metadata: JSON.parse(String(m.metadata)),
        classification: JSON.parse(String(m.classification)),
      })),
    });
  }
  throw new ApiError(404, "Gmail action unavailable.");
}
async function refreshGroups(t: Tenant) {
  const db = binding();
  await db.batch([
    db
      .prepare(`DELETE FROM mail_groups WHERE tenant=? AND source='gmail'`)
      .bind(t.id),
    db
      .prepare(
        `INSERT INTO mail_groups(id,tenant,source,sender,address,category,count,bytes,oldest,newest,protected,revision,list_id,status) SELECT ?||':'||json_extract(metadata,'$.sender')||':'||json_extract(classification,'$.category'),?,'gmail',json_extract(metadata,'$.sender'),json_extract(metadata,'$.sender'),json_extract(classification,'$.category'),COUNT(*),SUM(json_extract(metadata,'$.size')),MIN(json_extract(metadata,'$.date')),MAX(json_extract(metadata,'$.date')),MAX(CASE WHEN json_extract(classification,'$.action')='KEEP' THEN 1 ELSE 0 END),0,json_extract(metadata,'$.listId'),'active' FROM messages WHERE tenant=? AND json_extract(metadata,'$.labels') NOT LIKE '%TRASH%' GROUP BY json_extract(metadata,'$.sender'),json_extract(classification,'$.category')`,
      )
      .bind(t.id, t.id, t.id),
  ]);
}
