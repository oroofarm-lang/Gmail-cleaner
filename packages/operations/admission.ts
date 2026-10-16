/** Persistent drain tickets have no timeout: a crashed worker requires investigation. */
export class AdmissionUnavailable extends Error {}
export async function withAdmission<T>(
  db: D1Database,
  kind: "request" | "scheduler",
  work: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  const admitted = await db
    .prepare(
      "INSERT INTO active_operations(id,kind,started,generation) SELECT ?,?,?,generation FROM service_admission WHERE id='service' AND mode='open'",
    )
    .bind(id, kind, Date.now())
    .run();
  if (admitted.meta.changes !== 1)
    throw new AdmissionUnavailable(
      "Service is paused for maintenance. Please try again later.",
    );
  try {
    return await work();
  } finally {
    // Failed release leaves a durable blocker. Never infer completion from age.
    await db.prepare("DELETE FROM active_operations WHERE id=?").bind(id).run();
  }
}
