import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { recoverySchema } from "../scripts/recovery-store.mjs";
import { purgeExpiredRecords } from "../packages/operations/retention.ts";
async function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
  const d1 = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...args) };
        },
        execute() {
          return {
            meta: { changes: Number(db.prepare(sql).run(...args).changes) },
          };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, d1 };
}
test("bounded expiry purge preserves action/Undo evidence, active work and fresh credentials", async () => {
  const { db, d1 } = await fixture();
  try {
    for (let i = 0; i < 205; i++) {
      db.prepare(
        "INSERT INTO oauth_transactions(state,tenant,verifier,expires) VALUES(?,?,?,?)",
      ).run(`old${i}`, i % 2 ? "A" : "B", "synthetic", 99);
      db.prepare(
        "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,?,'gmail','{}','pending',1,99)",
      ).run(`old${i}`, i % 2 ? "A" : "B");
      db.prepare(
        "INSERT INTO extension_devices(id,tenant,nonce_hash,connection_epoch,status,created,expires) VALUES(?,?,'synthetic',0,'pending',1,99)",
      ).run(`old${i}`, i % 2 ? "A" : "B");
    }
    for (const status of [
      "uncertain",
      "restore_uncertain",
      "success",
      "undone",
      "attempting",
      "restoring",
    ]) {
      db.prepare(
        "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,'A','gmail','{}','cancelled',1,99)",
      ).run(status);
      db.prepare(
        "INSERT INTO actions(id,tenant,source,plan_id,kind,data,created,status) VALUES(?,'A','gmail',?,'trash','{}',1,?)",
      ).run(status, status, status);
    }
    db.exec(
      "INSERT INTO plans VALUES('executing','A','gmail','{}','executing',1,99,'owner',0); INSERT INTO plans VALUES('leased','A','gmail','{}','pending',1,99,'owner',1000); INSERT INTO oauth_transactions(state,tenant,verifier,expires) VALUES('fresh','A','synthetic',101); INSERT INTO credentials VALUES('A','synthetic','readonly','a@example.com',1,'generation'); INSERT INTO active_operations VALUES('crashed','request',0,0);",
    );
    const total = { oauth: 0, plans: 0, devices: 0 };
    for (let i = 0; i < 4; i++) {
      const counts = await purgeExpiredRecords(d1, 100);
      for (const field of Object.keys(total)) {
        assert.ok(counts[field] <= 100);
        total[field] += counts[field];
      }
    }
    assert.deepEqual(total, { oauth: 205, plans: 205, devices: 205 });
    assert.deepEqual(await purgeExpiredRecords(d1, 100), {
      oauth: 0,
      plans: 0,
      devices: 0,
    });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM actions").get().n, 6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plans").get().n, 8);
    for (const table of [
      "credentials",
      "active_operations",
      "oauth_transactions",
    ])
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1);
  } finally {
    db.close();
  }
});
test("expiry is evaluated at atomic execution and partial errors roll back the purge", async () => {
  const { db, d1 } = await fixture();
  try {
    db.exec(
      "INSERT INTO oauth_transactions(state,tenant,verifier,expires) VALUES('expired','A','synthetic',1); INSERT INTO extension_devices VALUES('refreshed','A','synthetic',0,'active',1,1);",
    );
    db.prepare(
      "UPDATE extension_devices SET expires=1000 WHERE id='refreshed'",
    ).run();
    assert.equal((await purgeExpiredRecords(d1, 100)).devices, 0);
    db.exec(
      "INSERT INTO oauth_transactions(state,tenant,verifier,expires) VALUES('rollback','A','synthetic',1); DROP TABLE extension_devices;",
    );
    await assert.rejects(purgeExpiredRecords(d1, 100));
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM oauth_transactions WHERE state='rollback'",
        )
        .get().n,
      1,
    );
    await assert.rejects(purgeExpiredRecords(d1, NaN));
  } finally {
    db.close();
  }
});

test("bounded keyset cursor progresses past retained plans and safely tolerates overlapping runs", async () => {
  const { db, d1 } = await fixture();
  try {
    for (let i = 0; i < 205; i++)
      db.prepare(
        "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,'A','gmail','{}','executing',1,1)",
      ).run(`keep${String(i).padStart(3, "0")}`);
    db.prepare(
      "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES('z-delete','B','gmail','{}','pending',1,1)",
    ).run();
    assert.equal((await purgeExpiredRecords(d1, 100)).plans, 0);
    assert.equal(
      db.prepare("SELECT row_id FROM retention_cursors").get().row_id,
      "keep099",
    );
    await Promise.all([
      purgeExpiredRecords(d1, 100),
      purgeExpiredRecords(d1, 100),
    ]);
    assert.equal(
      db.prepare("SELECT row_id FROM retention_cursors").get().row_id,
      "keep199",
    );
    assert.equal((await purgeExpiredRecords(d1, 100)).plans, 1);
    assert.equal(
      db.prepare("SELECT expires FROM retention_cursors").get().expires,
      -1,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plans").get().n, 205);
  } finally {
    db.close();
  }
});
