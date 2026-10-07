import { ApiError, binding, config, json, record, type tenant } from "./server";
import {
  GmailClient,
  GmailMutationNotDispatched,
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
import { syncGmailPage } from "./gmail-sync";
import { assessUnsubscribe } from "@/packages/integrations/unsubscribe";
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
type GmailAccount = { email: string; generation: string };
const ACTION_LEASE_MS = 120000;
async function renewLease(
  table: "plans" | "actions",
  id: string,
  tenantId: string,
  owner: string,
  account?: GmailAccount,
) {
  const expires = Date.now() + ACTION_LEASE_MS;
  const renewed = await binding()
    .prepare(
      `UPDATE ${table} SET lease=? WHERE id=? AND tenant=? AND owner=? AND lease>? AND ${table === "plans" ? "status='executing'" : "status IN ('pending','attempting','restoring')"} AND EXISTS(SELECT 1 FROM tenants WHERE id=? AND deleted=0) AND EXISTS(SELECT 1 FROM credentials WHERE tenant=?${account ? " AND email=? AND generation=?" : ""})`,
    )
    .bind(
      expires,
      id,
      tenantId,
      owner,
      Date.now(),
      tenantId,
      tenantId,
      ...(account ? [account.email, account.generation] : []),
    )
    .run();
  if (!renewed.meta.changes || Date.now() >= expires)
    throw new ApiError(
      409,
      "Operation ownership expired. Check interrupted actions before continuing.",
    );
  return expires;
}
export async function clientFor(
  t: Tenant,
  req: Request,
  authorizeMutation?: (account: GmailAccount) => Promise<number>,
  expectedAccount?: GmailAccount,
) {
  const c = oauthConfig(req),
    db = binding();
  const initial = await db
    .prepare("SELECT email,generation FROM credentials WHERE tenant=?")
    .bind(t.id)
    .first<GmailAccount>();
  if (!initial) throw new ApiError(409, "Connect Gmail first.");
  if (
    expectedAccount &&
    (initial.email !== expectedAccount.email ||
      initial.generation !== expectedAccount.generation)
  )
    throw new ApiError(409, "Gmail account changed.");
  const pinnedEmail = initial.email;
  return new GmailClient({
    authorizeMutation: authorizeMutation
      ? () => authorizeMutation(initial)
      : undefined,
    accessToken: async () => {
      const row = await db
        .prepare(
          "SELECT encrypted,updated,email,generation FROM credentials WHERE tenant=?",
        )
        .bind(t.id)
        .first<{
          encrypted: string;
          updated: number;
          email: string;
          generation: string;
        }>();
      if (
        !row ||
        row.email !== pinnedEmail ||
        row.generation !== initial.generation
      )
        throw new ApiError(
          409,
          "Gmail account changed. Stop and review a fresh plan.",
        );
      const currentConnection = async () => {
        const valid = await db
          .prepare(
            "SELECT tenant FROM credentials WHERE tenant=? AND email=? AND generation=?",
          )
          .bind(t.id, pinnedEmail, initial.generation)
          .first();
        if (!valid)
          throw new ApiError(
            409,
            "Gmail connection changed during token acquisition.",
          );
      };
      let tokens = await decryptTokens(row.encrypted, c.key, t.id);
      await currentConnection();
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
            "UPDATE credentials SET encrypted=?,updated=? WHERE tenant=? AND email=? AND encrypted=? AND generation=?",
          )
          .bind(
            await encryptTokens(tokens, c.key, t.id),
            Date.now(),
            t.id,
            pinnedEmail,
            row.encrypted,
            initial.generation,
          )
          .run();
        if (!refreshed.meta.changes)
          throw new ApiError(
            409,
            "Gmail connection changed during refresh. Review a fresh plan.",
          );
      }
      await currentConnection();
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
    const intent = await db
      .prepare(
        "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id=? AND deleted=0 RETURNING connection_epoch",
      )
      .bind(t.id)
      .first<{ connection_epoch: number }>();
    if (!intent) throw new ApiError(409, "Gmail connection unavailable.");
    const started = await db
      .prepare(
        "INSERT INTO oauth_transactions(state,tenant,verifier,expires,epoch) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=? AND deleted=0 AND connection_epoch=?)",
      )
      .bind(
        transaction.state,
        t.id,
        transaction.verifier,
        transaction.expiresAt,
        intent.connection_epoch,
        t.id,
        intent.connection_epoch,
      )
      .run();
    if (!started.meta.changes)
      throw new ApiError(
        409,
        "Gmail connection was cancelled. Please start again.",
      );
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
        "DELETE FROM oauth_transactions WHERE state=? AND tenant=? AND expires>? RETURNING verifier,expires,epoch",
      )
      .bind(returnedState, t.id, Date.now())
      .first<{ verifier: string; expires: number; epoch: number }>();
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
    const connectionFence =
      "EXISTS(SELECT 1 FROM tenants WHERE id=? AND deleted=0 AND connection_epoch=?)";
    const committed = await db.batch([
      ...(existing?.email !== profile.emailAddress
        ? [
            "messages",
            "sync_seen",
            "sync_pages",
            "mail_groups",
            "plans",
            "jobs",
            ...(existing ? ["actions"] : []),
          ].map((table) =>
            db
              .prepare(
                `DELETE FROM ${table} WHERE tenant=? ${["messages", "sync_seen", "sync_pages"].includes(table) ? "" : "AND source='gmail'"} AND ${connectionFence}`,
              )
              .bind(t.id, t.id, transaction.epoch),
          )
        : []),
      db
        .prepare(
          `INSERT INTO credentials(tenant,encrypted,email,updated,generation) SELECT ?,?,?,?,? WHERE ${connectionFence} ON CONFLICT(tenant) DO UPDATE SET encrypted=excluded.encrypted,email=excluded.email,updated=excluded.updated,generation=excluded.generation`,
        )
        .bind(
          t.id,
          await encryptTokens(stored, c.key, t.id),
          profile.emailAddress,
          Date.now(),
          crypto.randomUUID(),
          t.id,
          transaction.epoch,
        ),
      db
        .prepare(
          "UPDATE tenants SET settings=json_set(settings,'$.source','gmail') WHERE id=? AND deleted=0 AND connection_epoch=?",
        )
        .bind(t.id, transaction.epoch),
    ]);
    if (!committed.at(-1)?.meta.changes)
      throw new ApiError(
        409,
        "Gmail connection was cancelled or replaced. Please start again.",
      );
    await record(t.id, "gmail", "connected", {
      message: "Gmail connected. Scanning reads metadata only.",
    });
    return Response.redirect(`${url.origin}/?view=report&gmail=connected`, 302);
  }
  if (req.method !== "POST")
    throw new ApiError(404, "Gmail action unavailable.");
  const body = await req.json();
  if (path === "gmail/disconnect") {
    const row = await db
      .prepare("SELECT encrypted FROM credentials WHERE tenant=?")
      .bind(t.id)
      .first<{ encrypted: string }>();
    let revocationConfirmed = true;
    await db.batch([
      db
        .prepare(
          "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id=?",
        )
        .bind(t.id),
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
          `UPDATE jobs SET status='cancelled',lease=0,owner=NULL WHERE tenant=? AND source='gmail'`,
        )
        .bind(t.id),
      db
        .prepare(
          `UPDATE plans SET status='cancelled',lease=0,owner=NULL WHERE tenant=? AND source='gmail' AND status!='executed'`,
        )
        .bind(t.id),
      db
        .prepare(
          "UPDATE actions SET status=CASE status WHEN 'attempting' THEN 'uncertain' WHEN 'restoring' THEN 'restore_uncertain' ELSE 'failed' END,lease=0,owner=NULL WHERE tenant=? AND source='gmail' AND status IN ('pending','attempting','restoring')",
        )
        .bind(t.id),
    ]);
    if (row) {
      try {
        const c = oauthConfig(req);
        const tokens = await decryptTokens(row.encrypted, c.key, t.id);
        await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
      } catch {
        revocationConfirmed = false;
      }
    }
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
    const input = z
      .object({ restart: z.boolean().default(false) })
      .strict()
      .parse(body);
    const account = await db
      .prepare("SELECT email,generation FROM credentials WHERE tenant=?")
      .bind(t.id)
      .first<GmailAccount>();
    if (!account) throw new ApiError(409, "Connect Gmail first.");
    const gmail = await clientFor(t, req, undefined, account);
    const result = await syncGmailPage(
      t.id,
      gmail,
      account,
      metadata,
      input.restart,
    );
    await refreshGroups(t);
    return json(result);
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
    const owner = crypto.randomUUID();
    let currentAction: string | null = null;
    let currentMessage: MessageMetadata | null = null;
    const readyClient = await clientFor(t, req, async (account) => {
      if (!currentAction || !currentMessage)
        throw new ApiError(409, "No approved action is bound to this request.");
      await renewLease("plans", input.planId, t.id, owner, account);
      await renewLease("actions", currentAction, t.id, owner, account);
      const fresh = metadata(
        await readyClient.getSafetyMessage(currentMessage.id),
      );
      const thread = await readyClient.getThread(fresh.threadId);
      const prefs = await db
        .prepare("SELECT settings FROM tenants WHERE id=? AND deleted=0")
        .bind(t.id)
        .first<{ settings: string }>();
      if (
        !prefs ||
        plan.expires <= Date.now() ||
        JSON.stringify(fresh) !== JSON.stringify(currentMessage) ||
        classify(fresh, JSON.parse(prefs.settings).protectedSenders).action !==
          "TRASH" ||
        thread.id !== fresh.threadId ||
        thread.messages?.length !== 1 ||
        thread.messages.some((m) => m.labelIds?.includes("SENT"))
      )
        throw new ApiError(
          409,
          "Fresh dispatch protection or approval check failed.",
        );
      const planLease = await renewLease(
        "plans",
        input.planId,
        t.id,
        owner,
        account,
      );
      const actionLease = await renewLease(
        "actions",
        currentAction,
        t.id,
        owner,
        account,
      );
      const dispatch = await db
        .prepare(
          "UPDATE actions SET status='attempting',data=? WHERE id=? AND tenant=? AND owner=? AND status='pending' AND lease>? AND EXISTS(SELECT 1 FROM credentials WHERE tenant=actions.tenant AND email=? AND generation=?) AND EXISTS(SELECT 1 FROM tenants WHERE id=actions.tenant AND deleted=0) AND EXISTS(SELECT 1 FROM plans WHERE id=actions.plan_id AND tenant=actions.tenant AND owner=? AND status='executing' AND lease>? AND expires>?)",
        )
        .bind(
          JSON.stringify({
            gmailId: currentMessage.id,
            originalLabels: currentMessage.labels,
            accountEmail: account.email,
          }),
          currentAction,
          t.id,
          owner,
          Date.now(),
          account.email,
          account.generation,
          owner,
          Date.now(),
          Date.now(),
        )
        .run();
      if (!dispatch.meta.changes)
        throw new ApiError(409, "Dispatch ownership changed.");
      return Math.min(planLease, actionLease, plan.expires);
    });
    const lock = await db
      .prepare(
        `UPDATE plans SET status='executing',owner=?,lease=? WHERE id=? AND tenant=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM plans busy WHERE busy.tenant=? AND busy.source='gmail' AND busy.status='executing') AND NOT EXISTS(SELECT 1 FROM actions WHERE actions.tenant=plans.tenant AND status='restoring')`,
      )
      .bind(owner, Date.now() + ACTION_LEASE_MS, input.planId, t.id, t.id)
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
      await renewLease("plans", input.planId, t.id, owner);
      const actionId = `${input.planId}:${m.id}`;
      await db
        .prepare(
          "INSERT OR IGNORE INTO actions(id,tenant,source,plan_id,kind,data,created,status,owner,lease) VALUES(?,?,?,?,?,?,?,?,?,?)",
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
          owner,
          Date.now() + ACTION_LEASE_MS,
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
          thread.messages?.length !== 1 ||
          thread.id !== current.threadId ||
          thread.messages.some((x) => x.labelIds?.includes("SENT"));
        if (
          hasReply ||
          classify(current, protectedSenders).action !== "TRASH" ||
          JSON.stringify(current) !== JSON.stringify(m.metadata)
        ) {
          skipped++;
          await db
            .prepare(
              "UPDATE actions SET status=?,lease=0 WHERE id=? AND tenant=? AND owner=?",
            )
            .bind("skipped", actionId, t.id, owner)
            .run();
          continue;
        }
        await renewLease("plans", input.planId, t.id, owner);
        const attempt = await db
          .prepare(
            "UPDATE actions SET data=?,lease=? WHERE id=? AND tenant=? AND owner=? AND status='pending' AND lease>?",
          )
          .bind(
            JSON.stringify({ gmailId: m.id, originalLabels: current.labels }),
            Date.now() + ACTION_LEASE_MS,
            actionId,
            t.id,
            owner,
            Date.now(),
          )
          .run();
        if (!attempt.meta.changes)
          throw new ApiError(409, "Cleanup action ownership changed.");
        currentAction = actionId;
        currentMessage = current;
        if (data.action === "trash") await gmail.trashMessage(m.id);
        else await gmail.archiveMessage(m.id);
        const confirmed = await db
          .prepare(
            "UPDATE actions SET status='success',lease=0 WHERE id=? AND tenant=? AND owner=? AND status='attempting' AND lease>?",
          )
          .bind(actionId, t.id, owner, Date.now())
          .run();
        if (!confirmed.meta.changes)
          throw new ApiError(409, "Cleanup confirmation ownership changed.");
        current.labels =
          data.action === "trash"
            ? [...current.labels.filter((l) => l !== "INBOX"), "TRASH"]
            : current.labels.filter((l) => l !== "INBOX");
        await db
          .prepare(
            "UPDATE messages SET metadata=?,classification=?,updated=? WHERE tenant=? AND gmail_id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND tenant=? AND owner=? AND status='success')",
          )
          .bind(
            JSON.stringify(current),
            JSON.stringify(classify(current, protectedSenders)),
            Date.now(),
            t.id,
            m.id,
            actionId,
            t.id,
            owner,
          )
          .run();
        done++;
      } catch (error) {
        failed++;
        await db
          .prepare(
            "UPDATE actions SET status=CASE WHEN status='attempting' AND ?=0 THEN 'uncertain' ELSE 'failed' END,lease=0 WHERE id=? AND tenant=? AND owner=? AND status NOT IN (?,?)",
          )
          .bind(
            error instanceof GmailMutationNotDispatched ? 1 : 0,
            actionId,
            t.id,
            owner,
            "success",
            "skipped",
          )
          .run();
      }
    }
    await db
      .prepare(
        "UPDATE plans SET status=?,lease=0,owner=NULL WHERE id=? AND tenant=? AND owner=?",
      )
      .bind(failed ? "partial" : "executed", input.planId, t.id, owner)
      .run();
    await refreshGroups(t);
    return json({ total: done, skipped, failed, action: data.action });
  }
  if (path === "gmail/undo") {
    const input = z.object({ actionId: z.string() }).strict().parse(body);
    const a = await db
      .prepare(
        `SELECT * FROM actions WHERE id=? AND tenant=? AND source='gmail' AND kind IN ('trash','archive') AND status IN ('success','uncertain','restore_uncertain') AND json_extract(data,'$.accountEmail')=(SELECT email FROM credentials WHERE tenant=actions.tenant)`,
      )
      .bind(input.actionId, t.id)
      .first<{ data: string; kind: string; created: number }>();
    if (!a || Date.now() - a.created > 29 * 86400000)
      throw new ApiError(
        409,
        "Recovery unavailable for the connected account. Reconnect the account used for this action, or check Gmail Trash directly.",
      );
    const d = JSON.parse(a.data) as {
      gmailId: string;
      originalLabels: string[];
      accountEmail: string;
    };
    const owner = crypto.randomUUID();
    const undoClient = await clientFor(t, req, (account) => {
      if (account.email !== d.accountEmail)
        throw new ApiError(
          409,
          "The connected account changed. Reconnect the account used for this action.",
        );
      return renewLease("actions", input.actionId, t.id, owner, account);
    });
    const lock = await db
      .prepare(
        `UPDATE actions SET status='restoring',owner=?,lease=? WHERE id=? AND tenant=? AND json_extract(data,'$.accountEmail')=? AND EXISTS(SELECT 1 FROM credentials WHERE tenant=actions.tenant AND email=?) AND status IN ('success','uncertain','restore_uncertain') AND NOT EXISTS(SELECT 1 FROM plans WHERE tenant=? AND source='gmail' AND status='executing') AND NOT EXISTS(SELECT 1 FROM actions other WHERE other.tenant=? AND other.status='restoring')`,
      )
      .bind(
        owner,
        Date.now() + ACTION_LEASE_MS,
        input.actionId,
        t.id,
        d.accountEmail,
        d.accountEmail,
        t.id,
        t.id,
      )
      .run();
    if (!lock.meta.changes)
      throw new ApiError(409, "Undo already in progress.");
    const gmail = undoClient;
    try {
      const before = await gmail.getSafetyMessage(d.gmailId);
      if (before.id !== d.gmailId || !Array.isArray(before.labelIds))
        throw new Error("Recovery state unavailable");
      await renewLease("actions", input.actionId, t.id, owner);
      if (a.kind === "trash" && before.labelIds?.includes("TRASH"))
        await gmail.untrashMessage(d.gmailId);
      await renewLease("actions", input.actionId, t.id, owner);
      if (
        d.originalLabels.includes("INBOX") &&
        !before.labelIds?.includes("INBOX")
      )
        await gmail.restoreInbox(d.gmailId);
      const after = await gmail.getSafetyMessage(d.gmailId);
      if (after.id !== d.gmailId || !Array.isArray(after.labelIds))
        throw new Error("Recovery confirmation unavailable");
      const m = metadata(after);
      if (
        m.id !== d.gmailId ||
        m.labels.includes("TRASH") ||
        (d.originalLabels.includes("INBOX") && !m.labels.includes("INBOX"))
      )
        throw new Error("Recovery not confirmed");
      await renewLease("actions", input.actionId, t.id, owner);
      const restored = await db.batch([
        db
          .prepare(
            `UPDATE actions SET status='undone',lease=0 WHERE id=? AND tenant=? AND owner=?`,
          )
          .bind(input.actionId, t.id, owner),
        db
          .prepare(
            "UPDATE messages SET metadata=?,classification=?,updated=? WHERE tenant=? AND gmail_id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND tenant=? AND owner=? AND status='undone')",
          )
          .bind(
            JSON.stringify(m),
            JSON.stringify(classify(m, t.settings.protectedSenders)),
            Date.now(),
            t.id,
            d.gmailId,
            input.actionId,
            t.id,
            owner,
          ),
      ]);
      if (!restored[0].meta.changes)
        throw new ApiError(
          409,
          "Recovery ownership changed before confirmation.",
        );
      await refreshGroups(t);
      return json({ restored: true });
    } catch {
      await db
        .prepare(
          `UPDATE actions SET status='restore_uncertain',lease=0 WHERE id=? AND tenant=? AND owner=?`,
        )
        .bind(input.actionId, t.id, owner)
        .run();
      throw new ApiError(
        503,
        "Undo could not be confirmed. Check Gmail before retrying.",
      );
    }
  }
  if (path === "gmail/reconcile") {
    z.object({}).strict().parse(body);
    const now = Date.now();
    const results = await db.batch([
      db
        .prepare(
          "UPDATE actions SET status=CASE status WHEN 'attempting' THEN 'uncertain' WHEN 'restoring' THEN 'restore_uncertain' ELSE 'failed' END,owner=NULL,lease=0 WHERE tenant=? AND source='gmail' AND status IN ('pending','attempting','restoring') AND lease<=? AND NOT EXISTS(SELECT 1 FROM plans p WHERE p.id=actions.plan_id AND p.tenant=actions.tenant AND p.status='executing' AND p.lease>?)",
        )
        .bind(t.id, now, now),
      db
        .prepare(
          "UPDATE plans SET status='partial',owner=NULL,lease=0 WHERE tenant=? AND source='gmail' AND status='executing' AND lease<=? AND NOT EXISTS(SELECT 1 FROM actions a WHERE a.plan_id=plans.id AND a.tenant=plans.tenant AND a.status IN ('pending','attempting','restoring') AND a.lease>?)",
        )
        .bind(t.id, now, now),
    ]);
    return json({
      actions: results[0].meta.changes,
      plans: results[1].meta.changes,
      replayed: false,
      message:
        "Expired work released. No Gmail mutation was sent. Review uncertain actions and explicitly choose Undo; unattempted cleanup is never resumed.",
    });
  }
  if (path === "gmail/unsubscribe-options") {
    const input = z
      .object({ id: z.string().min(1).max(300) })
      .strict()
      .parse(body);
    const group = await db
      .prepare(
        "SELECT address FROM mail_groups WHERE id=? AND tenant=? AND source='gmail'",
      )
      .bind(input.id, t.id)
      .first<{ address: string }>();
    if (!group) throw new ApiError(404, "Subscription not found.");
    const row = await db
      .prepare(
        "SELECT metadata FROM messages WHERE tenant=? AND json_extract(metadata,'$.sender')=? ORDER BY updated DESC LIMIT 1",
      )
      .bind(t.id, group.address)
      .first<{ metadata: string }>();
    const message = row ? (JSON.parse(row.metadata) as MessageMetadata) : null;
    const connection = await db
      .prepare("SELECT email FROM credentials WHERE tenant=?")
      .bind(t.id)
      .first<{ email: string }>();
    return json({
      ...assessUnsubscribe(message?.unsubscribe ?? ""),
      sender: group.address,
      account: connection?.email ?? null,
      gmailUrl: "https://mail.google.com/mail/",
      search: `from:${group.address}`,
      sent: false,
    });
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
