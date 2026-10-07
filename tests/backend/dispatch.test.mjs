import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
const authSource =
  "export async function getChatGPTUser(){return globalThis.__backend.user}";
const envSource = "export const env=globalThis.__backend.env";
const gmailSource = `export { GmailClient, GmailMutationNotDispatched, headerValue, hasAttachmentOrUncertainty } from '${pathToFileURL(path.join(root, "packages/integrations/gmail.ts")).href}';
export const interpretCommand=()=>{},OpenAIClassifier=class {};
export async function decryptTokens(){if(globalThis.__backend.decryptHook)await globalThis.__backend.decryptHook();return {access_token:'synthetic-old-account-token',expires_in:3600,refresh_token:'synthetic-refresh'}}
export async function encryptTokens(){return 'encrypted-test-token'}
export async function revokeGoogleToken(){}
export async function exchangeGoogleCode(){return {access_token:'new-test-token',refresh_token:'test-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.modify'}}
export const createOAuthTransaction=()=>({state:'new-synthetic-state',verifier:'synthetic-verifier',challenge:'synthetic-challenge',expiresAt:Date.now()+600000});
export const buildGoogleAuthorizationUrl=()=> 'https://accounts.google.com/o/oauth2/v2/auth';
export const refreshGoogleToken=()=>{};`;
globalThis.__backend = { env: {}, user: null, gmail: null };
registerHooks({
  resolve(specifier, context, next) {
    const source =
      specifier === "cloudflare:workers"
        ? envSource
        : specifier === "@/app/chatgpt-auth"
          ? authSource
          : specifier === "@/packages/integrations"
            ? gmailSource
            : null;
    if (source)
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    if (specifier.startsWith("@/")) {
      let target = path.join(root, specifier.slice(2));
      target = existsSync(`${target}.ts`)
        ? `${target}.ts`
        : path.join(target, "index.ts");
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const target = fileURLToPath(new URL(specifier, context.parentURL));
      if (existsSync(`${target}.ts`))
        return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts"))
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { POST, GET } = await import(
  pathToFileURL(path.join(root, "app/api/[...path]/route.ts")).href
);
let sqlite;
function d1(db) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        execute() {
          const statement = db.prepare(sql);
          const rows = statement.all(...values);
          return {
            results: rows,
            meta: { changes: Number(db.prepare("SELECT changes() n").get().n) },
          };
        },
        async all() {
          return this.execute();
        },
        async first() {
          if (globalThis.__backend.beforeQuery)
            await globalThis.__backend.beforeQuery(sql);
          return this.execute().results[0] ?? null;
        },
        async run() {
          if (globalThis.__backend.beforeRun)
            await globalThis.__backend.beforeRun(sql);
          return this.execute();
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
const schema = `CREATE TABLE tenants(id TEXT PRIMARY KEY,settings TEXT NOT NULL,created INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mail_groups(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source TEXT NOT NULL,sender TEXT NOT NULL,address TEXT NOT NULL,category TEXT NOT NULL,count INTEGER NOT NULL,bytes INTEGER NOT NULL,oldest INTEGER NOT NULL,newest INTEGER NOT NULL,protected INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,list_id TEXT,status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE plans(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE actions(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source TEXT NOT NULL,plan_id TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL);
CREATE TABLE rules(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,command TEXT NOT NULL,compiled TEXT NOT NULL,enabled INTEGER NOT NULL,authorized INTEGER NOT NULL,created INTEGER NOT NULL);
CREATE TABLE credentials(tenant TEXT PRIMARY KEY,encrypted TEXT NOT NULL,email TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE oauth_transactions(state TEXT PRIMARY KEY,tenant TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE jobs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source TEXT NOT NULL,cursor TEXT,processed INTEGER NOT NULL,status TEXT NOT NULL,history_id TEXT,updated INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0);
CREATE TABLE messages(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,gmail_id TEXT NOT NULL,metadata TEXT NOT NULL,classification TEXT NOT NULL,updated INTEGER NOT NULL);`;
beforeEach(() => {
  delete globalThis.__backend.env.GMAIL_SYNC_SCHEDULER;
  delete globalThis.__backend.env.GOOGLE_REDIRECT_URI;
  globalThis.__backend.beforeQuery = null;
  globalThis.__backend.beforeRun = null;
  globalThis.__backend.decryptHook = null;
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  const migrations = readdirSync(path.join(root, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (migrations.length)
    for (const file of migrations)
      sqlite.exec(readFileSync(path.join(root, "drizzle", file), "utf8"));
  else sqlite.exec(schema);
  Object.assign(globalThis.__backend.env, {
    DB: d1(sqlite),
    GOOGLE_CLIENT_ID: "test-id",
    GOOGLE_CLIENT_SECRET: "test-secret",
    TOKEN_ENCRYPTION_KEY: "test-key",
  });
  globalThis.__backend.user = { userId: "A", email: "a@example.com" };
});
async function request(endpoint, body, tenant = "A", options = {}) {
  globalThis.__backend.user = tenant
    ? { userId: tenant, email: `${tenant.toLowerCase()}@example.com` }
    : null;
  const method = body === undefined ? "GET" : "POST";
  const req = new Request(`https://app.example/api/${endpoint}`, {
    method,
    headers: {
      origin: "https://app.example",
      "content-type": "application/json",
      ...options.headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const response = await (method === "POST" ? POST : GET)(req);
  return {
    status: response.status,
    data: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : { location: response.headers.get("location") },
  };
}
async function demo(tenant = "A") {
  return (await request("demo", {}, tenant)).data;
}
function liveMessage(id = "m1", changes = {}) {
  return {
    id,
    threadId: "t1",
    internalDate: String(Date.now() - 400 * 86400000),
    sizeEstimate: 1000,
    labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "offers@shop.example" },
        { name: "Subject", value: "Seasonal sale" },
      ],
    },
    ...changes,
  };
}
async function setupLive() {
  await demo();
  const settings = JSON.parse(
    sqlite.prepare("SELECT settings FROM tenants WHERE id=?").get("A").settings,
  );
  sqlite
    .prepare("UPDATE tenants SET settings=? WHERE id=?")
    .run(JSON.stringify({ ...settings, source: "gmail" }), "A");
  sqlite
    .prepare(
      "INSERT INTO credentials(tenant,encrypted,email,updated) VALUES(?,?,?,?)",
    )
    .run("A", "encrypted", "a@gmail.example", Date.now());
  const mailbox = new Map([["m1", liveMessage()]]);
  const calls = [];
  globalThis.__backend.gmail = {
    async getMessage(id) {
      return structuredClone(mailbox.get(id));
    },
    async getSafetyMessage(id) {
      return structuredClone(mailbox.get(id));
    },
    async getThread() {
      return {
        id: "t1",
        messages: [{ id: "m1", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }],
      };
    },
    async trashMessage(id) {
      calls.push(["trash", id]);
      mailbox.get(id).labelIds = ["CATEGORY_PROMOTIONS", "TRASH"];
    },
    async archiveMessage(id) {
      calls.push(["archive", id]);
      mailbox.get(id).labelIds = ["CATEGORY_PROMOTIONS"];
    },
    async untrashMessage(id) {
      calls.push(["undo", id]);
      mailbox.get(id).labelIds = ["CATEGORY_PROMOTIONS"];
    },
    async restoreInbox(id) {
      mailbox.get(id).labelIds.push("INBOX");
    },
  };
  const message = mailbox.get("m1");
  const metadata = {
    id: "m1",
    threadId: "t1",
    sender: "offers@shop.example",
    subject: "Seasonal sale",
    labels: message.labelIds,
    date: Number(message.internalDate),
    size: 1000,
    replied: false,
    attachment: false,
  };
  sqlite
    .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)")
    .run(
      "A:m1",
      "A",
      "m1",
      JSON.stringify(metadata),
      JSON.stringify({ category: "promotion", action: "TRASH" }),
      Date.now(),
    );
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url),
      parts = parsed.pathname.split("/");
    const id = parts[parts.indexOf("messages") + 1];
    if (options.method === "GET") {
      if (parsed.pathname.includes("/threads/"))
        return Response.json(await globalThis.__backend.gmail.getThread());
      return Response.json(
        await globalThis.__backend.gmail.getSafetyMessage(id),
      );
    }
    if (globalThis.__backend.dispatchHook)
      await globalThis.__backend.dispatchHook(url, options);
    if (parsed.pathname.endsWith("/trash"))
      await globalThis.__backend.gmail.trashMessage(id);
    else if (parsed.pathname.endsWith("/untrash"))
      await globalThis.__backend.gmail.untrashMessage(id);
    else {
      calls.push(["restoreInbox", id]);
      await globalThis.__backend.gmail.restoreInbox(id);
    }
    return Response.json(mailbox.get(id));
  };
  globalThis.__backend.dispatchHook = null;
  return { mailbox, calls };
}
async function cleanupPlan() {
  const fixture = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  assert.equal(plan.status, 200);
  return { ...fixture, plan };
}
function stateAction(plan) {
  return sqlite
    .prepare("SELECT * FROM actions WHERE plan_id=?")
    .get(plan.data.id);
}
function gate() {
  let release, arrive;
  return {
    wait: new Promise((r) => (release = r)),
    entered: new Promise((r) => (arrive = r)),
    release: () => release(),
    arrive: () => arrive(),
  };
}

test("actual adapter: expired cleanup cannot dispatch after reconcile, and pending action cannot Undo", async () => {
  const { plan, calls } = await cleanupPlan();
  const g = gate();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 3) {
      g.arrive();
      await g.wait;
    }
  };
  const task = request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  await g.entered;
  const real = Date.now;
  Date.now = () => real() + 120001;
  try {
    assert.equal((await request("gmail/reconcile", {})).status, 200);
    const a = stateAction(plan);
    assert.equal(a.status, "failed");
    assert.equal((await request("gmail/undo", { actionId: a.id })).status, 409);
    g.release();
    await task;
    assert.equal(calls.length, 0);
  } finally {
    g.release();
    await task;
    Date.now = real;
  }
});

test("actual adapter: newly starred at mutation token wait cannot dispatch or acquire Undo provenance", async () => {
  const { plan, calls, mailbox } = await cleanupPlan();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 3) mailbox.get("m1").labelIds.push("STARRED");
  };
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  assert.equal(calls.length, 0);
  const a = stateAction(plan);
  assert.equal(a.status, "failed");
  assert.equal((await request("gmail/undo", { actionId: a.id })).status, 409);
});

