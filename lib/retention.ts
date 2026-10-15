import { binding, config } from "./server";
import { withAdmission } from "@/packages/operations/admission";
import { purgeExpiredRecords } from "@/packages/operations/retention";
export async function runRetention() {
  if (config("INBOX_RETENTION") !== "enabled") return { enabled: false };
  const db = binding();
  return withAdmission(db, "scheduler", async () => {
    const started = Date.now();
    await db
      .prepare(
        "INSERT INTO retention_health(id,last_started,status) VALUES('ephemeral',?,'running') ON CONFLICT(id) DO UPDATE SET last_started=MAX(last_started,excluded.last_started),status='running'",
      )
      .bind(started)
      .run();
    try {
      const counts = await purgeExpiredRecords(db, started);
      await db
        .prepare(
          "UPDATE retention_health SET last_completed=?,status='completed' WHERE id='ephemeral' AND last_started=?",
        )
        .bind(Date.now(), started)
        .run();
      return { enabled: true, ...counts };
    } catch {
      await db
        .prepare(
          "UPDATE retention_health SET status='failed' WHERE id='ephemeral' AND last_started=?",
        )
        .bind(started)
        .run();
      throw Error("Ephemeral retention failed.");
    }
  });
}
