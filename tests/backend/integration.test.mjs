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
const gmailSource = `export class GmailClient {constructor(options){return new Proxy(globalThis.__backend.gmail,{get(target,name){const value=target[name];if(typeof value!=='function')return value;return async (...args)=>{if(typeof options.accessToken==='function')await options.accessToken();return value.apply(target,args);};}})}}
export const interpretCommand=()=>{},OpenAIClassifier=class {};
export function headerValue(m,name){return m.payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value??''}
export function hasAttachmentOrUncertainty(m){return !!m.payload?.parts?.some(p=>p.filename||p.body?.attachmentId)}
export async function decryptTokens(){return {access_token:'test-token',expires_in:3600,refresh_token:'test-refresh'}}
export async function encryptTokens(){return 'encrypted-test-token'}
export async function revokeGoogleToken(){}
export async function exchangeGoogleCode(){return {access_token:'new-test-token',refresh_token:'test-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.modify'}}
export const createOAuthTransaction=()=>{},buildGoogleAuthorizationUrl=()=>{},refreshGoogleToken=()=>{};`;
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
const { POST, GET } = await import("../../app/api/[...path]/route.ts");
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
          return this.execute().results[0] ?? null;
        },
        async run() {
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
async function preview(id, tenant = "A") {
  return request("preview", { ids: [id] }, tenant);
}
test("exact demo cleanup SQL revalidates protection/revision; stale claim mutates nothing", async () => {
  const state = await demo();
  const group = state.groups.find(
    (g) => !g.protected && g.category === "newsletter",
  );
  const plan = await preview(group.id);
  await request("protect", { id: group.id });
  const result = await request("execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(result.status, 409);
  assert.equal(
    sqlite.prepare("SELECT status FROM mail_groups WHERE id=?").get(group.id)
      .status,
    "active",
  );
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) n FROM actions WHERE plan_id=?")
      .get(plan.data.id).n,
    0,
  );
});
test("exact demo transaction handles duplicate execution and duplicate Undo once", async () => {
  const state = await demo();
  const group = state.groups.find(
    (g) => !g.protected && g.category === "promotion",
  );
  const plan = await preview(group.id);
  assert.equal(
    (await request("execute", { planId: plan.data.id, approved: true })).status,
    200,
  );
  assert.equal(
    (await request("execute", { planId: plan.data.id, approved: true })).data
      .duplicate,
    true,
  );
  assert.equal(
    sqlite.prepare("SELECT revision FROM mail_groups WHERE id=?").get(group.id)
      .revision,
    1,
  );
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) n FROM actions WHERE plan_id=?")
      .get(plan.data.id).n,
    1,
  );
  assert.equal(
    (await request("undo", { actionId: plan.data.id })).data.restored,
    true,
  );
  assert.equal(
    (await request("undo", { actionId: plan.data.id })).data.duplicate,
    true,
  );
  assert.equal(
    sqlite.prepare("SELECT revision FROM mail_groups WHERE id=?").get(group.id)
      .revision,
    2,
  );
});
test("cross-tenant plans, groups, rules, messages and actions are inaccessible", async () => {
  const a = await demo("A");
  await demo("B");
  const group = a.groups.find(
    (g) => !g.protected && g.category === "newsletter",
  );
  const plan = await preview(group.id, "A");
  assert.equal(
    (await request("execute", { planId: plan.data.id, approved: true }, "B"))
      .status,
    404,
  );
  assert.equal((await preview(group.id, "B")).status, 409);
  assert.equal((await request("protect", { id: group.id }, "B")).status, 404);
  assert.equal(
    (await request("undo", { actionId: plan.data.id }, "B")).status,
    404,
  );
  await request(
    "rules",
    { command: "Delete promotions older than 6 months", approved: true },
    "A",
  );
  const rule = sqlite.prepare("SELECT id FROM rules WHERE tenant=?").get("A");
  assert.equal(
    (await request("rule-toggle", { id: rule.id, enabled: false }, "B")).status,
    404,
  );
  const b = (await request("state", undefined, "B")).data;
  assert.ok(b.groups.every((g) => g.tenant === "B"));
  assert.equal(b.rules.length, 0);
  assert.equal(b.activity.length, 0);
  assert.equal(
    (await request("gmail/messages", {}, "B")).data.messages.length,
    0,
  );
});
test("tenant forgery in request JSON rejected and absent identity denied", async () => {
  await demo();
  assert.equal(
    (await request("settings", { tenant: "B", privacy: "smart" })).status,
    400,
  );
  assert.equal((await request("state", undefined, null)).status, 401);
  assert.equal(
    (
      await request("demo", {}, "A", {
        headers: { origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("demo", {}, "A", {
        headers: { "content-type": "text/plain" },
      })
    ).status,
    415,
  );
});
function liveMessage(id = "m1", changes = {}) {
  return {
    id,
    threadId: "t1",
    internalDate: String(Date.now() - 400 * 86400000),
    sizeEstimate: 1000,
    labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    payload: {
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
    .prepare("INSERT INTO credentials VALUES(?,?,?,?)")
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
  return { mailbox, calls };
}
test("actual Gmail handler revalidates a newly protected sender", async () => {
  const { calls } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  const settings = JSON.parse(
    sqlite.prepare("SELECT settings FROM tenants WHERE id=?").get("A").settings,
  );
  sqlite.prepare("UPDATE tenants SET settings=? WHERE id=?").run(
    JSON.stringify({
      ...settings,
      protectedSenders: ["offers@shop.example"],
    }),
    "A",
  );
  const executed = await request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(executed.data.skipped, 1);
  assert.equal(calls.length, 0);
});
test("actual Gmail handler protects replied thread and changed starred labels", async () => {
  const { mailbox, calls } = await setupLive();
  let plan = await request("gmail/preview", { ids: ["A:m1"] });
  globalThis.__backend.gmail.getThread = async () => ({
    id: "t1",
    messages: [{ id: "sent1", labelIds: ["SENT"] }],
  });
  assert.equal(
    (await request("gmail/execute", { planId: plan.data.id, approved: true }))
      .data.skipped,
    1,
  );
  assert.equal(calls.length, 0);
  globalThis.__backend.gmail.getThread = async () => ({
    id: "t1",
    messages: [],
  });
  plan = await request("gmail/preview", { ids: ["A:m1"] });
  mailbox.get("m1").labelIds.push("STARRED");
  assert.equal(
    (await request("gmail/execute", { planId: plan.data.id, approved: true }))
      .data.skipped,
    1,
  );
  assert.equal(calls.length, 0);
});
test("actual Gmail cleanup duplicates are skipped and Undo restores Inbox", async () => {
  const { mailbox, calls } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  assert.equal(
    (await request("gmail/execute", { planId: plan.data.id, approved: true }))
      .data.total,
    1,
  );
  assert.equal(
    (await request("gmail/execute", { planId: plan.data.id, approved: true }))
      .data.duplicate,
    true,
  );
  assert.equal(calls.length, 1);
  const action = sqlite
    .prepare("SELECT id FROM actions WHERE plan_id=?")
    .get(plan.data.id);
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).data.restored,
    true,
  );
  assert.ok(mailbox.get("m1").labelIds.includes("INBOX"));
  assert.ok(!mailbox.get("m1").labelIds.includes("TRASH"));
  assert.equal(
    (await request("gmail/undo", { actionId: action.id }, "B")).status,
    409,
  );
});
test("actual Gmail execution rejects metadata changed after preview", async () => {
  const { mailbox, calls } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  mailbox.get("m1").internalDate = String(Date.now() - 200 * 86400000);
  const result = await request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(result.data.skipped, 1);
  assert.equal(calls.length, 0);
});
test("overlapping Gmail plans cannot mutate the same tenant concurrently", async () => {
  const { calls } = await setupLive();
  const first = await request("gmail/preview", { ids: ["A:m1"] });
  const second = await request("gmail/preview", { ids: ["A:m1"] });
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  globalThis.__backend.gmail.getThread = async () => {
    arrived++;
    if (arrived === 2) release();
    await Promise.race([
      gate,
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
    return {
      id: "t1",
      messages: [{ id: "m1", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }],
    };
  };
  const results = await Promise.all([
    request("gmail/execute", { planId: first.data.id, approved: true }),
    request("gmail/execute", { planId: second.data.id, approved: true }),
  ]);
  assert.equal(calls.length, 1);
  assert.ok(results.some((r) => r.status === 409 || r.data.skipped === 1));
});
test("missing Gmail credentials cannot strand Undo in restoring state", async () => {
  await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = sqlite
    .prepare("SELECT id FROM actions WHERE plan_id=?")
    .get(plan.data.id);
  sqlite.prepare("DELETE FROM credentials WHERE tenant=?").run("A");
  const response = await request("gmail/undo", { actionId: action.id });
  assert.equal(response.status, 409);
  assert.equal(
    sqlite.prepare("SELECT status FROM actions WHERE id=?").get(action.id)
      .status,
    "success",
  );
});
test("account switch during cleanup aborts before mutation", async () => {
  const { calls } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  globalThis.__backend.gmail.getThread = async () => {
    sqlite
      .prepare("UPDATE credentials SET email=? WHERE tenant=?")
      .run("other@gmail.example", "A");
    return {
      id: "t1",
      messages: [{ id: "m1", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }],
    };
  };
  const result = await request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.data.failed, 1);
});
test("OAuth state belongs to tenant, is single-use, and account replacement clears old inventory", async () => {
  await setupLive();
  await demo("B");
  const plan = await request("gmail/preview", { ids: ["A:m1"] }, "A");
  sqlite
    .prepare("INSERT INTO oauth_transactions VALUES(?,?,?,?)")
    .run("state-a", "A", "verifier-a", Date.now() + 300000);
  globalThis.__backend.gmail.getProfile = async () => ({
    emailAddress: "replacement@gmail.example",
  });
  assert.equal(
    (await request("oauth/callback?state=state-a&code=code", undefined, "B"))
      .status,
    400,
  );
  assert.ok(
    sqlite
      .prepare("SELECT state FROM oauth_transactions WHERE state=?")
      .get("state-a"),
  );
  assert.equal(
    (await request("oauth/callback?state=state-a&code=code", undefined, "A"))
      .status,
    302,
  );
  assert.equal(
    sqlite.prepare("SELECT email FROM credentials WHERE tenant=?").get("A")
      .email,
    "replacement@gmail.example",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?").get("A").n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM plans WHERE id=?").get(plan.data.id)
      .n,
    0,
  );
  assert.ok(
    sqlite.prepare("SELECT COUNT(*) n FROM mail_groups WHERE tenant=?").get("B")
      .n > 0,
  );
  assert.equal(
    (await request("oauth/callback?state=state-a&code=code", undefined, "A"))
      .status,
    400,
  );
});
test("account deletion clears only owned data and prevents silent tenant recreation", async () => {
  await demo("A");
  await demo("B");
  await request(
    "rules",
    { command: "Delete promotions older than 6 months", approved: true },
    "A",
  );
  const deleted = await request(
    "delete-account",
    { confirmation: "DELETE" },
    "A",
  );
  assert.equal(deleted.status, 200);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM mail_groups WHERE tenant=?").get("A")
      .n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM rules WHERE tenant=?").get("A").n,
    0,
  );
  assert.ok(
    sqlite.prepare("SELECT COUNT(*) n FROM mail_groups WHERE tenant=?").get("B")
      .n > 0,
  );
  assert.equal((await request("state", undefined, "A")).status, 403);
  assert.equal((await request("state", undefined, "B")).status, 200);
});

test("received multi-message conversations are protected before cleanup", async () => {
  const { calls } = await setupLive();
  globalThis.__backend.gmail.getThread = async () => ({
    id: "t1",
    messages: [
      { id: "m1", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] },
      { id: "m2", labelIds: ["INBOX"] },
    ],
  });
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  const result = await request("gmail/execute", {
    planId: plan.data.id,
    approved: true,
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 0);
  assert.equal(result.data.skipped, 1);
});
test("in-flight scan cannot commit old-account metadata after replacement", async () => {
  const { mailbox } = await setupLive();
  globalThis.__backend.gmail.listMessages = async () => ({
    messages: [{ id: "m1" }],
  });
  globalThis.__backend.gmail.getSafetyMessage = async () => {
    const result = structuredClone(mailbox.get("m1"));
    sqlite
      .prepare("UPDATE credentials SET email=? WHERE tenant=?")
      .run("new@gmail.example", "A");
    sqlite.prepare("DELETE FROM messages WHERE tenant=?").run("A");
    sqlite
      .prepare("DELETE FROM jobs WHERE tenant=? AND source='gmail'")
      .run("A");
    return result;
  };
  const result = await request("gmail/scan", {});
  assert.equal(result.status, 409);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE tenant=?").get("A").n,
    0,
  );
});
test("simultaneous first scans acquire only one provider lease", async () => {
  await setupLive();
  let listed = 0;
  globalThis.__backend.gmail.listMessages = async () => {
    listed++;
    await new Promise((r) => setTimeout(r, 100));
    return { messages: [] };
  };
  const results = await Promise.all([
    request("gmail/scan", {}),
    request("gmail/scan", {}),
  ]);
  assert.equal(listed, 1);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
});
test("disconnect removes local credentials even when OAuth configuration is missing", async () => {
  await setupLive();
  delete globalThis.__backend.env.TOKEN_ENCRYPTION_KEY;
  const result = await request("gmail/disconnect", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.revocationConfirmed, false);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) n FROM credentials WHERE tenant=?").get("A")
      .n,
    0,
  );
  assert.equal(
    result.data.manualRevokeUrl,
    "https://myaccount.google.com/connections",
  );
});