test("actual adapter: response lost enters uncertain, explicit exact Undo restores and duplicate blocked", async () => {
  const { plan, calls, mailbox } = await cleanupPlan();
  globalThis.__backend.dispatchHook = async (url) => {
    if (url.endsWith("/trash")) {
      calls.push(["trash-response-lost", "m1"]);
      mailbox.get("m1").labelIds = ["TRASH", "CATEGORY_PROMOTIONS"];
      throw new Error("synthetic response loss");
    }
  };
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const a = stateAction(plan);
  assert.equal(a.status, "uncertain");
  globalThis.__backend.dispatchHook = null;
  assert.equal((await request("gmail/undo", { actionId: a.id })).status, 200);
  assert.ok(mailbox.get("m1").labelIds.includes("INBOX"));
  assert.equal(
    sqlite.prepare("SELECT status FROM actions WHERE id=?").get(a.id).status,
    "undone",
  );
  assert.equal((await request("gmail/undo", { actionId: a.id })).status, 409);
  assert.equal(calls.filter((c) => c[0] === "trash-response-lost").length, 1);
});

test("actual adapter: disconnect without reconnect during mutation token wait suppresses Undo", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const a = stateAction(plan),
    g = gate();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 2) {
      g.arrive();
      await g.wait;
    }
  };
  const task = request("gmail/undo", { actionId: a.id });
  await g.entered;
  const before = calls.length;
  await request("gmail/disconnect", {});
  g.release();
  assert.equal((await task).status, 503);
  assert.equal(calls.length, before);
});

