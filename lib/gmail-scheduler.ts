import { ApiError, binding, config } from "./server";
import { clientFor, metadata, refreshGroups } from "./gmail-server";
import { GmailScanBusy, syncGmailPage } from "./gmail-sync";

const LEASE_MS = 120000;
const HEARTBEAT_MAX_AGE = 15 * 60000;
export async function schedulerAvailable() {
  if (
    config("GMAIL_SYNC_SCHEDULER") !== "enabled" ||
    !config("GOOGLE_CLIENT_ID") ||
    !config("GOOGLE_CLIENT_SECRET") ||
    !config("TOKEN_ENCRYPTION_KEY")
  )
    return false;
  try {
    const redirect = new URL(config("GOOGLE_REDIRECT_URI") ?? "");
    if (
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password
    )
      return false;
  } catch {
    return false;
  }
  const health = await binding()
    .prepare("SELECT last_tick FROM scheduler_health WHERE id='gmail-sync'")
    .first<{ last_tick: number }>();
  return (
    !!health &&
    health.last_tick <= Date.now() &&
    Date.now() - health.last_tick < HEARTBEAT_MAX_AGE
  );
}
export async function configureSyncSchedule(
  tenantId: string,
  enabled: boolean,
  intervalMinutes: number,
) {
  const db = binding();
  if (enabled && !(await schedulerAvailable()))
    throw new ApiError(
      409,
      "Scheduled scans are unavailable until the operator configures and verifies the worker. You can scan manually.",
    );
  const row = await db
    .prepare("SELECT generation FROM credentials WHERE tenant=?")
    .bind(tenantId)
    .first<{ generation: string }>();
  if (enabled && !row)
    throw new ApiError(409, "Connect Gmail before enabling scheduled scans.");
  if (enabled) {
    const saved = await db
      .prepare(
        "INSERT INTO sync_schedules(tenant,enabled,interval_minutes,next_due,status,generation) SELECT ?,1,?,?,'waiting',? WHERE EXISTS(SELECT 1 FROM credentials WHERE tenant=? AND generation=?) AND EXISTS(SELECT 1 FROM tenants WHERE id=? AND deleted=0 AND json_extract(settings,'$.source')='gmail') ON CONFLICT(tenant) DO UPDATE SET enabled=1,interval_minutes=excluded.interval_minutes,next_due=excluded.next_due,status='waiting',generation=excluded.generation,owner=NULL,lease=0,failures=0,last_error=NULL",
      )
      .bind(
        tenantId,
        intervalMinutes,
        Date.now(),
        row!.generation,
        tenantId,
        row!.generation,
        tenantId,
      )
      .run();
    if (!saved.meta.changes)
      throw new ApiError(
        409,
        "Gmail connection changed. Enable scheduled scans again.",
      );
  } else {
    await db
      .prepare(
        "UPDATE sync_schedules SET enabled=0,status='paused',owner=NULL,lease=0 WHERE tenant=?",
      )
      .bind(tenantId)
      .run();
  }
  return { enabled, intervalMinutes };
}
function failureCode(error: unknown): { code: string; reauth: boolean } {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : 0;
  const retryable =
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    error.retryable === true;
  if (status === 401 || (status === 403 && !retryable))
    return { code: "reauth_required", reauth: true };
  if (status === 409)
    return { code: "connection_or_ownership_changed", reauth: false };
  return { code: "sync_unavailable", reauth: false };
}
/** Trusted runtime event; bounded to three read-only units, never user cleanup rules. */
export async function runGmailScheduler() {
  if (config("GMAIL_SYNC_SCHEDULER") !== "enabled")
    return { enabled: false, claimed: 0, completed: 0, failed: 0 };
  const db = binding();
  const tick = Date.now();
  await db
    .prepare(
      "INSERT INTO scheduler_health(id,last_tick) VALUES('gmail-sync',?) ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick",
    )
    .bind(tick)
    .run();
  const redirect = config("GOOGLE_REDIRECT_URI");
  if (
    !redirect ||
    !config("GOOGLE_CLIENT_ID") ||
    !config("GOOGLE_CLIENT_SECRET") ||
    !config("TOKEN_ENCRYPTION_KEY")
  )
    return {
      enabled: true,
      configured: false,
      claimed: 0,
      completed: 0,
      failed: 0,
    };
  let callback: URL;
  try {
    callback = new URL(redirect);
    if (
      callback.protocol !== "https:" ||
      callback.username ||
      callback.password
    )
      throw new Error();
  } catch {
    return {
      enabled: true,
      configured: false,
      claimed: 0,
      completed: 0,
      failed: 0,
    };
  }
  const due = await db
    .prepare(
      "SELECT s.tenant FROM sync_schedules s JOIN tenants t ON t.id=s.tenant JOIN credentials c ON c.tenant=s.tenant WHERE s.enabled=1 AND s.next_due<=? AND s.lease<? AND t.deleted=0 AND json_extract(t.settings,'$.source')='gmail' AND c.generation=s.generation ORDER BY s.next_due,s.tenant LIMIT 3",
    )
    .bind(tick, tick)
    .all<{ tenant: string }>();
  let claimed = 0,
    completed = 0,
    failed = 0;
  await Promise.all(
    due.results.map(async ({ tenant: tenantId }) => {
      const owner = crypto.randomUUID();
      const schedule = await db
        .prepare(
          "UPDATE sync_schedules SET owner=?,lease=?,status='running' WHERE tenant=? AND enabled=1 AND next_due<=? AND lease<? AND EXISTS(SELECT 1 FROM credentials WHERE tenant=sync_schedules.tenant AND generation=sync_schedules.generation) AND EXISTS(SELECT 1 FROM tenants WHERE id=sync_schedules.tenant AND deleted=0 AND json_extract(settings,'$.source')='gmail') RETURNING interval_minutes,failures,generation",
        )
        .bind(owner, Date.now() + LEASE_MS, tenantId, Date.now(), Date.now())
        .first<{
          interval_minutes: number;
          failures: number;
          generation: string;
        }>();
      if (!schedule) return;
      claimed++;
      const heartbeat = async () => {
        const renewed = await db
          .prepare(
            "UPDATE sync_schedules SET lease=? WHERE tenant=? AND enabled=1 AND owner=? AND lease>? AND EXISTS(SELECT 1 FROM credentials WHERE tenant=sync_schedules.tenant AND generation=sync_schedules.generation) AND EXISTS(SELECT 1 FROM tenants WHERE id=sync_schedules.tenant AND deleted=0 AND json_extract(settings,'$.source')='gmail')",
          )
          .bind(Date.now() + LEASE_MS, tenantId, owner, Date.now())
          .run();
        if (!renewed.meta.changes)
          throw new ApiError(
            409,
            "Scheduled scan was paused or its ownership changed.",
          );
      };
      try {
        const current = await db
          .prepare(
            "SELECT t.settings,c.email,c.generation FROM tenants t JOIN credentials c ON c.tenant=t.id WHERE t.id=? AND t.deleted=0 AND c.generation=?",
          )
          .bind(tenantId, schedule.generation)
          .first<{ settings: string; email: string; generation: string }>();
        if (!current) throw new ApiError(409, "Gmail connection changed.");
        const tenant = {
          id: tenantId,
          email: "",
          settings: JSON.parse(current.settings),
        };
        const gmail = await clientFor(
          tenant,
          new Request(callback),
          undefined,
          { email: current.email, generation: current.generation },
          { readGuard: heartbeat, maxRetries: 0 },
        );
        const result = await syncGmailPage(
          tenantId,
          gmail,
          { email: current.email, generation: current.generation },
          metadata,
          false,
          { pageSize: 5, guard: heartbeat },
        );
        await heartbeat();
        await refreshGroups(tenant);
        const saved = await db
          .prepare(
            "UPDATE sync_schedules SET status=?,next_due=?,last_success=CASE WHEN ? THEN ? ELSE last_success END,failures=0,last_error=NULL,owner=NULL,lease=0 WHERE tenant=? AND owner=? AND enabled=1 AND lease>?",
          )
          .bind(
            result.complete ? "waiting" : "continuing",
            Date.now() +
              (result.complete ? schedule.interval_minutes * 60000 : 60000),
            Number(result.complete),
            Date.now(),
            tenantId,
            owner,
            Date.now(),
          )
          .run();
        if (saved.meta.changes) completed++;
      } catch (error) {
        if (error instanceof GmailScanBusy) {
          await db
            .prepare(
              "UPDATE sync_schedules SET status='waiting',next_due=?,owner=NULL,lease=0 WHERE tenant=? AND owner=? AND enabled=1 AND lease>?",
            )
            .bind(Date.now() + 60000, tenantId, owner, Date.now())
            .run();
          return;
        }
        failed++;
        const failure = failureCode(error),
          count = schedule.failures + 1;
        const suspended = failure.reauth || count >= 5;
        await db
          .prepare(
            "UPDATE sync_schedules SET enabled=?,status=?,failures=?,last_error=?,next_due=?,owner=NULL,lease=0 WHERE tenant=? AND owner=?",
          )
          .bind(
            Number(!suspended),
            failure.reauth
              ? "reauth_required"
              : suspended
                ? "paused_after_failures"
                : "backoff",
            count,
            failure.code,
            Date.now() + Math.min(60 * 60000, 60000 * 2 ** Math.min(count, 6)),
            tenantId,
            owner,
          )
          .run();
      }
    }),
  );
  await db
    .prepare(
      "UPDATE scheduler_health SET last_completed=? WHERE id='gmail-sync'",
    )
    .bind(Date.now())
    .run();
  return { enabled: true, configured: true, claimed, completed, failed };
}
