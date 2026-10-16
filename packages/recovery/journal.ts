import { z } from "zod";
import { sealRecovery, openRecovery } from "./envelope.ts";
export interface JournalStore {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  list(options: { prefix: string; cursor?: string; limit: number }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}
const receipt = z
  .object({
    version: z.literal(1),
    namespace: z.string().uuid(),
    observed: z.number().int().nonnegative(),
    entries: z
      .array(
        z
          .object({
            tenant: z.string().min(1).max(300),
            kind: z.enum(["account", "data"]),
            generation: z.number().int().nonnegative().safe(),
            at: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();
const rootKey = (namespace: string) => `recovery/v1/${namespace}/root`;
async function verifyStore(
  store: JournalStore,
  key: string,
  namespace: string,
) {
  const root = await store.get(rootKey(namespace));
  if (!root) throw Error("Recovery journal is not initialized.");
  const marker = (await openRecovery(
    JSON.parse(await root.text()),
    key,
    "deletions",
    namespace,
  )) as { role?: string };
  if (marker.role !== "journal-root") throw Error("Wrong recovery store.");
}
export async function initializeJournal(
  store: JournalStore,
  key: string,
  namespace: string,
) {
  if (await store.get(rootKey(namespace))) {
    await verifyStore(store, key, namespace);
    return;
  }
  const envelope = await sealRecovery(
    { role: "journal-root", namespace, version: 1 },
    key,
    "deletions",
    namespace,
  );
  if (!(await store.put(rootKey(namespace), JSON.stringify(envelope))))
    throw Error("Recovery store initialization failed.");
  await verifyStore(store, key, namespace);
}
async function tenantPrefix(tenant: string, namespace: string) {
  z.string().min(1).max(300).parse(tenant);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}:${tenant}`),
    ),
  );
  return `recovery/v1/${namespace}/deletions/${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}/`;
}
export async function appendDeletion(
  store: JournalStore,
  key: string,
  namespace: string,
  tenant: string,
  kind: "account" | "data",
  generation: number,
  now = Date.now(),
) {
  await verifyStore(store, key, namespace);
  const data = receipt.parse({
    version: 1,
    namespace,
    observed: now,
    entries: [{ tenant, kind, generation, at: now }],
  });
  const envelope = await sealRecovery(data, key, "deletions", namespace);
  const objectKey =
    (await tenantPrefix(tenant, namespace)) + crypto.randomUUID();
  if (!(await store.put(objectKey, JSON.stringify(envelope))))
    throw Error("Deletion receipt was not durably stored.");
  return objectKey;
}
export async function collectDeletionJournal(
  store: JournalStore,
  key: string,
  namespace: string,
  tenants: string[],
  now = Date.now(),
) {
  await verifyStore(store, key, namespace);
  const entries: {
    tenant: string;
    kind: "account" | "data";
    generation: number;
    at: number;
  }[] = [];
  for (const tenant of new Set(tenants)) {
    const prefix = await tenantPrefix(tenant, namespace);
    let cursor: string | undefined;
    const visited = new Set<string>();
    const keys = new Set<string>();
    do {
      const page = await store.list({ prefix, cursor, limit: 1000 });
      for (const object of page.objects) {
        if (!object.key.startsWith(prefix) || keys.has(object.key))
          throw Error("Invalid deletion listing.");
        keys.add(object.key);
        const stored = await store.get(object.key);
        if (!stored) throw Error("Deletion receipt missing.");
        const parsed = receipt.parse(
          await openRecovery(
            JSON.parse(await stored.text()),
            key,
            "deletions",
            namespace,
          ),
        );
        if (
          parsed.entries[0].tenant !== tenant ||
          parsed.observed > now ||
          parsed.entries[0].at > parsed.observed
        )
          throw Error("Invalid deletion receipt scope/time.");
        entries.push(parsed.entries[0]);
      }
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && (!cursor || visited.has(cursor)))
        throw Error("Incomplete deletion listing.");
      if (cursor) visited.add(cursor);
    } while (cursor);
  }
  return sealRecovery(
    { version: 1, namespace, observed: now, entries },
    key,
    "deletions",
    namespace,
  );
}
