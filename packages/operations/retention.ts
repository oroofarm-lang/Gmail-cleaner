const BATCH_SIZE = 100;
/** Only expired ephemeral records; never mail, action evidence, consent or drain tickets. */
export async function purgeExpiredRecords(db: D1Database, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0)
    throw Error("Invalid retention clock.");
  const cursor = await db
    .prepare(
      "SELECT expires,row_id,revision FROM retention_cursors WHERE id='plans'",
    )
    .first<{ expires: number; row_id: string; revision: string }>();
  if (!cursor) throw Error("Retention cursor unavailable.");
  const candidates = (
    await db
      .prepare(
        "SELECT id,expires FROM plans WHERE expires<=? AND (expires,id)>(?,?) ORDER BY expires,id LIMIT ?",
      )
      .bind(now, cursor.expires, cursor.row_id, BATCH_SIZE)
      .all<{ id: string; expires: number }>()
  ).results;
  const last =
    candidates.length === BATCH_SIZE
      ? candidates.at(-1)!
      : { id: "", expires: -1 };
  const result = await db.batch([
    db
      .prepare(
        "DELETE FROM oauth_transactions WHERE state IN (SELECT state FROM oauth_transactions WHERE expires<=? ORDER BY expires,state LIMIT ?)",
      )
      .bind(now, BATCH_SIZE),
    db
      .prepare(
        "DELETE FROM plans WHERE id IN (SELECT value FROM json_each(?)) AND expires<=? AND status IN ('pending','approved','cancelled','failed','expired') AND lease<=? AND NOT EXISTS(SELECT 1 FROM actions a WHERE a.plan_id=plans.id)",
      )
      .bind(JSON.stringify(candidates.map((row) => row.id)), now, now),
    db
      .prepare(
        "DELETE FROM extension_devices WHERE id IN (SELECT id FROM extension_devices WHERE expires<=? ORDER BY expires,id LIMIT ?)",
      )
      .bind(now, BATCH_SIZE),
    db
      .prepare(
        "UPDATE retention_cursors SET expires=?,row_id=?,revision=? WHERE id='plans' AND revision=?",
      )
      .bind(last.expires, last.id, crypto.randomUUID(), cursor.revision),
  ]);
  return {
    oauth: result[0].meta.changes,
    plans: result[1].meta.changes,
    devices: result[2].meta.changes,
  };
}