test("actual adapter: disconnect and replacement account block captured-token Undo", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const a = stateAction(plan),
    g = gate();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 2) {
      g.arrive();
      await g.wait;
    }
  };
  const task = request("gmail/undo", { actionId: a.id });
  await g.entered;
  const before = calls.length;
  await request("gmail/disconnect", {});
  sqlite
    .prepare(
      "INSERT INTO credentials(tenant,encrypted,email,updated) VALUES(?,?,?,?)",
    )
    .run("A", "replacement-encrypted", "replacement@gmail.example", Date.now());
  let dispatched = null;
  globalThis.__backend.dispatchHook = async (url, options) => {
    dispatched = { url, authorization: options.headers.Authorization };
  };
  g.release();
  const result = await task;
  assert.equal(calls.length, before);
  assert.equal(dispatched, null);
  assert.equal(result.status, 503);
});

test("actual adapter: expired Undo token completion cannot mutate after reconcile and successor Undo", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const a = stateAction(plan),
    g = gate();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 2) {
      g.arrive();
      await g.wait;
    }
  };
  const task = request("gmail/undo", { actionId: a.id });
  await g.entered;
  const real = Date.now;
  Date.now = () => real() + 120001;
  try {
    assert.equal((await request("gmail/reconcile", {})).status, 200);
    globalThis.__backend.decryptHook = null;
    assert.equal((await request("gmail/undo", { actionId: a.id })).status, 200);
    const before = calls.length;
    g.release();
    await task;
    assert.equal(calls.length, before);
    assert.equal(
      sqlite.prepare("SELECT status FROM actions WHERE id=?").get(a.id).status,
      "undone",
    );
  } finally {
    g.release();
    await task;
    Date.now = real;
  }
});

