import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { recoverySchema } from "../../scripts/recovery-store.mjs";
import { purgeExpiredRecords } from "../../packages/operations/retention.ts";
const db = new DatabaseSync(":memory:");
for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
const queries = [];
const d1 = {
  prepare(sql) {
    queries.push(sql);
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
  async batch(s) {
    db.exec("BEGIN");
    try {
      const r = s.map((x) => x.execute());
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
for (const [id, status, expires, lease] of [
  ["boundary", "pending", 100, 100],
  ["live", "pending", 101, 0],
  ["executing", "executing", 0, 0],
  ["partial", "partial", 0, 0],
  ["leased", "cancelled", 0, 101],
])
  db.prepare(
    "INSERT INTO plans(id,tenant,source,data,status,created,expires,lease) VALUES(?,'A','gmail','{}',?,0,?,?)",
  ).run(id, status, expires, lease);
assert.equal((await purgeExpiredRecords(d1, 100)).plans, 1);
assert.deepEqual(
  db
    .prepare("SELECT id FROM plans ORDER BY id")
    .all()
    .map((x) => x.id),
  ["executing", "leased", "live", "partial"],
);
for (const now of [-1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
  await assert.rejects(purgeExpiredRecords(d1, now));
// Mutate after candidate selection but before transactional deletion.
for (const id of ["renewed", "racing-action", "racing-lease", "racing-status"])
  db.prepare(
    "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,'A','gmail','{}','pending',0,1)",
  ).run(id);
const originalBatch = d1.batch;
d1.batch = async function (statements) {
  db.exec(
    "UPDATE plans SET expires=1000 WHERE id='renewed'; UPDATE plans SET lease=1000 WHERE id='racing-lease'; UPDATE plans SET status='executing' WHERE id='racing-status'; INSERT INTO actions(id,tenant,source,plan_id,kind,data,created,status) VALUES('race','A','gmail','racing-action','trash','{}',0,'uncertain');",
  );
  return originalBatch.call(this, statements);
};
assert.equal((await purgeExpiredRecords(d1, 100)).plans, 0);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) n FROM plans WHERE id IN ('renewed','racing-action','racing-lease','racing-status')",
    )
    .get().n,
  4,
);
d1.batch = originalBatch;
const planSql = queries.find((s) => s.startsWith("DELETE FROM plans"));
console.log(
  "EXPLAIN:",
  db.prepare("EXPLAIN QUERY PLAN " + planSql).all("[]", 100, 100),
);
const selectSql = queries.find((s) =>
  s.startsWith("SELECT id,expires FROM plans"),
);
const selectionPlan = db
  .prepare("EXPLAIN QUERY PLAN " + selectSql)
  .all(100, -1, "", 100);
assert.ok(
  selectionPlan.some((r) => /COVERING INDEX plans_expiry/.test(r.detail)),
);
assert.ok(selectionPlan.every((r) => !/TEMP B-TREE/.test(r.detail)));
console.log("CANDIDATE EXPLAIN:", selectionPlan);
console.log(
  "PASS: inclusive expiry/lease boundary, live/executing/partial/leased preservation, invalid clocks",
);
db.close();
