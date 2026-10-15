import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  stat,
  writeFile,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  TABLE_COLUMNS,
  validatedRecovery,
} from "../packages/recovery/snapshot.ts";
import { sealRecovery, openRecovery } from "../packages/recovery/envelope.ts";
import { DEFAULT_SETTINGS } from "../lib/demo.ts";
const migrationDirectory = new URL("../drizzle/", import.meta.url);
export async function recoverySchema() {
  const files = (await readdir(migrationDirectory))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    files.map(async (file) => ({
      file,
      sql: await readFile(new URL(file, migrationDirectory), "utf8"),
    })),
  );
  return {
    migrations,
    hash: createHash("sha256").update(JSON.stringify(migrations)).digest("hex"),
  };
}
export async function captureSnapshot(
  databasePath,
  namespace,
  now = Date.now(),
) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("BEGIN");
    const tables = {};
    for (const [table, columns] of Object.entries(TABLE_COLUMNS))
      tables[table] = db
        .prepare(`SELECT ${columns.join(",")} FROM ${table} ORDER BY id`)
        .all();
    db.exec("COMMIT");
    return {
      version: 1,
      namespace,
      created: now,
      schemaHash: (await recoverySchema()).hash,
      tables,
    };
  } finally {
    db.close();
  }
}
export async function encryptSnapshot(
  databasePath,
  namespace,
  key,
  now = Date.now(),
) {
  return sealRecovery(
    await captureSnapshot(databasePath, namespace, now),
    key,
    "snapshot",
    namespace,
  );
}
export async function restoreSnapshot(
  envelope,
  journalEnvelope,
  target,
  namespace,
  key,
  now = Date.now(),
) {
  // Authentication and structural checks complete before creating any target.
  const snapshot = await openRecovery(envelope, key, "snapshot", namespace);
  const journal = await openRecovery(
    journalEnvelope,
    key,
    "deletions",
    namespace,
  );
  const schema = await recoverySchema();
  const {
    snapshot: s,
    erasures,
    generations,
  } = validatedRecovery(snapshot, journal, namespace, schema.hash, now);
  const tenantRows = new Map(s.tables.tenants.map((t) => [t.id, t]));
  const file = await open(target, "wx", 0o600);
  await file.close();
  let db,
    ok = false;
  try {
    db = new DatabaseSync(target);
    for (const { sql } of schema.migrations) db.exec(sql);
    db.exec("BEGIN");
    db.prepare(
      "UPDATE service_admission SET mode='recovery',generation=generation+1,updated=? WHERE id='service'",
    ).run(now);
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      );
      for (const original of s.tables[table]) {
        const row = { ...original };
        const tenant = table === "tenants" ? row.id : row.tenant;
        const erasure = erasures.get(tenant);
        const deleted =
          tenantRows.get(tenant)?.deleted === 1 || erasure === "account";
        if (table !== "tenants" && (deleted || erasure === "data")) continue;
        if (table === "tenants") {
          const previous = JSON.parse(String(row.settings));
          if (
            !previous ||
            typeof previous !== "object" ||
            Array.isArray(previous)
          )
            throw Error("Invalid recovery settings.");
          row.settings = JSON.stringify({
            ...DEFAULT_SETTINGS,
            ...(deleted || erasure === "data" ? {} : previous),
            source: "demo",
            privacy: "privacy",
            autopilot: "off",
          });
          row.deleted = Number(deleted);
          row.connection_epoch = Number(row.connection_epoch) + 1;
          row.data_epoch = generations.get(tenant) + 1;
        }
        if (table === "plans") {
          row.status = "cancelled";
          row.expires = 0;
        }
        if (table === "rules") {
          row.enabled = 0;
          row.authorized = 0;
        }
        if (table === "actions") {
          if (["attempting", "executing", "uncertain"].includes(row.status))
            row.status = "uncertain";
          else if (["undoing", "restore_uncertain"].includes(row.status))
            row.status = "restore_uncertain";
          else if (row.status === "pending") row.status = "failed";
        }
        insert.run(...columns.map((column) => row[column]));
      }
    }
    db.exec("COMMIT");
    ok = true;
    return {
      tenants: s.tables.tenants.length,
      erasures: erasures.size,
      restoredAt: now,
      credentialsRestored: 0,
      permissionsRestored: 0,
    };
  } finally {
    db?.close();
    if (!ok) await unlink(target).catch(() => {});
  }
}
export async function readRecoveryFile(file) {
  if ((await stat(file)).size > 400_000_000)
    throw Error("Recovery file exceeds the verified size limit.");
  return JSON.parse(await readFile(file, "utf8"));
}
export async function writeRecoveryFile(file, envelope) {
  await writeFile(file, JSON.stringify(envelope) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
