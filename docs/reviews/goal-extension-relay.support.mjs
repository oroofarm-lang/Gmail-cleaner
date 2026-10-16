import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  createRelay,
  trustedSender,
  validProjection,
} from "../../apps/extension/relay.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = `export function binding(){return globalThis.__relayReview.db};export function config(k){return globalThis.__relayReview.env[k]};export class ApiError extends Error{constructor(status,m){super(m);this.status=status}}`;
registerHooks({
  resolve(s, c, next) {
    if (s === "./server" && c.parentURL?.endsWith("/lib/extension-relay.ts"))
      return {
        url: "data:text/javascript," + encodeURIComponent(stub),
        shortCircuit: true,
      };
    return next(s, c);
  },
  load(u, c, next) {
    if (u.endsWith("/lib/extension-relay.ts"))
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(fileURLToPath(u), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return next(u, c);
  },
});
const { extensionRelay, relayHash } = await import(
  pathToFileURL(path.join(root, "lib/extension-relay.ts")).href
);
let sql;
const origin = "https://app.example",
  id = "867a5094-73ba-42ee-a41b-54a0f217ba6b",
  nonce = "1".repeat(64);
const input = { id, nonce };
function dbAdapter(sql) {
  return {
    prepare(query) {
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        async run() {
          sql.prepare(query).run(...args);
          return {
            meta: {
              changes: Number(sql.prepare("SELECT changes() n").get().n),
            },
          };
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
      };
    },
  };
}
beforeEach(() => {
  sql?.close();
  sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(path.join(root, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(path.join(root, "drizzle", f), "utf8"));
  for (const tenant of ["A", "B"])
    sql
      .prepare(
        "INSERT INTO tenants(id,settings,created,deleted) VALUES(?,?,?,0)",
      )
      .run(tenant, JSON.stringify({ source: "demo" }), Date.now());
  globalThis.__relayReview = {
    db: dbAdapter(sql),
    env: {
      INBOX_EXTENSION_RELAY: "enabled",
      INBOX_EXTENSION_ID: "a".repeat(32),
      INBOX_EXTENSION_ORIGIN: origin,
    },
  };
});
async function paired() {
  await extensionRelay("A", origin, "start", input);
  await extensionRelay("A", origin, "approve", input);
}
function local() {
  const state = {};
  const storage = {
    get: async (k) => ({ [k]: state[k] }),
    set: async (v) => Object.assign(state, v),
    remove: async (k) => delete state[k],
  };
  return {
    state,
    relay: createRelay(
      storage,
      origin,
      () => id,
      () => nonce,
    ),
  };
}
const sender = { url: origin + "/?view=settings", tab: { id: 7 }, frameId: 0 };
test("independent SQL boundary: synthetic tenant/source separation, hashed secret, authorization invalidation", async () => {
  sql
    .prepare(
      "INSERT INTO mail_groups(id,tenant,source,sender,address,category,count,bytes,oldest,newest,protected) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "demo",
      "A",
      "demo",
      "synthetic",
      "x@example.test",
      "newsletter",
      11,
      11,
      0,
      1,
      1,
    );
  sql
    .prepare(
      "INSERT INTO mail_groups(id,tenant,source,sender,address,category,count,bytes,oldest,newest,protected) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "gmail",
      "A",
      "gmail",
      "synthetic",
      "x@example.test",
      "newsletter",
      999,
      999,
      0,
      1,
      0,
    );
  sql
    .prepare(
      "INSERT INTO mail_groups(id,tenant,source,sender,address,category,count,bytes,oldest,newest,protected) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "foreign",
      "B",
      "demo",
      "synthetic",
      "x@example.test",
      "newsletter",
      777,
      777,
      0,
      1,
      0,
    );
  await paired();
  const p = await extensionRelay("A", origin, "summary", input);
  assert.equal(p.total, 11);
  assert.equal(p.protected, 11);
  assert.equal(p.source, "demo");
  assert.equal(validProjection(p), true);
  const stored = sql.prepare("SELECT * FROM extension_devices").get();
  assert.equal(stored.nonce_hash, await relayHash(nonce));
  assert.equal(Object.values(stored).includes(nonce), false);
  await assert.rejects(extensionRelay("B", origin, "summary", input), {
    status: 403,
  });
  await assert.rejects(
    extensionRelay("A", origin, "summary", { ...input, nonce: "2".repeat(64) }),
    { status: 403 },
  );
  await extensionRelay("B", origin, "revoke", { id });
  assert.equal((await extensionRelay("A", origin, "summary", input)).total, 11);
  sql
    .prepare(
      "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id='A'",
    )
    .run();
  await assert.rejects(extensionRelay("A", origin, "summary", input), {
    status: 403,
  });
});
test("independent local boundary: untrusted senders rejected and simultaneous replay serialized", async () => {
  const { relay } = local();
  for (const attack of [
    { ...sender, frameId: 1 },
    { ...sender, frameId: undefined },
    { ...sender, url: "https://app.example.evil/" },
    { ...sender, url: origin + "/legal/privacy" },
    { ...sender, id: "other-extension" },
    { url: origin + "/" },
  ]) {
    assert.equal(trustedSender(attack, origin), false);
    await assert.rejects(relay({ kind: "hello" }, attack));
  }
  const h = await relay({ kind: "hello" }, sender);
  await paired();
  const p = await extensionRelay("A", origin, "summary", input);
  for (const projection of [
    { ...p, subject: "synthetic" },
    { ...p, total: Infinity },
    { ...p, expires: p.issued + 120001 },
    { ...p, issued: Date.now() + 1000 },
    { ...p, total: 1.2 },
  ])
    await assert.rejects(
      relay({ kind: "summary", id: h.id, nonce: h.nonce, projection }, sender),
    );
  const packet = { kind: "summary", id: h.id, nonce: h.nonce, projection: p };
  const r = await Promise.allSettled([
    relay(packet, sender),
    relay(packet, sender),
  ]);
  assert.deepEqual(
    r.map((x) => x.status),
    ["fulfilled", "rejected"],
  );
  await relay.forget();
  await assert.rejects(relay(packet, sender));
});
test("confirmed original recovery defect: paired local hello survives server epoch invalidation", async () => {
  const { relay } = local();
  await relay({ kind: "hello" }, sender);
  await paired();
  const projection = await extensionRelay("A", origin, "summary", input);
  await relay({ kind: "summary", ...input, projection }, sender);
  sql
    .prepare(
      "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id='A'",
    )
    .run();
  const hello = await relay({ kind: "hello" }, sender);
  assert.equal(hello.paired, true);
  await assert.rejects(extensionRelay("A", origin, "summary", hello), {
    status: 403,
  });
  if (process.env.RELAY_EXPECT_AUTOMATIC_RECOVERY === "1")
    assert.equal(
      hello.paired,
      false,
      "original UI chooses summary rather than fresh start; server rejects the only chosen action",
    );
});
test("expired local projection is hidden but remains stored until Forget: retention disclosure must distinguish these", async () => {
  const { state, relay } = local();
  await relay({ kind: "hello" }, sender);
  await paired();
  const p = await extensionRelay("A", origin, "summary", input);
  await relay({ kind: "summary", ...input, projection: p }, sender);
  assert.equal(validProjection(state.companion.projection, p.expires), false);
  assert.deepEqual(state.companion.projection, p);
  assert.equal(state.companion.nonce, nonce);
});
test("retest: explicit nonce-bound reset rotates challenge and requires fresh approval after invalidation", async () => {
  const state = {};
  let sequence = 0;
  const nextId = () =>
    sequence++ === 0 ? id : "967a5094-73ba-42ee-a41b-54a0f217ba6b";
  const storage = {
    get: async (k) => ({ [k]: state[k] }),
    set: async (v) => Object.assign(state, v),
    remove: async (k) => delete state[k],
  };
  const relay = createRelay(storage, origin, nextId, () =>
    sequence === 1 ? nonce : "2".repeat(64),
  );
  const h = await relay({ kind: "hello" }, sender);
  await paired();
  const projection = await extensionRelay("A", origin, "summary", input);
  const packet = { kind: "summary", ...input, projection };
  await relay(packet, sender);
  sql
    .prepare(
      "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id='A'",
    )
    .run();
  await assert.rejects(
    relay({ kind: "reset", id: h.id, nonce: "3".repeat(64) }, sender),
  );
  await assert.rejects(
    relay(
      { kind: "reset", id: h.id, nonce: h.nonce },
      { ...sender, url: "https://evil.example/" },
    ),
  );
  assert.deepEqual(
    await relay({ kind: "reset", id: h.id, nonce: h.nonce }, sender),
    { reset: true },
  );
  await extensionRelay("A", origin, "revoke", { id: h.id });
  await assert.rejects(relay(packet, sender));
  const fresh = await relay({ kind: "hello" }, sender);
  assert.notEqual(fresh.id, h.id);
  assert.notEqual(fresh.nonce, h.nonce);
  assert.equal(fresh.paired, false);
  await extensionRelay("A", origin, "start", fresh);
  await assert.rejects(extensionRelay("A", origin, "summary", fresh), {
    status: 403,
  });
  await extensionRelay("A", origin, "approve", fresh);
  assert.deepEqual(
    await relay(
      {
        kind: "summary",
        id: fresh.id,
        nonce: fresh.nonce,
        projection: await extensionRelay("A", origin, "summary", fresh),
      },
      sender,
    ),
    { received: true },
  );
});
test("retest: exact pending/active challenge start is idempotent while wrong secret and epoch fail", async () => {
  await extensionRelay("A", origin, "start", input);
  const pending = await extensionRelay("A", origin, "start", input);
  assert.equal(pending.alreadyApproved, false);
  await assert.rejects(
    extensionRelay("A", origin, "start", { ...input, nonce: "3".repeat(64) }),
    { status: 409 },
  );
  await assert.rejects(extensionRelay("B", origin, "start", input), {
    status: 409,
  });
  await extensionRelay("A", origin, "approve", input);
  assert.equal(
    (await extensionRelay("A", origin, "start", input)).alreadyApproved,
    true,
  );
  sql
    .prepare(
      "UPDATE tenants SET connection_epoch=connection_epoch+1 WHERE id='A'",
    )
    .run();
  await assert.rejects(extensionRelay("A", origin, "start", input), {
    status: 409,
  });
});
test("independent SQL expiry/limit/deletion boundaries fail closed", async () => {
  for (let i = 0; i < 10; i++)
    await extensionRelay("A", origin, "start", {
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      nonce,
    });
  await assert.rejects(extensionRelay("A", origin, "start", input), {
    status: 409,
  });
  sql.prepare("UPDATE extension_devices SET expires=0 WHERE tenant='A'").run();
  await paired();
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) n FROM extension_devices WHERE tenant='A'")
      .get().n,
    1,
  );
  sql.prepare("UPDATE extension_devices SET expires=0").run();
  await assert.rejects(extensionRelay("A", origin, "summary", input), {
    status: 403,
  });
  await paired();
  sql.prepare("UPDATE tenants SET deleted=1 WHERE id='A'").run();
  await assert.rejects(extensionRelay("A", origin, "summary", input), {
    status: 403,
  });
});
