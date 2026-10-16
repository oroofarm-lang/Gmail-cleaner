import { ApiError, binding, config } from "./server";
import { operationsStatus } from "@/packages/operations/status";
export async function operatorStatus(userId: string) {
  const configured = config("INBOX_OPERATOR_USER_ID");
  if (!configured || configured !== userId)
    throw new ApiError(403, "Operator access is unavailable.");
  return operationsStatus(binding(), {
    scheduler: config("GMAIL_SYNC_SCHEDULER") === "enabled",
    retention: config("INBOX_RETENTION") === "enabled",
  });
}
export async function applicationHealth() {
  const db = binding();
  const cursor = await db
    .prepare("SELECT revision FROM retention_cursors WHERE id='plans'")
    .first();
  await db.prepare("SELECT status FROM retention_health LIMIT 1").first();
  if (!cursor) throw new ApiError(503, "Application schema is unavailable.");
  return {
    status: "ok",
    service: "inbox-agent",
    database: true,
    scope: "application-database",
    providerVerification: "not_assessed",
  };
}
