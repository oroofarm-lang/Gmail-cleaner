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
const gmailSource = `export class GmailMutationNotDispatched extends Error {}
export class GmailClient {constructor(options){return new Proxy(globalThis.__backend.gmail,{get(target,name){const value=target[name];if(typeof value!=='function')return value;return async (...args)=>{if(typeof options.accessToken==='function')await options.accessToken();if(["trashMessage","archiveMessage","untrashMessage","restoreInbox"].includes(name)&&options.authorizeMutation){const expiry=await options.authorizeMutation();if(Date.now()>=expiry)throw new GmailMutationNotDispatched();}return value.apply(target,args);};}})}}
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
  return { mailbox, calls };
}

test("checkpoint: expired unchanged scan owner cannot insert new metadata", async () => {
  const { mailbox } = await setupLive();
  sqlite.prepare("DELETE FROM messages WHERE tenant='A'").run();
  globalThis.__backend.gmail.listMessages = async () => ({
    messages: [{ id: "m1" }],
  });
  globalThis.__backend.gmail.getSafetyMessage = async () => {
    sqlite.prepare("UPDATE jobs SET lease=0 WHERE tenant='A'").run();
    return structuredClone(mailbox.get("m1"));
  };
  assert.equal((await request("gmail/scan", {})).status, 409);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM messages WHERE tenant='A'").get().n,
    0,
  );
});
test("checkpoint: tombstone prevents in-flight inventory commit", async () => {
  const { mailbox } = await setupLive();
  sqlite.prepare("DELETE FROM messages WHERE tenant='A'").run();
  globalThis.__backend.gmail.listMessages = async () => ({
    messages: [{ id: "m1" }],
  });
  globalThis.__backend.gmail.getSafetyMessage = async () => {
    sqlite.prepare("UPDATE tenants SET deleted=1 WHERE id='A'").run();
    return structuredClone(mailbox.get("m1"));
  };
  assert.equal((await request("gmail/scan", {})).status, 409);
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM messages WHERE tenant='A'").get().n,
    0,
  );
});
test("checkpoint: incomplete and inconsistent threads prohibit cleanup", async () => {
  for (const thread of [
    { id: "t1" },
    { id: "t1", messages: [] },
    { id: "foreign", messages: [{ id: "m1", labelIds: [] }] },
  ]) {
    const { calls } = await setupLive();
    globalThis.__backend.gmail.getThread = async () => thread;
    const plan = await request("gmail/preview", { ids: ["A:m1"] });
    assert.equal(
      (await request("gmail/execute", { planId: plan.data.id, approved: true }))
        .data.skipped,
      1,
    );
    assert.equal(calls.length, 0);
    sqlite.exec(
      "DELETE FROM credentials; DELETE FROM messages; DELETE FROM plans; DELETE FROM actions;",
    );
  }
});
test("checkpoint: lost Inbox restore response is recoverable with no duplicate mutation", async () => {
  const { mailbox } = await setupLive();
  const plan = await request("gmail/preview", {
    ids: ["A:m1"],
    action: "archive",
  });
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  const action = sqlite
    .prepare("SELECT id FROM actions WHERE kind='archive'")
    .get();
  let restores = 0;
  globalThis.__backend.gmail.restoreInbox = async (id) => {
    restores++;
    mailbox.get(id).labelIds.push("INBOX");
    throw Error("lost response");
  };
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    503,
  );
  assert.equal(
    (await request("gmail/undo", { actionId: action.id })).status,
    200,
  );
  assert.equal(restores, 1);
});
test("checkpoint: pre-mutation failure must not authorize undo of a later manual trash", async () => {
  const { mailbox, calls } = await setupLive();
  const plan = await request("gmail/preview", { ids: ["A:m1"] });
  globalThis.__backend.gmail.getThread = async () => {
    throw Error("thread unavailable before attempting mutation");
  };
  await request("gmail/execute", { planId: plan.data.id, approved: true });
  assert.equal(calls.length, 0);
  const action = sqlite
    .prepare("SELECT id,status FROM actions WHERE kind='trash'")
    .get();
  mailbox.get("m1").labelIds = ["CATEGORY_PROMOTIONS", "TRASH"];
  const result = await request("gmail/undo", { actionId: action.id });
  assert.equal(
    result.status,
    409,
    "pre-attempt error must not create a recoverable action",
  );
  assert.ok(mailbox.get("m1").labelIds.includes("TRASH"));
});