test("expired scan owner cannot write inventory or release its successor lease", async () => {
  const { mailbox } = await setupLive();
  globalThis.__backend.gmail.listMessages = async () => ({
    messages: [{ id: "m1" }],
  });
  globalThis.__backend.gmail.getSafetyMessage = async () => {
    sqlite
      .prepare("UPDATE jobs SET owner='successor',lease=? WHERE tenant=?")
      .run(Date.now() + 120000, "A");
    return structuredClone(mailbox.get("m1"));
  };
  const result = await request("gmail/scan", {});
  assert.equal(result.status, 409);
  assert.equal(
    sqlite.prepare("SELECT owner,status FROM jobs WHERE tenant=?").get("A")
      .owner,
    "successor",
  );
});
test("lost cleanup response remains recoverable without replaying trash", async () => {
  const { mailbox, calls } = await setupLive();
  globalThis.__backend.gmail.trashMessage = async (id) => {
    calls.push("trash");
    mailbox.get(id).labelIds = ["CATEGORY_PROMOTIONS", "TRASH"];
    throw new Error("synthetic response lost");
  };
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = sqlite
    .prepare("SELECT id,status FROM actions WHERE kind='trash' AND tenant='A'")
    .get();
  assert.equal(action.status, "uncertain");
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    200,
  );
  assert.ok(mailbox.get("m1").labelIds.includes("INBOX"));
  assert.ok(!mailbox.get("m1").labelIds.includes("TRASH"));
  assert.equal(calls.filter((x) => x === "trash").length, 1);
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    409,
  );
});

