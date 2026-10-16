import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  encryptSnapshot,
  restoreSnapshot,
  recoverySchema,
} from "../scripts/recovery-store.mjs";
import { sealRecovery, openRecovery } from "../packages/recovery/envelope.ts";
import {
  appendDeletion,
  collectDeletionJournal,
} from "../packages/recovery/journal.ts";
import { recoveryFixture } from "./fixtures/recovery.mjs";
const namespace = "2f4c53f9-5a91-49dd-bfbe-c0c7384c070c";
const key = Buffer.alloc(32, 7).toString("base64url");
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inbox-recovery-drill-"));
  const source = path.join(dir, "source.sqlite");
  const db = new DatabaseSync(source);
  for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
  for (const id of ["A", "B", "C"]) {
    db.prepare(
      "INSERT INTO tenants(id,settings,created,connection_epoch) VALUES(?,?,?,?)",
    ).run(
      id,
      JSON.stringify({
        source: "gmail",
        privacy: "smart",
        autopilot: "recommend",
        theme: "dark",
        notifications: true,
        protectedSenders: ["safe@example.com"],
      }),
      1,
      4,
    );
    db.prepare(
      "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES(?,?,?,?,?,?)",
    ).run(
      `${id}:message`,
      id,
      "synthetic-message",
      JSON.stringify({ subject: "Synthetic receipt", labels: ["INBOX"] }),
      "KEEP",
      1,
    );
  }
  db.prepare(
    "INSERT INTO credentials(tenant,encrypted,email,updated) VALUES('B','synthetic-secret-marker','test@example.com',1)",
  ).run();
  db.prepare(
    "INSERT INTO plans(id,tenant,source,data,status,created,expires,owner,lease) VALUES('plan','B','gmail','{}','approved',1,9999999999999,'synthetic-owner',9999999999999)",
  ).run();
  db.prepare(
    "INSERT INTO actions(id,tenant,source,kind,data,created,status,owner,lease) VALUES('attempt','B','gmail','trash','{}',1,'attempting','synthetic-owner',9999999999999)",
  ).run();
  db.prepare(
    "INSERT INTO actions(id,tenant,source,kind,data,created,status) VALUES('undo','B','gmail','trash','{}',1,'undoing')",
  ).run();
  db.prepare(
    "INSERT INTO rules(id,tenant,command,compiled,enabled,authorized,created) VALUES('rule','B','keep receipts','{}',1,1,1)",
  ).run();
  db.prepare(
    "INSERT INTO jobs(id,tenant,source,processed,status,updated,owner,lease) VALUES('job','B','gmail',3,'running',1,'synthetic-owner',9999999999999)",
  ).run();
  db.prepare(
    "INSERT INTO ai_consents(tenant,enabled,version,scope,model,epoch,updated) VALUES('B',1,1,'metadata','synthetic-model','synthetic-consent',1)",
  ).run();
  db.close();
  return { dir, source, target: path.join(dir, "restored.sqlite") };
}
test("encrypted isolated restore reapplies account/data erasure and never restores provider authority or queued work", async () => {
  const f = await fixture();
  try {
    const now = Date.now(),
      snapshot = await encryptSnapshot(f.source, namespace, key, now - 1000);
    assert.equal(
      JSON.stringify(snapshot).includes("synthetic-secret-marker"),
      false,
    );
    const plain = await openRecovery(snapshot, key, "snapshot", namespace);
    assert.equal(
      JSON.stringify(plain).includes("synthetic-secret-marker"),
      false,
    );
    const journal = await sealRecovery(
      {
        version: 1,
        namespace,
        observed: now,
        entries: [
          { tenant: "A", kind: "account", generation: 0, at: now - 500 },
          { tenant: "C", kind: "data", generation: 0, at: now - 400 },
        ],
      },
      key,
      "deletions",
      namespace,
    );
    await restoreSnapshot(snapshot, journal, f.target, namespace, key, now);
    assert.equal((await stat(f.target)).mode & 0o777, 0o600);
    const db = new DatabaseSync(f.target, { readOnly: true });
    assert.equal(
      db.prepare("SELECT deleted FROM tenants WHERE id='A'").get().deleted,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM messages WHERE tenant IN ('A','C')")
        .get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM messages WHERE tenant='B'").get().n,
      1,
    );
    const settings = JSON.parse(
      db.prepare("SELECT settings FROM tenants WHERE id='B'").get().settings,
    );
    assert.equal(settings.privacy, "privacy");
    assert.equal(settings.source, "demo");
    assert.equal(settings.autopilot, "off");
    assert.deepEqual(settings.protectedSenders, ["safe@example.com"]);
    assert.equal(
      db.prepare("SELECT status FROM plans").get().status,
      "cancelled",
    );
    assert.equal(db.prepare("SELECT expires FROM plans").get().expires, 0);
    assert.equal(
      db.prepare("SELECT status FROM actions WHERE id='attempt'").get().status,
      "uncertain",
    );
    assert.equal(
      db.prepare("SELECT status FROM actions WHERE id='undo'").get().status,
      "restore_uncertain",
    );
    assert.equal(db.prepare("SELECT enabled FROM rules").get().enabled, 0);
    assert.equal(
      db.prepare("SELECT authorized FROM rules").get().authorized,
      0,
    );
    for (const table of [
      "credentials",
      "oauth_transactions",
      "jobs",
      "sync_schedules",
      "ai_consents",
      "extension_devices",
      "sync_seen",
      "sync_pages",
    ])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    assert.equal(
      db.prepare("SELECT connection_epoch FROM tenants WHERE id='B'").get()
        .connection_epoch,
      5,
    );
    db.close();
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("wrong key/tamper/purpose/namespace/version/stale or missing journal fail before a target exists", async () => {
  const f = await fixture();
  try {
    const now = Date.now(),
      snapshot = await encryptSnapshot(f.source, namespace, key, now - 1000);
    const journal = await sealRecovery(
      { version: 1, namespace, observed: now, entries: [] },
      key,
      "deletions",
      namespace,
    );
    const bad = [
      { ...snapshot, version: 2 },
      { ...snapshot, purpose: "deletions" },
      { ...snapshot, namespace: "7b95f5b0-c6c7-4147-90ae-c911b8a1daf0" },
      {
        ...snapshot,
        ciphertext:
          (snapshot.ciphertext[0] === "A" ? "B" : "A") +
          snapshot.ciphertext.slice(1),
      },
    ];
    for (const s of bad)
      await assert.rejects(
        restoreSnapshot(s, journal, f.target, namespace, key, now),
      );
    await assert.rejects(
      restoreSnapshot(
        snapshot,
        journal,
        f.target,
        namespace,
        Buffer.alloc(32, 8).toString("base64url"),
        now,
      ),
    );
    await assert.rejects(
      restoreSnapshot(snapshot, null, f.target, namespace, key, now),
    );
    const stale = await sealRecovery(
      { version: 1, namespace, observed: now - 500000, entries: [] },
      key,
      "deletions",
      namespace,
    );
    await assert.rejects(
      restoreSnapshot(snapshot, stale, f.target, namespace, key, now),
    );
    await assert.rejects(stat(f.target), { code: "ENOENT" });
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("malformed/orphan snapshot cannot create a target and existing targets are never overwritten", async () => {
  const f = await fixture();
  try {
    const now = Date.now(),
      snapshot = await encryptSnapshot(f.source, namespace, key, now - 1000);
    const plain = await openRecovery(snapshot, key, "snapshot", namespace);
    plain.tables.messages[0].tenant = "nonexistent";
    const malformed = await sealRecovery(plain, key, "snapshot", namespace);
    const journal = await sealRecovery(
      { version: 1, namespace, observed: now, entries: [] },
      key,
      "deletions",
      namespace,
    );
    await assert.rejects(
      restoreSnapshot(malformed, journal, f.target, namespace, key, now),
    );
    await assert.rejects(stat(f.target), { code: "ENOENT" });
    await assert.rejects(
      restoreSnapshot(snapshot, journal, f.source, namespace, key, now),
      { code: "EEXIST" },
    );
    const db = new DatabaseSync(f.source, { readOnly: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM credentials").get().n, 1);
    db.close();
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("data generation blocks receipt-before-snapshot resurrection and preserves post-purge data", async () => {
  const f = await fixture();
  try {
    const now = Date.now(),
      { RECOVERY_JOURNAL: store } = await recoveryFixture();
    await appendDeletion(store, key, namespace, "C", "data", 0, now - 2000);
    const during = await encryptSnapshot(f.source, namespace, key, now - 1500);
    const db = new DatabaseSync(f.source);
    db.exec(
      "BEGIN; DELETE FROM messages WHERE tenant='C'; UPDATE tenants SET data_epoch=data_epoch+1 WHERE id='C'; COMMIT;",
    );
    db.prepare(
      "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES('C:new','C','new','{}','REVIEW',?)",
    ).run(now - 1000);
    db.close();
    const after = await encryptSnapshot(f.source, namespace, key, now - 500);
    const journal = await collectDeletionJournal(
      store,
      key,
      namespace,
      ["A", "B", "C"],
      now,
    );
    await restoreSnapshot(during, journal, f.target, namespace, key, now);
    const old = new DatabaseSync(f.target);
    assert.equal(
      old.prepare("SELECT COUNT(*) n FROM messages WHERE tenant='C'").get().n,
      0,
    );
    old.close();
    const nextTarget = path.join(f.dir, "newer.sqlite");
    await restoreSnapshot(after, journal, nextTarget, namespace, key, now);
    const newer = new DatabaseSync(nextTarget);
    assert.equal(
      newer.prepare("SELECT id FROM messages WHERE tenant='C'").get().id,
      "C:new",
    );
    assert.equal(
      newer.prepare("SELECT data_epoch FROM tenants WHERE id='C'").get()
        .data_epoch,
      2,
    );
    newer.close();
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("restored data generation advances beyond every later erasure receipt", async () => {
  const f = await fixture();
  try {
    const now = Date.now(),
      { RECOVERY_JOURNAL: store } = await recoveryFixture();
    const snapshot = await encryptSnapshot(
      f.source,
      namespace,
      key,
      now - 3000,
    );
    await appendDeletion(store, key, namespace, "C", "data", 0, now - 2000);
    await appendDeletion(store, key, namespace, "C", "data", 1, now - 1000);
    const journal = await collectDeletionJournal(
      store,
      key,
      namespace,
      ["A", "B", "C"],
      now,
    );
    await restoreSnapshot(snapshot, journal, f.target, namespace, key, now);
    const restored = new DatabaseSync(f.target);
    assert.equal(
      restored.prepare("SELECT data_epoch FROM tenants WHERE id='C'").get()
        .data_epoch,
      2,
    );
    restored
      .prepare(
        "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES('C:new','C','new','{}','REVIEW',?)",
      )
      .run(now);
    restored.close();
    const next = await encryptSnapshot(f.target, namespace, key, now);
    const second = path.join(f.dir, "second.sqlite");
    await restoreSnapshot(next, journal, second, namespace, key, now);
    const db = new DatabaseSync(second);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM messages WHERE tenant='C'").get().n,
      1,
    );
    db.close();
    const exhausted = await sealRecovery(
      {
        version: 1,
        namespace,
        observed: now,
        entries: [
          {
            tenant: "C",
            kind: "data",
            generation: Number.MAX_SAFE_INTEGER,
            at: now,
          },
        ],
      },
      key,
      "deletions",
      namespace,
    );
    const rejected = path.join(f.dir, "exhausted.sqlite");
    await assert.rejects(
      restoreSnapshot(snapshot, exhausted, rejected, namespace, key, now),
    );
    await assert.rejects(stat(rejected), { code: "ENOENT" });
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
