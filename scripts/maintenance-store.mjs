import { DatabaseSync } from "node:sqlite";
export function maintenance(databasePath, command, expectedGeneration) {
  if (!["status", "pause", "resume"].includes(command))
    throw Error("Invalid maintenance operation.");
  const db = new DatabaseSync(databasePath, { readOnly: command === "status" });
  try {
    db.exec(command === "status" ? "BEGIN" : "BEGIN IMMEDIATE");
    const current = db
      .prepare(
        "SELECT mode,generation,updated FROM service_admission WHERE id='service'",
      )
      .get();
    if (!current) throw Error("Missing admission state.");
    const active = db
      .prepare(
        "SELECT COUNT(*) count,MIN(started) oldest FROM active_operations",
      )
      .get();
    if (command !== "status") {
      if (
        !Number.isSafeInteger(expectedGeneration) ||
        current.generation !== expectedGeneration ||
        current.generation >= Number.MAX_SAFE_INTEGER
      )
        throw Error("Maintenance generation changed or exhausted.");
      if (command === "pause" && current.mode !== "open")
        throw Error("Only open service can be paused.");
      if (
        command === "resume" &&
        (current.mode !== "paused" || active.count !== 0)
      )
        throw Error(
          "Resume requires an ordinary paused service with no active operations. Restored databases require recovery admission verification.",
        );
      db.prepare(
        "UPDATE service_admission SET mode=?,generation=generation+1,updated=? WHERE id='service'",
      ).run(command === "pause" ? "paused" : "open", Date.now());
    }
    const result = db
      .prepare(
        "SELECT mode,generation,updated FROM service_admission WHERE id='service'",
      )
      .get();
    db.exec("COMMIT");
    return {
      ...result,
      active: active.count,
      oldest: active.oldest,
      drained: result.mode !== "open" && active.count === 0,
    };
  } finally {
    db.close();
  }
}