test("privacy export is complete, paginated, tenant scoped and excludes credentials", async () => {
  await setupLive();
  await demo("B");
  for (let i = 0; i < 205; i++)
    sqlite
      .prepare(
        "INSERT INTO messages(id,tenant,gmail_id,metadata,classification,updated) VALUES(?,?,?,?,?,?)",
      )
      .run(
        `A:export:${String(i).padStart(3, "0")}`,
        "A",
        `e${i}`,
        "{}",
        "{}",
        Date.now(),
      );
  const manifest = await request("export", {});
  assert.equal(manifest.status, 200);
  assert.ok(manifest.data.collections.includes("messages"));
  assert.ok(manifest.data.collections.includes("actions"));
  assert.ok(!JSON.stringify(manifest.data).includes("test-token"));
  const first = await request("export", { collection: "messages" });
  assert.equal(first.data.rows.length, 200);
  assert.ok(first.data.nextCursor);
  const second = await request("export", {
    collection: "messages",
    cursor: first.data.nextCursor,
  });
  assert.equal(second.data.rows.length, 6);
  assert.equal(second.data.nextCursor, null);
  assert.ok(
    [...first.data.rows, ...second.data.rows].every(
      (row) => row.id.startsWith("A:") && !("tenant" in row),
    ),
  );
  assert.equal(
    (await request("export", { collection: "credentials" })).status,
    400,
  );
});