test("actual adapter: same-account generation replacement suppresses stale Undo", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const a = stateAction(plan),
    g = gate();
  let tokens = 0;
  globalThis.__backend.decryptHook = async () => {
    if (++tokens === 2) {
      g.arrive();
      await g.wait;
    }
  };
  const task = request("gmail/undo", { actionId: a.id });
  await g.entered;
  const before = calls.length;
  sqlite
    .prepare(
      "UPDATE credentials SET generation='new-connection' WHERE tenant='A'",
    )
    .run();
  g.release();
  assert.equal((await task).status, 503);
  assert.equal(calls.length, before);
});

test("actual adapter: completed action cannot restore a different connected mailbox", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = stateAction(plan);
  const before = calls.length;
  await request("gmail/disconnect", {});
  sqlite
    .prepare(
      "INSERT INTO credentials(tenant,encrypted,email,updated,generation) VALUES('A','synthetic-new','different@gmail.example',?,'new-mailbox')",
    )
    .run(Date.now());
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    409,
  );
  assert.equal(calls.length, before);
});

test("actual adapter: account swap between action lookup and Undo client cannot dispatch", async () => {
  const { plan, calls } = await cleanupPlan();
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = stateAction(plan),
    before = calls.length;
  let swapped = false;
  globalThis.__backend.beforeQuery = async (sql) => {
    if (
      !swapped &&
      sql.startsWith("SELECT email,generation FROM credentials")
    ) {
      swapped = true;
      sqlite
        .prepare("UPDATE credentials SET email=?,generation=? WHERE tenant=?")
        .run("replacement@gmail.example", "new-generation", "A");
    }
  };
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    409,
  );
  assert.equal(calls.length, before);
  assert.equal(
    sqlite.prepare("SELECT status FROM actions WHERE id=?").get(action.id)
      .status,
    "success",
  );
});

test("actual adapter: consumed OAuth callback cannot reconnect after completed disconnect", async () => {
  await setupLive();
  sqlite
    .prepare(
      "INSERT INTO oauth_transactions(state,tenant,verifier,expires,epoch) VALUES(?,?,?,?,?)",
    )
    .run("synthetic-state", "A", "synthetic-verifier", Date.now() + 600000, 0);
  const g = gate(),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith("/profile")) {
      g.arrive();
      await g.wait;
      return Response.json({
        emailAddress: "a@gmail.example",
        messagesTotal: 1,
        threadsTotal: 1,
        historyId: "1",
      });
    }
    return originalFetch(url, options);
  };
  const task = request(
    "oauth/callback?state=synthetic-state&code=synthetic-code",
  );
  await g.entered;
  assert.equal((await request("gmail/disconnect", {})).status, 200);
  g.release();
  assert.equal((await task).status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM credentials").get().n, 0);
  assert.equal(
    JSON.parse(
      sqlite.prepare("SELECT settings FROM tenants WHERE id=?").get("A")
        .settings,
    ).source,
    "demo",
  );
});

test("actual adapter: connection replacement during final attempting CAS prevents dispatch", async () => {
  const { plan, calls } = await cleanupPlan();
  let replaced = false;
  globalThis.__backend.beforeRun = async (sql) => {
    if (
      !replaced &&
      sql.startsWith("UPDATE actions SET status='attempting',data=?")
    ) {
      replaced = true;
      sqlite
        .prepare("UPDATE credentials SET generation=? WHERE tenant=?")
        .run("new-final-generation", "A");
    }
  };
  const result = await request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(replaced, true);
  assert.equal(result.data.total, 0);
  assert.equal(calls.length, 0);
  assert.equal(stateAction(plan).status, "failed");
});

async function pendingCallback(profileEmail = "replacement@gmail.example") {
  await setupLive();
  sqlite
    .prepare(
      "INSERT INTO oauth_transactions(state,tenant,verifier,expires,epoch) VALUES(?,?,?,?,?)",
    )
    .run("older-state", "A", "synthetic-verifier", Date.now() + 600000, 0);
  const g = gate(),
    original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith("/profile")) {
      g.arrive();
      await g.wait;
      return Response.json({
        emailAddress: profileEmail,
        messagesTotal: 1,
        threadsTotal: 1,
        historyId: "1",
      });
    }
    return original(url, options);
  };
  const task = request("oauth/callback?state=older-state&code=synthetic-code");
  await g.entered;
  return { task, g };
}
test("actual adapter: newer OAuth intent fences older callback without clearing inventory", async () => {
  const { task, g } = await pendingCallback();
  assert.equal((await request("oauth/start")).status, 302);
  g.release();
  assert.equal((await task).status, 409);
  assert.equal(
    sqlite.prepare("SELECT email FROM credentials WHERE tenant=?").get("A")
      .email,
    "a@gmail.example",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?").get("A").n,
    1,
  );
  assert.ok(
    sqlite
      .prepare("SELECT state FROM oauth_transactions WHERE state=?")
      .get("new-synthetic-state"),
  );
});
test("actual adapter: deleted tenant fences consumed OAuth callback commit", async () => {
  const { task, g } = await pendingCallback();
  sqlite.prepare("UPDATE tenants SET deleted=1 WHERE id=?").run("A");
  g.release();
  assert.equal((await task).status, 409);
  assert.equal(
    sqlite.prepare("SELECT email FROM credentials WHERE tenant=?").get("A")
      .email,
    "a@gmail.example",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?").get("A").n,
    1,
  );
});
test("actual adapter: current OAuth intent connects and rotates generation without overwriting preferences", async () => {
  const { task, g } = await pendingCallback("a@gmail.example");
  const before = sqlite
    .prepare("SELECT generation FROM credentials")
    .get().generation;
  sqlite
    .prepare(
      "UPDATE tenants SET settings=json_set(settings,'$.protectedSenders',json(?)) WHERE id=?",
    )
    .run(JSON.stringify(["preserve@example.com"]), "A");
  g.release();
  assert.equal((await task).status, 302);
  assert.notEqual(
    sqlite.prepare("SELECT generation FROM credentials").get().generation,
    before,
  );
  const settings = JSON.parse(
    sqlite.prepare("SELECT settings FROM tenants WHERE id=?").get("A").settings,
  );
  assert.equal(settings.source, "gmail");
  assert.deepEqual(settings.protectedSenders, ["preserve@example.com"]);
});

