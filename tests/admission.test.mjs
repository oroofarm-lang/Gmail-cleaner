import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  recoverySchema,
  encryptSnapshot,
  restoreSnapshot,
} from "../scripts/recovery-store.mjs";
import { maintenance } from "../scripts/maintenance-store.mjs";
import { withAdmission } from "../packages/operations/admission.ts";
import { sealRecovery } from "../packages/recovery/envelope.ts";
function adapter(db) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async run() {
          return {
            meta: { changes: Number(db.prepare(sql).run(...args).changes) },
          };
        },
      };
    },
  };
}
test("pause atomically closes admission, drains existing work and never expires interrupted tickets", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inbox-admission-")),
    file = path.join(dir, "source.sqlite");
  const db = new DatabaseSync(file);
  try {
    for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
    const d1 = adapter(db);
    let finish, entered;
    const started = new Promise((r) => (entered = r)),
      held = new Promise((r) => (finish = r));
    const work = withAdmission(d1, "request", async () => {
      entered();
      await held;
      return "completed";
    });
    await started;
    assert.equal(maintenance(file, "pause", 0).drained, false);
    let called = false;
    await assert.rejects(
      withAdmission(d1, "scheduler", async () => {
        called = true;
      }),
    );
    assert.equal(called, false);
    assert.throws(() => maintenance(file, "resume", 1));
    finish();
    assert.equal(await work, "completed");
    assert.equal(maintenance(file, "status").drained, true);
    assert.throws(() => maintenance(file, "resume", 0));
    assert.equal(maintenance(file, "resume", 1).mode, "open");
    await assert.rejects(
      withAdmission(d1, "request", async () => {
        throw Error("synthetic failure");
      }),
    );
    assert.equal(maintenance(file, "status").active, 0);
    db.prepare(
      "INSERT INTO active_operations VALUES('interrupted','request',0,2)",
    ).run();
    assert.equal(maintenance(file, "pause", 2).drained, false);
    assert.throws(() => maintenance(file, "resume", 3));
    assert.equal(maintenance(file, "status").active, 1);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("restored database remains closed even with no active tickets and cannot use ordinary resume", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inbox-restored-admission-")),
    source = path.join(dir, "source.sqlite"),
    target = path.join(dir, "target.sqlite");
  const db = new DatabaseSync(source);
  const namespace = "2f4c53f9-5a91-49dd-bfbe-c0c7384c070c",
    key = Buffer.alloc(32, 7).toString("base64url");
  try {
    for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
    const now = Date.now(),
      snapshot = await encryptSnapshot(source, namespace, key, now);
    const journal = await sealRecovery(
      { version: 1, namespace, observed: now, entries: [] },
      key,
      "deletions",
      namespace,
    );
    await restoreSnapshot(snapshot, journal, target, namespace, key, now);
    const status = maintenance(target, "status");
    assert.equal(status.mode, "recovery");
    assert.equal(status.drained, true);
    assert.throws(() => maintenance(target, "resume", status.generation));
    const restored = new DatabaseSync(target);
    try {
      await assert.rejects(
        withAdmission(adapter(restored), "request", async () =>
          assert.fail("must not admit"),
        ),
      );
    } finally {
      restored.close();
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
