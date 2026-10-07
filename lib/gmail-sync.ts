import { ApiError, binding } from "./server";
import { classify, type MessageMetadata } from "@/packages/core";
import type {
  GmailClient,
  GmailMessage,
  HistoryPage,
} from "@/packages/integrations/gmail";

type Account = { email: string; generation: string };
type Cursor = {
  version: 1;
  phase: "full" | "history";
  baseline: string;
  sweep?: string;
  run?: string;
  page?: string;
  seen: string[];
  pending?: { ids: string[]; next?: string; checkpoint: string };
};
const PAGE_SIZE = 25;
const LEASE_MS = 120000;
const historyId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,128}$/.test(value);
function messageId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
    throw new ApiError(502, "Gmail returned an invalid message identifier.");
  return value;
}
function historyMessages(page: HistoryPage): string[] {
  if (
    !historyId(page.historyId) ||
    (page.history && !Array.isArray(page.history))
  )
    throw new ApiError(502, "Gmail history response is incomplete.");
  const ids = new Set<string>();
  for (const event of page.history ?? []) {
    for (const key of [
      "messagesAdded",
      "messagesDeleted",
      "labelsAdded",
      "labelsRemoved",
    ] as const) {
      const entries = event[key];
      if (entries && !Array.isArray(entries))
        throw new ApiError(502, "Gmail history response is incomplete.");
      for (const entry of entries ?? []) {
        ids.add(messageId(entry.message?.id));
        if (ids.size > 10000)
          throw new ApiError(
            502,
            "Gmail history page exceeds the safe processing limit.",
          );
      }
    }
  }
  return [...ids];
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}
/** One bounded read-only work unit. Cursor and inventory changes commit atomically. */
export async function syncGmailPage(
  tenantId: string,
  gmail: GmailClient,
  account: Account,
  project: (message: GmailMessage) => MessageMetadata,
  restart = false,
) {
  const db = binding(),
    id = `${tenantId}:gmail:scan`,
    owner = crypto.randomUUID();
  await db
    .prepare(
      "INSERT OR IGNORE INTO jobs(id,tenant,source,cursor,processed,status,updated,lease) VALUES(?,?,'gmail',NULL,0,'running',?,0)",
    )
    .bind(id, tenantId, Date.now())
    .run();
  const job = await db
    .prepare(
      "UPDATE jobs SET owner=?,lease=?,status='running' WHERE id=? AND tenant=? AND lease<? AND EXISTS(SELECT 1 FROM credentials WHERE tenant=jobs.tenant AND email=? AND generation=?) AND EXISTS(SELECT 1 FROM tenants WHERE id=jobs.tenant AND deleted=0) RETURNING cursor,history_id",
    )
    .bind(
      owner,
      Date.now() + LEASE_MS,
      id,
      tenantId,
      Date.now(),
      account.email,
      account.generation,
    )
    .first<{ cursor: string | null; history_id: string | null }>();
  if (!job)
    throw new ApiError(
      409,
      "A scan is already processing or the account changed.",
    );
  const fence =
    "EXISTS(SELECT 1 FROM jobs j JOIN credentials c ON c.tenant=j.tenant JOIN tenants t ON t.id=j.tenant WHERE j.id=? AND j.tenant=? AND j.owner=? AND j.lease>? AND j.status='running' AND c.email=? AND c.generation=? AND t.deleted=0)";
  const args = () => [
    id,
    tenantId,
    owner,
    Date.now(),
    account.email,
    account.generation,
  ];
  const heartbeat = async () => {
    const result = await db
      .prepare(`UPDATE jobs SET lease=? WHERE id=? AND tenant=? AND ${fence}`)
      .bind(Date.now() + LEASE_MS, id, tenantId, ...args())
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, "Scan ownership or Gmail account changed.");
  };
  try {
    let cursor: Cursor | null = null;
    if (job.cursor && !restart) {
      try {
        const parsed = JSON.parse(job.cursor) as Cursor;
        if (
          parsed.version === 1 &&
          ["full", "history"].includes(parsed.phase) &&
          historyId(parsed.baseline) &&
          Array.isArray(parsed.seen)
        )
          cursor = parsed;
      } catch {
        /* An older opaque scan cursor restarts a safe full inventory. */
      }
    }
    if (!cursor && !restart && historyId(job.history_id))
      cursor = {
        version: 1,
        phase: "history",
        baseline: job.history_id,
        seen: [],
      };
    const startFull = async (): Promise<Cursor> => {
      const profile = await gmail.getProfile();
      if (
        profile.emailAddress !== account.email ||
        !historyId(profile.historyId)
      )
        throw new ApiError(
          409,
          "Gmail profile does not match the connected account.",
        );
      return {
        version: 1,
        phase: "full",
        baseline: profile.historyId,
        sweep: crypto.randomUUID(),
        seen: [],
      };
    };
    if (!cursor) cursor = await startFull();
    cursor.run ??= crypto.randomUUID();
    await heartbeat();
    const phase = cursor.phase;
    let ids: string[],
      next: string | undefined,
      checkpoint = cursor.baseline;
    if (phase === "full") {
      const page = await gmail.listMessages({
        pageToken: cursor.page,
        maxResults: PAGE_SIZE,
        includeSpamTrash: true,
      });
      if (page.messages && !Array.isArray(page.messages))
        throw new ApiError(502, "Gmail inventory response is incomplete.");
      if ((page.messages?.length ?? 0) > PAGE_SIZE)
        throw new ApiError(
          502,
          "Gmail inventory page exceeds its requested limit.",
        );
      ids = [...new Set((page.messages ?? []).map((row) => messageId(row.id)))];
      next = page.nextPageToken;
    } else {
      if (!cursor.pending) {
        let page: HistoryPage;
        try {
          page = await gmail.listHistory(
            cursor.baseline,
            cursor.page,
            PAGE_SIZE,
          );
        } catch (error) {
          if (!isMissing(error)) throw error;
          const full = await startFull();
          const reset = await db
            .prepare(
              `UPDATE jobs SET cursor=?,history_id=NULL,status='running',lease=0,owner=NULL,updated=? WHERE id=? AND tenant=? AND ${fence}`,
            )
            .bind(JSON.stringify(full), Date.now(), id, tenantId, ...args())
            .run();
          if (!reset.meta.changes)
            throw new ApiError(409, "Scan ownership changed.");
          return {
            processed: 0,
            complete: false,
            jobId: id,
            mode: "full",
            resync: true,
          };
        }
        cursor.pending = {
          ids: historyMessages(page),
          next: page.nextPageToken,
          checkpoint: page.historyId,
        };
      }
      ids = cursor.pending.ids.slice(0, PAGE_SIZE);
      next = cursor.pending.next;
      checkpoint = cursor.pending.checkpoint;
    }
    if (
      next !== undefined &&
      (typeof next !== "string" || next.length === 0 || next.length > 8192)
    )
      throw new ApiError(502, "Gmail returned an invalid pagination token.");
    if (!historyId(checkpoint) || BigInt(checkpoint) < BigInt(cursor.baseline))
      throw new ApiError(502, "Gmail history checkpoint moved backwards.");
    if (next && (next === cursor.page || cursor.seen.includes(next)))
      throw new ApiError(
        502,
        "Gmail pagination did not advance. Restart synchronization.",
      );
    const advancesPage =
      phase === "full" || (cursor.pending?.ids.length ?? 0) <= PAGE_SIZE;
    let pageKey: string | null = null;
    if (next && advancesPage) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(next),
      );
      pageKey = `${tenantId}:${cursor.run}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (
        await db
          .prepare("SELECT id FROM sync_pages WHERE id=? AND tenant=?")
          .bind(pageKey, tenantId)
          .first()
      )
        throw new ApiError(
          502,
          "Gmail pagination repeated a previously processed token. Restart synchronization.",
        );
    }
    const found: MessageMetadata[] = [],
      missing: string[] = [];
    for (const message of ids) {
      await heartbeat();
      try {
        const raw = await gmail.getSafetyMessage(message);
        if (raw.id !== message)
          throw new ApiError(
            502,
            "Gmail returned mismatched message metadata.",
          );
        found.push(project(raw));
      } catch (error) {
        if (!isMissing(error)) throw error;
        missing.push(message);
      }
    }
    await heartbeat();
    const prefs = await db
      .prepare("SELECT settings FROM tenants WHERE id=? AND deleted=0")
      .bind(tenantId)
      .first<{ settings: string }>();
    if (!prefs) throw new ApiError(409, "Account is unavailable.");
    const protectedSenders = JSON.parse(prefs.settings)
      .protectedSenders as string[];
    const oldSweep = cursor.sweep;
    let finalHistory: string | null = job.history_id,
      complete = false,
      prune = false;
    if (phase === "history" && cursor.pending!.ids.length > PAGE_SIZE) {
      cursor.pending!.ids = cursor.pending!.ids.slice(PAGE_SIZE);
    } else if (next) {
      cursor = {
        ...cursor,
        page: next,
        seen: [...cursor.seen, next].slice(-32),
        pending: undefined,
      };
    } else if (phase === "full") {
      prune = true;
      finalHistory = cursor.baseline;
      cursor = {
        version: 1,
        phase: "history",
        baseline: cursor.baseline,
        seen: [],
      };
    } else {
      finalHistory = checkpoint;
      complete = true;
    }
    const statements: D1PreparedStatement[] = [
      ...(pageKey
        ? [
            db
              .prepare(
                `INSERT INTO sync_pages(id,tenant) SELECT ?,? WHERE ${fence}`,
              )
              .bind(pageKey, tenantId, ...args()),
          ]
        : []),
      ...(!next && advancesPage
        ? [
            db
              .prepare(`DELETE FROM sync_pages WHERE tenant=? AND ${fence}`)
              .bind(tenantId, ...args()),
          ]
        : []),
      ...found.map((m) =>
        db
          .prepare(
            `INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) SELECT ?,?,?,?,?,? WHERE ${fence} ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,classification=excluded.classification,updated=excluded.updated`,
          )
          .bind(
            `${tenantId}:${m.id}`,
            tenantId,
            m.id,
            JSON.stringify(m),
            JSON.stringify(classify(m, protectedSenders)),
            Date.now(),
            ...args(),
          ),
      ),
      ...missing.map((message) =>
        db
          .prepare(
            `DELETE FROM messages WHERE tenant=? AND gmail_id=? AND ${fence}`,
          )
          .bind(tenantId, message, ...args()),
      ),
      ...(phase === "full"
        ? found.map((m) =>
            db
              .prepare(
                `INSERT INTO sync_seen(id,tenant,gmail_id,generation) SELECT ?,?,?,? WHERE ${fence} ON CONFLICT(id) DO UPDATE SET generation=excluded.generation`,
              )
              .bind(`${tenantId}:${m.id}`, tenantId, m.id, oldSweep, ...args()),
          )
        : []),
      ...(prune
        ? [
            db
              .prepare(
                `DELETE FROM messages WHERE tenant=? AND NOT EXISTS(SELECT 1 FROM sync_seen s WHERE s.tenant=messages.tenant AND s.gmail_id=messages.gmail_id AND s.generation=?) AND ${fence}`,
              )
              .bind(tenantId, oldSweep, ...args()),
            db
              .prepare(`DELETE FROM sync_seen WHERE tenant=? AND ${fence}`)
              .bind(tenantId, ...args()),
          ]
        : []),
      db
        .prepare(
          `UPDATE jobs SET cursor=?,history_id=?,processed=(SELECT COUNT(*) FROM messages WHERE tenant=?),status=?,updated=?,lease=0,owner=NULL WHERE id=? AND tenant=? AND ${fence}`,
        )
        .bind(
          complete ? null : JSON.stringify(cursor),
          finalHistory,
          tenantId,
          complete ? "complete" : "running",
          Date.now(),
          id,
          tenantId,
          ...args(),
        ),
    ];
    const committed = await db.batch(statements);
    if (!committed.at(-1)?.meta.changes)
      throw new ApiError(
        409,
        "Scan ownership or Gmail account changed. Retry a fresh scan.",
      );
    const count = await db
      .prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?")
      .bind(tenantId)
      .first<{ n: number }>();
    return {
      processed: count?.n ?? 0,
      complete,
      jobId: id,
      mode: phase,
      resync: false,
    };
  } catch (error) {
    await db
      .prepare(
        "UPDATE jobs SET status='interrupted',lease=0,owner=NULL WHERE id=? AND tenant=? AND owner=?",
      )
      .bind(id, tenantId, owner)
      .run();
    throw error;
  }
}
