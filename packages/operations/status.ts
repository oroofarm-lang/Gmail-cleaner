const LIMIT = 101;
const MAX_AGE = 15 * 60_000;
type Counts = { n: number };
function count(row: Counts | null) {
  const value = Number(row?.n ?? 0);
  return { count: Math.min(value, 100), capped: value > 100 };
}
/** Operator-only aggregate diagnostics. No provider calls or tenant/content fields. */
export async function operationsStatus(
  db: D1Database,
  options: { scheduler: boolean; retention: boolean },
  now = Date.now(),
) {
  if (!Number.isSafeInteger(now) || now < 0)
    throw Error("Invalid monitoring clock.");
  const [
    scheduler,
    retention,
    uncertain,
    interrupted,
    active,
    oldest,
    oauth,
    plans,
    devices,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT last_tick,last_completed FROM scheduler_health WHERE id='gmail-sync'",
      )
      .first<{ last_tick: number; last_completed: number | null }>(),
    db
      .prepare(
        "SELECT last_started,last_completed,status FROM retention_health WHERE id='ephemeral'",
      )
      .first<{
        last_started: number;
        last_completed: number | null;
        status: string;
      }>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM actions WHERE status IN ('uncertain','restore_uncertain') LIMIT ?)",
      )
      .bind(LIMIT)
      .first<Counts>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM actions WHERE status IN ('pending','attempting','restoring') AND lease<=? LIMIT ?)",
      )
      .bind(now, LIMIT)
      .first<Counts>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM active_operations LIMIT ?)",
      )
      .bind(LIMIT)
      .first<Counts>(),
    db
      .prepare("SELECT started FROM active_operations ORDER BY started LIMIT 1")
      .first<{ started: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM oauth_transactions WHERE expires<=? LIMIT ?)",
      )
      .bind(now, LIMIT)
      .first<Counts>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM plans WHERE expires<=? LIMIT ?)",
      )
      .bind(now, LIMIT)
      .first<Counts>(),
    db
      .prepare(
        "SELECT COUNT(*) n FROM (SELECT 1 FROM extension_devices WHERE expires<=? LIMIT ?)",
      )
      .bind(now, LIMIT)
      .first<Counts>(),
  ]);
  const fresh = (value: number | null | undefined) =>
    Number.isSafeInteger(value) &&
    Number(value) <= now &&
    now - Number(value) < MAX_AGE;
  const schedulerHealthy =
    !options.scheduler ||
    (!!scheduler &&
      fresh(scheduler.last_tick) &&
      fresh(scheduler.last_completed));
  const retentionHealthy =
    !options.retention ||
    (!!retention &&
      retention.status === "completed" &&
      fresh(retention.last_completed) &&
      retention.last_started <= now);
  const issues: string[] = [];
  if (!schedulerHealthy) issues.push("scheduler_stale_or_incomplete");
  if (!retentionHealthy) issues.push("retention_stale_or_incomplete");
  if (Number(uncertain?.n) > 0) issues.push("uncertain_actions_require_review");
  if (Number(interrupted?.n) > 0)
    issues.push("expired_action_ownership_requires_review");
  if (
    oldest &&
    (!Number.isSafeInteger(oldest.started) ||
      oldest.started > now ||
      now - oldest.started > MAX_AGE)
  )
    issues.push("admission_ticket_requires_investigation");
  return {
    version: 1,
    status: issues.length ? "attention" : "ok",
    releaseReadiness: "not_assessed",
    observed: now,
    issues,
    scheduler: { enabled: options.scheduler, healthy: schedulerHealthy },
    retention: { enabled: options.retention, healthy: retentionHealthy },
    actions: { uncertain: count(uncertain), interrupted: count(interrupted) },
    admission: { active: count(active), includesStatusRequest: true },
    expired: {
      oauth: count(oauth),
      plans: count(plans),
      devices: count(devices),
    },
  };
}
