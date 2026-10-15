import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  recoverySchema,
  encryptSnapshot,
  restoreSnapshot,
  writeRecoveryFile,
} from "../../scripts/recovery-store.mjs";
import {
  openRecovery,
  sealRecovery,
} from "../../packages/recovery/envelope.ts";
import {
  appendDeletion,
  collectDeletionJournal,
} from "../../packages/recovery/journal.ts";
import { recoveryFixture } from "../../tests/fixtures/recovery.mjs";
const namespace = "2f4c53f9-5a91-49dd-bfbe-c0c7384c070c";
const key = Buffer.alloc(32, 7).toString("base64url");
async function fixture(count = 1) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recovery-independent-"));
  const source = path.join(dir, "source.sqlite");
  const target = path.join(dir, "target.sqlite");
  const db = new DatabaseSync(source);
  for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
  db.prepare(
    "INSERT INTO tenants(id,settings,created,connection_epoch) VALUES(?,?,?,?)",
  ).run(
    "A",
    '{"source":"gmail","privacy":"smart","autopilot":"recommend"}',
    1,
    4,
  );
  db.exec("BEGIN");
  const insert = db.prepare(
    "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES(?,?,?,?,?,?)",
  );
  for (let i = 0; i < count; i++)
    insert.run(
      "A:" + i,
      "A",
      "synthetic:" + i,
      '{"subject":"Synthetic review item"}',
      "KEEP",
      1,
    );
  db.exec("COMMIT");
  db.close();
  return { dir, source, target };
}
async function withFixture(count, callback) {
  const f = await fixture(count);
  try {
    await callback(f);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
}
test("PRIVACY: receipt written before purge must also erase a snapshot captured between the two writes", async () => {
  await withFixture(1, async (f) => {
    const store = (await recoveryFixture()).RECOVERY_JOURNAL;
    const now = Date.now();
    await appendDeletion(store, key, namespace, "A", "data", 0, now - 100);
    // Actual API ordering permits capture after awaited recordDeletion and before db.batch purge.
    const snapshot = await encryptSnapshot(f.source, namespace, key, now - 50);
    const live = new DatabaseSync(f.source);
    live.exec("BEGIN");
    live.prepare("DELETE FROM messages WHERE tenant=?").run("A");
    live
      .prepare("UPDATE tenants SET data_epoch=data_epoch+1 WHERE id=?")
      .run("A");
    live.exec("COMMIT");
    live.close();
    const journal = await collectDeletionJournal(
      store,
      key,
      namespace,
      ["A"],
      now,
    );
    await restoreSnapshot(snapshot, journal, f.target, namespace, key, now);
    const restored = new DatabaseSync(f.target, { readOnly: true });
    const count = restored.prepare("SELECT COUNT(*) n FROM messages").get().n;
    restored.close();
    console.log(
      JSON.stringify({
        scenario: "receipt-before-snapshot-before-purge",
        restoredMessages: count,
      }),
    );
    assert.equal(
      count,
      0,
      "A completed deletion must not resurrect in recovery",
    );
  });
});
test("20,001-message inventory preserves row count and restores with 0600 permissions", async () => {
  await withFixture(20001, async (f) => {
    const now = Date.now();
    const start = performance.now();
    const snapshot = await encryptSnapshot(f.source, namespace, key, now - 100);
    const journal = await sealRecovery(
      { version: 1, namespace, observed: now, entries: [] },
      key,
      "deletions",
      namespace,
    );
    await restoreSnapshot(snapshot, journal, f.target, namespace, key, now);
    assert.equal((await stat(f.target)).mode & 0o777, 0o600);
    const db = new DatabaseSync(f.target, { readOnly: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 20001);
    db.close();
    console.log(
      JSON.stringify({
        scenario: "large-inventory",
        rows: 20001,
        elapsedMs: Math.round(performance.now() - start),
        ciphertextCharacters: snapshot.ciphertext.length,
      }),
    );
  });
});
test("1,005 receipts require multiple pages; missing, duplicate and cycling listings fail closed", async () => {
  const store = (await recoveryFixture()).RECOVERY_JOURNAL;
  const now = Date.now();
  for (let i = 0; i < 1005; i++)
    await appendDeletion(store, key, namespace, "A", "data", 0, now - 100);
  const journal = await collectDeletionJournal(
    store,
    key,
    namespace,
    ["A"],
    now,
  );
  const plain = await openRecovery(journal, key, "deletions", namespace);
  assert.equal(plain.entries.length, 1005);
  await assert.rejects(
    collectDeletionJournal(
      {
        ...store,
        list: async () => ({ objects: [], truncated: true, cursor: "repeat" }),
      },
      key,
      namespace,
      ["A"],
      now,
    ),
  );
  const original = store.list.bind(store);
  await assert.rejects(
    collectDeletionJournal(
      {
        ...store,
        list: async (options) => {
          const page = await original(options);
          return { ...page, objects: [...page.objects, page.objects[0]] };
        },
      },
      key,
      namespace,
      ["A"],
      now,
    ),
  );
  await assert.rejects(
    collectDeletionJournal(
      {
        ...store,
        get: async (k) => (k.endsWith("/root") ? store.get(k) : null),
      },
      key,
      namespace,
      ["A"],
      now,
    ),
  );
});
test("authenticated payload tamper fails before target; invalid settings cleanup removes target; existing files/symlinks stay intact", async () => {
  await withFixture(1, async (f) => {
    const now = Date.now();
    const snapshot = await encryptSnapshot(f.source, namespace, key, now - 100);
    const journal = await sealRecovery(
      { version: 1, namespace, observed: now, entries: [] },
      key,
      "deletions",
      namespace,
    );
    await assert.rejects(
      restoreSnapshot(
        { ...snapshot, iv: "AAAAAAAAAAAAAAAA" },
        journal,
        f.target,
        namespace,
        key,
        now,
      ),
    );
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    const plain = await openRecovery(snapshot, key, "snapshot", namespace);
    plain.tables.tenants[0].settings = "null";
    const malformed = await sealRecovery(plain, key, "snapshot", namespace);
    await assert.rejects(
      restoreSnapshot(malformed, journal, f.target, namespace, key, now),
    );
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    const file = path.join(f.dir, "existing-envelope");
    await writeFile(file, "do-not-overwrite");
    await assert.rejects(writeRecoveryFile(file, snapshot), { code: "EEXIST" });
    assert.equal(await readFile(file, "utf8"), "do-not-overwrite");
    const { symlink } = await import("node:fs/promises");
    await symlink(f.source, f.target);
    await assert.rejects(
      restoreSnapshot(snapshot, journal, f.target, namespace, key, now),
      { code: "EEXIST" },
    );
    assert.equal((await stat(f.source)).size > 0, true);
  });
});

test("new post-purge generation survives historical data receipt while account receipt remains terminal", async () => {
  await withFixture(1, async (f) => {
    const store = (await recoveryFixture()).RECOVERY_JOURNAL;
    const now = Date.now();
    await appendDeletion(store, key, namespace, "A", "data", 0, now - 200);
    const live = new DatabaseSync(f.source);
    live.exec("BEGIN");
    live.prepare("DELETE FROM messages WHERE tenant=?").run("A");
    live
      .prepare("UPDATE tenants SET data_epoch=data_epoch+1 WHERE id=?")
      .run("A");
    live.exec("COMMIT");
    live
      .prepare(
        "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES(?,?,?,?,?,?)",
      )
      .run("new:A", "A", "synthetic-new", "{}", "KEEP", now - 100);
    live.close();
    const snapshot = await encryptSnapshot(f.source, namespace, key, now - 50);
    const journal = await collectDeletionJournal(
      store,
      key,
      namespace,
      ["A"],
      now,
    );
    await restoreSnapshot(snapshot, journal, f.target, namespace, key, now);
    const restored = new DatabaseSync(f.target, { readOnly: true });
    assert.equal(
      restored.prepare("SELECT gmail_id FROM messages").get().gmail_id,
      "synthetic-new",
    );
    assert.equal(
      restored.prepare("SELECT data_epoch FROM tenants").get().data_epoch,
      2,
    );
    restored.close();
    await appendDeletion(store, key, namespace, "A", "account", 0, now);
    const terminal = await collectDeletionJournal(
      store,
      key,
      namespace,
      ["A"],
      now,
    );
    const other = path.join(f.dir, "terminal.sqlite");
    await restoreSnapshot(snapshot, terminal, other, namespace, key, now);
    const dead = new DatabaseSync(other, { readOnly: true });
    assert.equal(dead.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
    assert.equal(dead.prepare("SELECT deleted FROM tenants").get().deleted, 1);
    dead.close();
  });
});
test("missing/uninitialized/wrong-key journal and failed durable receipt writes reject", async () => {
  const env = await recoveryFixture(),
    store = env.RECOVERY_JOURNAL,
    now = Date.now();
  await assert.rejects(
    appendDeletion(
      { ...store, get: async () => null },
      key,
      namespace,
      "A",
      "data",
      0,
      now,
    ),
  );
  await assert.rejects(
    appendDeletion(
      store,
      Buffer.alloc(32, 8).toString("base64url"),
      namespace,
      "A",
      "data",
      0,
      now,
    ),
  );
  await assert.rejects(
    appendDeletion(
      { ...store, put: async () => null },
      key,
      namespace,
      "A",
      "data",
      0,
      now,
    ),
  );
  await assert.rejects(
    appendDeletion(
      {
        ...store,
        put: async () => {
          throw Error("synthetic outage");
        },
      },
      key,
      namespace,
      "A",
      "data",
      0,
      now,
    ),
  );
  await assert.rejects(
    appendDeletion(store, key, namespace, "A", "data", -1, now),
  );
});