test("lost Undo response can be safely retried after inspecting current labels", async () => {
  const { mailbox } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = sqlite
    .prepare("SELECT id FROM actions WHERE kind='trash' AND tenant='A'")
    .get();
  let untrash = 0;
  globalThis.__backend.gmail.untrashMessage = async (id) => {
    untrash++;
    mailbox.get(id).labelIds = ["CATEGORY_PROMOTIONS"];
    throw new Error("synthetic restoration response lost");
  };
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    503,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM actions WHERE id=?").get(action.id)
      .status,
    "restore_uncertain",
  );
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    200,
  );
  assert.equal(untrash, 1);
  assert.ok(mailbox.get("m1").labelIds.includes("INBOX"));
});

test("manual unsubscribe returns scoped options without provider calls or automatic success", async () => {
  await setupLive();
  globalThis.__backend.gmail.listMessages = async () => ({ messages: [] });
  await request("gmail/scan", {});
  const group = sqlite
    .prepare("SELECT id FROM mail_groups WHERE tenant='A' AND source='gmail'")
    .get();
  const result = await request("gmail/unsubscribe-options", { id: group.id });
  assert.equal(result.status, 200);
  assert.equal(result.data.sent, false);
  assert.equal(result.data.gmailUrl, "https://mail.google.com/mail/");
  assert.ok(result.data.search.startsWith("from:"));
  assert.equal(result.data.status, "unavailable");
  await demo("B");
  assert.equal(
    (await request("gmail/unsubscribe-options", { id: group.id }, "B")).status,
    404,
  );
});

test("failed preflight never gives Undo authority over a later manual user change", async () => {
  const { mailbox } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  globalThis.__backend.gmail.getThread = async () => {
    throw new Error("synthetic preflight failure");
  };
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = sqlite
    .prepare("SELECT id,status FROM actions WHERE kind='trash' AND tenant='A'")
    .get();
  assert.equal(action.status, "failed");
  mailbox.get("m1").labelIds = ["TRASH", "CATEGORY_PROMOTIONS"];
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    409,
  );
  assert.ok(mailbox.get("m1").labelIds.includes("TRASH"));
});