async function syncFixture() {
  const fixture = await setupLive();
  const original = globalThis.fetch;
  const control = {
    lists: [],
    histories: [],
    profile: "100",
    list: async () => ({ messages: [{ id: "m1" }] }),
    history: async () => ({ history: [], historyId: "100" }),
    messageHook: null,
  };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(options.method, "GET", "sync must issue only GET requests");
    if (parsed.pathname.endsWith("/profile"))
      return Response.json({
        emailAddress: "a@gmail.example",
        historyId: control.profile,
      });
    if (parsed.pathname.endsWith("/messages")) {
      control.lists.push(parsed.searchParams);
      const response = await control.list(parsed.searchParams);
      return response instanceof Response ? response : Response.json(response);
    }
    if (parsed.pathname.endsWith("/history")) {
      control.histories.push(parsed.searchParams);
      const response = await control.history(parsed.searchParams);
      return response instanceof Response ? response : Response.json(response);
    }
    const id = parsed.pathname.split("/messages/")[1];
    if (id && control.messageHook) await control.messageHook(id);
    if (id && !fixture.mailbox.has(id))
      return Response.json({ error: {} }, { status: 404 });
    return original(url, options);
  };
  return { ...fixture, control };
}
test("actual sync: full pages prune vanished inventory only at completion, then catch up history", async () => {
  const { control, mailbox } = await syncFixture();
  mailbox.set("m2", liveMessage("m2"));
  control.list = async (params) =>
    params.get("pageToken") === "opaque"
      ? { messages: [{ id: "m2" }] }
      : { messages: [{ id: "m1" }], nextPageToken: "opaque" };
  sqlite
    .prepare("UPDATE messages SET gmail_id=?,id=? WHERE tenant=?")
    .run("old", "A:old", "A");
  let result = await request("gmail/scan", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.complete, false);
  assert.ok(sqlite.prepare("SELECT id FROM messages WHERE id=?").get("A:old"));
  result = await request("gmail/scan", {});
  assert.equal(result.data.complete, false);
  assert.equal(
    sqlite.prepare("SELECT id FROM messages WHERE id=?").get("A:old"),
    undefined,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n, 2);
  assert.equal((await request("gmail/scan", {})).data.complete, true);
  assert.equal(control.lists[0].get("includeSpamTrash"), "true");
  assert.equal(control.histories[0].get("startHistoryId"), "100");
});
test("actual sync: incremental additions, labels and deletions refresh current metadata without relisting", async () => {
  const { control, mailbox } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  mailbox.set("m2", liveMessage("m2", { labelIds: ["INBOX", "STARRED"] }));
  mailbox.delete("m1");
  control.history = async () => ({
    history: [
      {
        id: "101",
        messagesAdded: [{ message: { id: "m2" } }],
        labelsAdded: [{ message: { id: "m2" }, labelIds: ["STARRED"] }],
        messagesDeleted: [{ message: { id: "m1" } }],
      },
    ],
    historyId: "105",
  });
  const result = await request("gmail/scan", {});
  assert.equal(result.data.complete, true);
  assert.equal(control.lists.length, 1);
  assert.equal(
    sqlite.prepare("SELECT id FROM messages WHERE id=?").get("A:m1"),
    undefined,
  );
  assert.equal(
    JSON.parse(
      sqlite
        .prepare("SELECT classification FROM messages WHERE id=?")
        .get("A:m2").classification,
    ).action,
    "KEEP",
  );
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    "105",
  );
});
test("actual sync: history page over25 IDs resumes without advancing its checkpoint early", async () => {
  const { control, mailbox } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  const ids = Array.from({ length: 31 }, (_, i) => "new" + i);
  for (const id of ids) mailbox.set(id, liveMessage(id));
  control.history = async () => ({
    history: [
      { id: "110", messagesAdded: ids.map((id) => ({ message: { id } })) },
    ],
    historyId: "111",
  });
  const before = control.histories.length;
  assert.equal((await request("gmail/scan", {})).data.complete, false);
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    "100",
  );
  assert.equal((await request("gmail/scan", {})).data.complete, true);
  assert.equal(control.histories.length, before + 1);
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    "111",
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n, 32);
});
test("actual sync: expired history resets full scan and retains inventory until completed sweep", async () => {
  const { control } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  control.profile = "200";
  control.history = async () => Response.json({ error: {} }, { status: 404 });
  const result = await request("gmail/scan", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.resync, true);
  assert.equal(result.data.complete, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    null,
  );
  assert.equal(
    JSON.parse(sqlite.prepare("SELECT cursor FROM jobs").get().cursor).baseline,
    "200",
  );
});
test("actual sync: failed metadata fetch commits neither new rows nor cursor", async () => {
  const { control, mailbox } = await syncFixture();
  mailbox.set("m2", liveMessage("m2"));
  control.list = async () => ({ messages: [{ id: "m2" }, { id: "broken" }] });
  control.messageHook = async (id) => {
    if (id === "broken") throw new Error("synthetic read failure");
  };
  assert.equal((await request("gmail/scan", {})).status, 503);
  assert.equal(
    sqlite.prepare("SELECT id FROM messages WHERE id=?").get("A:m2"),
    undefined,
  );
  assert.equal(sqlite.prepare("SELECT cursor FROM jobs").get().cursor, null);
  control.messageHook = null;
  assert.equal((await request("gmail/scan", {})).status, 200);
});
test("actual sync: repeated history page token fails without checkpoint advancement", async () => {
  const { control } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  control.history = async () => ({
    history: [],
    historyId: "110",
    nextPageToken: "repeat",
  });
  assert.equal((await request("gmail/scan", {})).status, 200);
  assert.equal((await request("gmail/scan", {})).status, 502);
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    "100",
  );
});

