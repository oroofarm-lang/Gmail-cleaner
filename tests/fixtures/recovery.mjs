import { initializeJournal } from "../../packages/recovery/journal.ts";
export async function recoveryFixture() {
  const objects = new Map();
  const store = {
    objects,
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    async put(key, value) {
      objects.set(key, value);
      return { key };
    },
    async list({ prefix, cursor, limit }) {
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      const start = Number(cursor || 0),
        page = keys.slice(start, start + limit);
      return {
        objects: page.map((key) => ({ key })),
        truncated: start + page.length < keys.length,
        cursor: String(start + page.length),
      };
    },
  };
  const key = Buffer.alloc(32, 7).toString("base64url"),
    namespace = "2f4c53f9-5a91-49dd-bfbe-c0c7384c070c";
  await initializeJournal(store, key, namespace);
  return {
    RECOVERY_JOURNAL: store,
    INBOX_RECOVERY_KEY: key,
    INBOX_RECOVERY_NAMESPACE: namespace,
  };
}
