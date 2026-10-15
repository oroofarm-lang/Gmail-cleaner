import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withAdmission } from "../../packages/operations/admission.ts";
import { recoverySchema } from "../../scripts/recovery-store.mjs";
import { maintenance } from "../../scripts/maintenance-store.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function adapter(db, hooks = {}) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async run() {
          await hooks.before?.(sql);
          return {
            meta: { changes: Number(db.prepare(sql).run(...args).changes) },
          };
        },
      };
    },
  };
}
async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "review-admission-"));
  const file = path.join(dir, "db.sqlite");
  const db = new DatabaseSync(file);
  try {
    for (const { sql } of (await recoverySchema()).migrations) db.exec(sql);
    await fn(db, file);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test("several concurrent tickets must all finish before drain; failed work releases only itself", () =>
  fixture(async (db, file) => {
    const held = [deferred(), deferred(), deferred()];
    const entered = [deferred(), deferred(), deferred()];
    const work = held.map((h, i) =>
      withAdmission(
        adapter(db),
        i === 2 ? "scheduler" : "request",
        async () => {
          entered[i].resolve();
          await h.promise;
          if (i === 0) throw Error("unit fails");
          return i;
        },
      ),
    );
    const settled = Promise.allSettled(work);
    await Promise.all(entered.map((e) => e.promise));
    assert.equal(maintenance(file, "pause", 0).active, 3);
    held[0].resolve();
    await assert.rejects(work[0]);
    assert.equal(maintenance(file, "status").active, 2);
    assert.throws(() => maintenance(file, "resume", 1));
    held[1].resolve();
    await work[1];
    assert.equal(maintenance(file, "status").drained, false);
    held[2].resolve();
    await settled;
    assert.equal(maintenance(file, "status").drained, true);
  }));
test("admission delayed until after pause never enters; insertion failure never invokes work", () =>
  fixture(async (db, file) => {
    const gate = deferred(),
      start = deferred();
    let called = false;
    const pending = withAdmission(
      adapter(db, {
        before: async (sql) => {
          if (sql.startsWith("INSERT")) {
            start.resolve();
            await gate.promise;
          }
        },
      }),
      "request",
      async () => {
        called = true;
      },
    );
    await start.promise;
    assert.equal(maintenance(file, "pause", 0).drained, true);
    gate.resolve();
    await assert.rejects(pending);
    assert.equal(called, false);
    maintenance(file, "resume", 1);
    await assert.rejects(
      withAdmission(
        adapter(db, {
          before: async () => {
            throw Error("DB unavailable");
          },
        }),
        "request",
        async () => {
          called = true;
        },
      ),
    );
    assert.equal(called, false);
  }));
test("release database failure retains a durable ticket and blocks resume", () =>
  fixture(async (db, file) => {
    await assert.rejects(
      withAdmission(
        adapter(db, {
          before: async (sql) => {
            if (sql.startsWith("DELETE")) throw Error("release unavailable");
          },
        }),
        "scheduler",
        async () => 42,
      ),
    );
    assert.equal(maintenance(file, "pause", 0).active, 1);
    assert.throws(() => maintenance(file, "resume", 1));
    assert.equal(maintenance(file, "status").drained, false);
  }));