test("actual sync: explicit restart recovers repeated cursor without deleting current inventory early", async () => {
  const { control } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  control.history = async () => ({
    history: [],
    historyId: "110",
    nextPageToken: "repeat",
  });
  await request("gmail/scan", {});
  assert.equal((await request("gmail/scan", {})).status, 502);
  const result = await request("gmail/scan", { restart: true });
  assert.equal(result.status, 200);
  assert.equal(result.data.mode, "full");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  assert.equal(control.lists.length, 2);
});
test("actual sync: backwards history checkpoint leaves inventory and cursor unchanged", async () => {
  const { control } = await syncFixture();
  await request("gmail/scan", {});
  await request("gmail/scan", {});
  control.history = async () => ({ history: [], historyId: "99" });
  assert.equal((await request("gmail/scan", {})).status, 502);
  assert.equal(
    sqlite.prepare("SELECT history_id FROM jobs").get().history_id,
    "100",
  );
});

test("actual sync: more than1000 valid full pages can finish and catch up history", async () => {
  const { control } = await syncFixture();
  let pages = 0;
  control.list = async () => ({
    messages: [],
    ...(++pages < 1005 ? { nextPageToken: "page" + pages } : {}),
  });
  let complete = false,
    work = 0;
  while (!complete && work < 1010) {
    const result = await request("gmail/scan", {});
    assert.equal(result.status, 200);
    complete = result.data.complete;
    work++;
  }
  assert.equal(complete, true);
  assert.equal(pages, 1005);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sync_pages").get().n, 0);
});
test("actual sync: persistent cycle detection catches a token older than the32-token cursor window", async () => {
  const { control } = await syncFixture();
  let pages = 0;
  control.list = async () => ({
    messages: [],
    nextPageToken: ++pages === 50 ? "page1" : "page" + pages,
  });
  for (let i = 0; i < 49; i++)
    assert.equal((await request("gmail/scan", {})).status, 200);
  assert.equal(
    JSON.parse(sqlite.prepare("SELECT cursor FROM jobs").get().cursor).seen
      .length,
    32,
  );
  assert.equal((await request("gmail/scan", {})).status, 502);
  assert.equal(
    sqlite.prepare("SELECT status FROM jobs").get().status,
    "interrupted",
  );
});

