import assert from "node:assert/strict";
import { operationsStatus } from "../../packages/operations/status.ts";
const now = 2_000_000;
for (const bad of [null, now + 1, now - 900000]) {
  const db = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("scheduler_health"))
            return { last_tick: now, last_completed: bad };
          if (sql.includes("retention_health"))
            return {
              last_started: now,
              last_completed: bad,
              status: "completed",
            };
          if (sql.includes("SELECT started")) return null;
          return { n: 0 };
        },
      };
    },
  };
  const r = await operationsStatus(
    db,
    { scheduler: true, retention: true },
    now,
  );
  assert.equal(r.scheduler.healthy, false);
  assert.equal(r.retention.healthy, false);
  assert.equal(r.status, "attention");
}
console.log(
  "PASS: null, future and exactly-15-minute-old completion timestamps fail closed for both jobs.",
);
const { readFile } = await import("node:fs/promises");
const ts = (await import("typescript")).default;
const { emitOperationalEvent } =
  await import("../../packages/operations/telemetry.ts");
const workerText = await readFile(
  new URL("../../build/sites-worker.ts", import.meta.url),
  "utf8",
);
let emitted = [];
globalThis.__operationsReview = {
  emitOperationalEvent: (e) =>
    emitOperationalEvent(e, (line) => emitted.push(line)),
  runRetention: async () => ({}),
  runGmailScheduler: async () => {
    throw Error("private@example.com sensitive-mail");
  },
  handler: {},
  runWithConnectorBinding: () => {},
};
const js = ts
  .transpileModule(workerText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace(/^import .*?;\n/gm, "");
const worker = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      "const {emitOperationalEvent,runRetention,runGmailScheduler,handler,runWithConnectorBinding}=globalThis.__operationsReview;\n" +
        js,
    ).toString("base64")
);
let pending;
worker.default.scheduled({}, {}, { waitUntil: (p) => (pending = p) });
await assert.rejects(pending, { message: "Scheduled processing failed." });
assert.equal(emitted.length, 1);
assert.equal(JSON.parse(emitted[0]).event, "scheduled_failure");
assert.equal(emitted[0].includes("private"), false);
delete globalThis.__operationsReview;
console.log(
  "PASS: actual native scheduled rejection branch emits one fixed event and throws a fixed error without provider payload.",
);
