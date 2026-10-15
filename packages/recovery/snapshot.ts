import { z } from "zod";
const value = z.union([
  z.string().max(2_000_000),
  z.number().finite(),
  z.null(),
]);
const row = z.record(value);
export const TABLE_COLUMNS = {
  tenants: [
    "id",
    "settings",
    "created",
    "deleted",
    "connection_epoch",
    "data_epoch",
  ],
  mail_groups: [
    "id",
    "tenant",
    "source",
    "sender",
    "address",
    "category",
    "count",
    "bytes",
    "oldest",
    "newest",
    "protected",
    "revision",
    "list_id",
    "status",
  ],
  messages: [
    "id",
    "tenant",
    "gmail_id",
    "metadata",
    "classification",
    "updated",
  ],
  plans: ["id", "tenant", "source", "data", "status", "created", "expires"],
  actions: [
    "id",
    "tenant",
    "source",
    "plan_id",
    "kind",
    "data",
    "created",
    "status",
  ],
  rules: [
    "id",
    "tenant",
    "command",
    "compiled",
    "enabled",
    "authorized",
    "created",
  ],
} as const;
export type SnapshotTable = keyof typeof TABLE_COLUMNS;
export const recoverySnapshotSchema = z
  .object({
    version: z.literal(1),
    namespace: z.string().uuid(),
    created: z.number().int().nonnegative(),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
    tables: z
      .object({
        tenants: z.array(row),
        mail_groups: z.array(row),
        messages: z.array(row),
        plans: z.array(row),
        actions: z.array(row),
        rules: z.array(row),
      })
      .strict(),
  })
  .strict();
export const deletionJournalSchema = z
  .object({
    version: z.literal(1),
    namespace: z.string().uuid(),
    observed: z.number().int().nonnegative(),
    entries: z.array(
      z
        .object({
          tenant: z.string().min(1).max(300),
          kind: z.enum(["account", "data"]),
          generation: z.number().int().nonnegative().safe(),
          at: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export function validatedRecovery(
  snapshot: unknown,
  journal: unknown,
  namespace: string,
  schemaHash: string,
  now = Date.now(),
) {
  const s = recoverySnapshotSchema.parse(snapshot),
    j = deletionJournalSchema.parse(journal);
  if (
    s.namespace !== namespace ||
    j.namespace !== namespace ||
    s.schemaHash !== schemaHash ||
    s.created > now ||
    j.observed < s.created ||
    j.observed > now ||
    now - j.observed > 300000
  )
    throw Error(
      "Recovery requires current authoritative deletion evidence and matching schema/scope.",
    );
  const tenants = new Map<string, { deleted: number; generation: number }>();
  for (const t of s.tables.tenants) {
    if (
      typeof t.id !== "string" ||
      !t.id ||
      tenants.has(t.id) ||
      typeof t.deleted !== "number" ||
      ![0, 1].includes(t.deleted) ||
      !Number.isSafeInteger(t.connection_epoch) ||
      Number(t.connection_epoch) < 0 ||
      Number(t.connection_epoch) >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(t.data_epoch) ||
      Number(t.data_epoch) < 0 ||
      Number(t.data_epoch) >= Number.MAX_SAFE_INTEGER
    )
      throw Error("Invalid recovery tenant.");
    tenants.set(t.id, {
      deleted: Number(t.deleted),
      generation: Number(t.data_epoch),
    });
  }
  const erasures = new Map<string, "account" | "data">();
  const generations = new Map(
    [...tenants].map(([id, t]) => [id, t.generation]),
  );
  for (const e of j.entries) {
    if (e.at > j.observed) throw Error("Invalid deletion chronology.");
    if (tenants.has(e.tenant)) {
      if (e.generation >= Number.MAX_SAFE_INTEGER)
        throw Error("Recovery data generation exhausted.");
      generations.set(
        e.tenant,
        Math.max(generations.get(e.tenant)!, e.generation),
      );
    }
    if (
      e.kind === "account" ||
      (tenants.has(e.tenant) &&
        tenants.get(e.tenant)!.generation <= e.generation)
    ) {
      if (erasures.get(e.tenant) !== "account") erasures.set(e.tenant, e.kind);
    }
  }
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const seen = new Set<string>();
    for (const record of s.tables[table as SnapshotTable]) {
      if (
        Object.keys(record).sort().join(",") !==
          [...columns].sort().join(",") ||
        typeof record.id !== "string" ||
        !record.id ||
        seen.has(record.id)
      )
        throw Error("Invalid recovery row shape/identity.");
      seen.add(record.id);
      if (
        table !== "tenants" &&
        (typeof record.tenant !== "string" || !tenants.has(record.tenant))
      )
        throw Error("Orphaned recovery row.");
      if (
        table !== "tenants" &&
        !["gmail", "demo"].includes(String(record.source)) &&
        table !== "messages" &&
        table !== "rules"
      )
        throw Error("Invalid recovery source.");
    }
  }
  return { snapshot: s, erasures, generations };
}