const { runGmailScheduler } = await import(
  pathToFileURL(path.join(root, "lib/gmail-scheduler.ts")).href
);
async function schedulerFixture() {
  const fixture = await syncFixture();
  Object.assign(globalThis.__backend.env, {
    GMAIL_SYNC_SCHEDULER: "enabled",
    GOOGLE_REDIRECT_URI: "https://app.example/api/oauth/callback",
  });
  await runGmailScheduler();
  const consent = await request("gmail/schedule", {
    enabled: true,
    intervalMinutes: 15,
  });
  assert.equal(consent.status, 200);
  return fixture;
}
function makeScheduleDue() {
  sqlite.prepare("UPDATE sync_schedules SET next_due=0 WHERE tenant='A'").run();
}
test("scheduler: requires explicit consent and current worker readiness", async () => {
  const { control } = await syncFixture();
  assert.equal(
    (await request("gmail/schedule", { enabled: true })).status,
    409,
  );
  Object.assign(globalThis.__backend.env, {
    GMAIL_SYNC_SCHEDULER: "enabled",
    GOOGLE_REDIRECT_URI: "https://app.example/api/oauth/callback",
  });
  assert.equal(
    (await request("gmail/schedule", { enabled: true })).status,
    409,
  );
  assert.equal((await runGmailScheduler()).claimed, 0);
  assert.equal(control.lists.length, 0);
  assert.equal(
    (await request("gmail/schedule", { enabled: true, intervalMinutes: 14 }))
      .status,
    400,
  );
  assert.equal(
    (await request("gmail/schedule", { enabled: true, intervalMinutes: 15 }))
      .status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT enabled FROM sync_schedules").get().enabled,
    1,
  );
});
test("scheduler: bounded full/history units run only reads and respect cadence", async () => {
  const { control } = await schedulerFixture();
  assert.equal((await runGmailScheduler()).completed, 1);
  assert.equal(control.lists[0].get("maxResults"), "5");
  assert.equal((await runGmailScheduler()).claimed, 0);
  makeScheduleDue();
  assert.equal((await runGmailScheduler()).completed, 1);
  const schedule = sqlite.prepare("SELECT * FROM sync_schedules").get();
  assert.equal(schedule.status, "waiting");
  assert.ok(schedule.last_success);
  assert.ok(schedule.next_due > Date.now() + 14 * 60000);
  assert.equal(control.histories.length, 1);
});
test("scheduler: overlapping ticks acquire one tenant lease", async () => {
  const { control } = await schedulerFixture();
  const g = gate();
  control.list = async () => {
    g.arrive();
    await g.wait;
    return { messages: [{ id: "m1" }] };
  };
  const first = runGmailScheduler();
  await g.entered;
  assert.equal((await runGmailScheduler()).claimed, 0);
  g.release();
  assert.equal((await first).completed, 1);
  assert.equal(control.lists.length, 1);
});
test("scheduler: pause during read releases owned work and prevents further pages", async () => {
  const { control } = await schedulerFixture();
  const g = gate();
  control.list = async () => {
    g.arrive();
    await g.wait;
    return { messages: [{ id: "m1" }] };
  };
  const task = runGmailScheduler();
  await g.entered;
  assert.equal(
    (await request("gmail/schedule", { enabled: false })).status,
    200,
  );
  g.release();
  await task;
  assert.equal(
    sqlite.prepare("SELECT status FROM sync_schedules").get().status,
    "paused",
  );
  assert.equal((await runGmailScheduler()).claimed, 0);
  assert.equal(sqlite.prepare("SELECT owner FROM jobs").get().owner, null);
});
test("scheduler: transient errors back off then suspend after five failures without replay", async () => {
  const { control } = await schedulerFixture();
  control.list = async () => {
    throw new Error("synthetic provider outage");
  };
  for (let i = 0; i < 5; i++) {
    makeScheduleDue();
    assert.equal((await runGmailScheduler()).failed, 1);
    assert.equal((await runGmailScheduler()).claimed, 0);
  }
  const schedule = sqlite.prepare("SELECT * FROM sync_schedules").get();
  assert.equal(schedule.enabled, 0);
  assert.equal(schedule.failures, 5);
  assert.equal(schedule.status, "paused_after_failures");
  assert.equal(schedule.last_error, "sync_unavailable");
});
test("scheduler: expired owner cannot overwrite successor after resumed read", async () => {
  const { control } = await schedulerFixture();
  const g = gate();
  control.list = async () => {
    g.arrive();
    await g.wait;
    return { messages: [{ id: "m1" }] };
  };
  const task = runGmailScheduler();
  await g.entered;
  sqlite
    .prepare(
      "UPDATE sync_schedules SET owner='successor',lease=?,status='waiting' WHERE tenant='A'",
    )
    .run(Date.now() + 120000);
  g.release();
  await task;
  assert.equal(
    sqlite.prepare("SELECT owner FROM sync_schedules").get().owner,
    "successor",
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM sync_schedules").get().status,
    "waiting",
  );
});
test("scheduler: disconnect pauses consent and removes future provider access", async () => {
  await schedulerFixture();
  await request("gmail/disconnect", {});
  assert.equal(
    sqlite.prepare("SELECT enabled FROM sync_schedules").get().enabled,
    0,
  );
  assert.equal((await runGmailScheduler()).claimed, 0);
});

