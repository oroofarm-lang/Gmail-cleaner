import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { recoverySchema } from "../scripts/recovery-store.mjs";
import { operationsStatus } from "../packages/operations/status.ts";
import { emitOperationalEvent } from "../packages/operations/telemetry.ts";
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
      };
    },
  };
  return { db, d1 };
}
test("operator status detects missing, stale, future and incomplete scheduled work", async () => {
  const { db, d1 } = await fixture(),
    now = Date.now();
  try {
    assert.equal(
      (await operationsStatus(d1, { scheduler: true, retention: true }, now))
        .status,
      "attention",
    );
    db.prepare("INSERT INTO scheduler_health VALUES('gmail-sync',?,?)").run(
      now,
      now,
    );
    db.prepare(
      "INSERT INTO retention_health VALUES('ephemeral',?,?,'completed')",
    ).run(now, now);
    const healthy = await operationsStatus(
      d1,
      { scheduler: true, retention: true },
      now,
    );
    assert.equal(healthy.status, "ok");
    assert.equal(healthy.releaseReadiness, "not_assessed");
    db.prepare("UPDATE scheduler_health SET last_tick=?").run(now + 1);
    db.exec("UPDATE retention_health SET status='failed'");
    assert.equal(
      (await operationsStatus(d1, { scheduler: true, retention: true }, now))
        .issues.length,
      2,
    );
    db.prepare("UPDATE scheduler_health SET last_tick=?,last_completed=?").run(
      now,
      now - 16 * 60000,
    );
    db.prepare(
      "UPDATE retention_health SET status='completed',last_completed=?",
    ).run(now - 16 * 60000);
    assert.equal(
      (await operationsStatus(d1, { scheduler: true, retention: true }, now))
        .status,
      "attention",
    );
    await assert.rejects(
      operationsStatus(d1, { scheduler: false, retention: false }, NaN),
    );
  } finally {
    db.close();
  }
});
test("diagnostics cap aggregate counts and never return tenant, mail, action ID or error data", async () => {
  const { db, d1 } = await fixture(),
    now = Date.now();
  try {
    for (let i = 0; i < 125; i++)
      db.prepare(
        "INSERT INTO actions(id,tenant,source,kind,data,created,status) VALUES(?,?,'gmail','trash',?,1,'uncertain')",
      ).run(
        `sensitive-action-${i}`,
        "sensitive-tenant",
        JSON.stringify({
          subject: "sensitive-mail",
          email: "private@example.com",
        }),
      );
    db.prepare(
      "INSERT INTO active_operations VALUES('sensitive-ticket','request',?,0)",
    ).run(now - 16 * 60000);
    const result = await operationsStatus(
      d1,
      { scheduler: false, retention: false },
      now,
    );
    assert.deepEqual(result.actions.uncertain, { count: 100, capped: true });
    assert.ok(
      result.issues.includes("admission_ticket_requires_investigation"),
    );
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
    assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  } finally {
    db.close();
  }
});
test("operational events accept only fixed event codes and cannot serialize error objects", () => {
  const logs = [],
    id = emitOperationalEvent("api_failure", (line) => logs.push(line));
  const event = JSON.parse(logs[0]);
  assert.equal(event.id, id);
  assert.deepEqual(Object.keys(event).sort(), ["at", "event", "id", "version"]);
  assert.throws(() =>
    emitOperationalEvent("private@example.com", (line) => logs.push(line)),
  );
  assert.throws(() =>
    emitOperationalEvent({ name: "sensitive" }, (line) => logs.push(line)),
  );
  assert.equal(logs.length, 1);
});