test("scheduler: provider401 stops scheduling and exposes only a fixed reauth code", async () => {
  const { control } = await schedulerFixture();
  control.list = async () =>
    Response.json(
      { error: { message: "synthetic secret-like provider text" } },
      { status: 401 },
    );
  assert.equal((await runGmailScheduler()).failed, 1);
  const schedule = sqlite.prepare("SELECT * FROM sync_schedules").get();
  assert.equal(schedule.enabled, 0);
  assert.equal(schedule.status, "reauth_required");
  assert.equal(schedule.last_error, "reauth_required");
  assert.equal((await runGmailScheduler()).claimed, 0);
});
test("scheduler: stale runtime heartbeat prevents enabling scans while pause always remains available", async () => {
  await schedulerFixture();
  sqlite
    .prepare("UPDATE scheduler_health SET last_tick=?")
    .run(Date.now() - 16 * 60000);
  assert.equal(
    (await request("gmail/schedule", { enabled: true })).status,
    409,
  );
  assert.equal(
    (await request("gmail/schedule", { enabled: false })).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT enabled FROM sync_schedules").get().enabled,
    0,
  );
});
test("scheduler: user cannot enable or pause another tenant schedule", async () => {
  await schedulerFixture();
  await demo("B");
  assert.equal(
    (await request("gmail/schedule", { enabled: true }, "B")).status,
    409,
  );
  assert.equal(
    (await request("gmail/schedule", { enabled: false }, "B")).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT enabled FROM sync_schedules WHERE tenant='A'").get()
      .enabled,
    1,
  );
  assert.equal(
    (await request("gmail/schedule", { enabled: true, tenant: "A" }, "B"))
      .status,
    400,
  );
});

test("scheduler: quota403 keeps consent and retries through bounded backoff", async () => {
  const { control } = await schedulerFixture();
  control.list = async () =>
    Response.json(
      {
        error: {
          message: "private provider text",
          errors: [{ reason: "userRateLimitExceeded" }],
        },
      },
      { status: 403 },
    );
  const before = Date.now();
  assert.equal((await runGmailScheduler()).failed, 1);
  const schedule = sqlite.prepare("SELECT * FROM sync_schedules").get();
  assert.equal(schedule.enabled, 1);
  assert.equal(schedule.status, "backoff");
  assert.equal(schedule.last_error, "sync_unavailable");
  assert.ok(schedule.next_due >= before + 120000);
  assert.equal((await runGmailScheduler()).claimed, 0);
  assert.ok(!JSON.stringify(schedule).includes("private provider text"));
});

test("scheduler: manual scan contention defers without consuming retry budget", async () => {
  const { control } = await schedulerFixture();
  const generation = sqlite
    .prepare("SELECT generation FROM credentials WHERE tenant='A'")
    .get().generation;
  sqlite
    .prepare(
      "INSERT INTO jobs(id,tenant,source,status,processed,updated,lease,owner) VALUES('A:gmail:scan','A','gmail','running',0,?,?,?)",
    )
    .run(Date.now(), Date.now() + 120000, "manual-owner");
  sqlite.prepare("UPDATE sync_schedules SET failures=2").run();
  for (let attempt = 0; attempt < 6; attempt++) {
    await makeScheduleDue();
    const result = await runGmailScheduler();
    assert.equal(result.failed, 0);
    const schedule = sqlite.prepare("SELECT * FROM sync_schedules").get();
    assert.equal(schedule.enabled, 1);
    assert.equal(schedule.failures, 2);
    assert.equal(schedule.status, "waiting");
    assert.equal(schedule.generation, generation);
  }
  assert.equal(control.lists.length, 0);
  assert.equal(control.histories.length, 0);
});

test("scheduler: permission403 still suspends and requires reauthentication", async () => {
  const { control } = await schedulerFixture();
  control.list = async () =>
    Response.json(
      { error: { errors: [{ reason: "insufficientPermissions" }] } },
      { status: 403 },
    );
  assert.equal((await runGmailScheduler()).failed, 1);
  const row = sqlite
    .prepare("SELECT enabled,status,last_error FROM sync_schedules")
    .get();
  assert.equal(row.enabled, 0);
  assert.equal(row.status, "reauth_required");
  assert.equal(row.last_error, "reauth_required");
});
