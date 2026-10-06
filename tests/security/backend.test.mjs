import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { z } from "zod";
import * as oauth from "../../packages/integrations/oauth.ts";
import { interpretCommand } from "../../packages/integrations/assistant.ts";
import { OpenAIClassifier } from "../../packages/integrations/ai.ts";
import * as mime from "../../packages/integrations/gmail.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function harness() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of (await readdir(`${root}/drizzle`))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    sqlite.exec(await readFile(`${root}/drizzle/${file}`, "utf8"));
  const mutations = [];
  const fixture = {
    user: { userId: "alice", email: "alice@example.org" },
    message: {
      id: "message1",
      threadId: "thread1",
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
      internalDate: String(Date.now() - 400 * 86400000),
      sizeEstimate: 500,
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "bulk@example.org" },
          { name: "Subject", value: "Seasonal sale" },
          { name: "List-ID", value: "bulk.example.org" },
        ],
      },
    },
    replied: false,
    revokeFails: false,
    exchangeCount: 0,
    onRefresh: null,
    clock: Date.now(),
  };
  function statement(sql, values = []) {
    const execute = () => sqlite.prepare(sql);
    return {
      bind(...args) {
        return statement(sql, args);
      },
      async first() {
        return execute().get(...values) ?? null;
      },
      async all() {
        return { results: execute().all(...values) };
      },
      async run() {
        const result = execute().run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  const db = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const item of statements) result.push(await item.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "fake",
    GOOGLE_CLIENT_SECRET: "fake",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64url"),
    GOOGLE_REDIRECT_URI: "https://app.example.org/api/oauth/callback",
  };
  class FixtureGmail {
    constructor(options) {
      this.options = options;
    }
    async token() {
      return typeof this.options.accessToken === "function"
        ? this.options.accessToken()
        : this.options.accessToken;
    }
    async getProfile() {
      await this.token();
      return {
        emailAddress: "gmail@example.org",
        messagesTotal: 1,
        historyId: "123",
      };
    }
    async getSafetyMessage() {
      await this.token();
      return structuredClone(fixture.message);
    }
    async getMessage() {
      return this.getSafetyMessage();
    }
    async getThread() {
      await this.token();
      return {
        id: "thread1",
        messages: fixture.replied
          ? [{ id: "reply", labelIds: ["SENT"] }]
          : [fixture.message],
      };
    }
    async listMessages() {
      await this.token();
      return { messages: [{ id: fixture.message.id }] };
    }
    async trashMessage(id) {
      await this.token();
      mutations.push({ kind: "trash", id });
    }
    async archiveMessage(id) {
      await this.token();
      mutations.push({ kind: "archive", id });
    }
    async untrashMessage(id) {
      await this.token();
      mutations.push({ kind: "untrash", id });
    }
    async restoreInbox(id) {
      await this.token();
      mutations.push({ kind: "restoreInbox", id });
    }
  }
  const integrations = {
    ...oauth,
    ...mime,
    interpretCommand,
    OpenAIClassifier,
    GmailClient: FixtureGmail,
    async refreshGoogleToken() {
      if (fixture.onRefresh) await fixture.onRefresh();
      return {
        access_token: "refreshed-old-account",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      };
    },
    async exchangeGoogleCode(options) {
      oauth.validateOAuthState(options.transaction, options.returnedState);
      fixture.exchangeCount++;
      return {
        access_token: "fixture-token",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.modify",
      };
    },
    async revokeGoogleToken() {
      if (fixture.revokeFails) throw Error("fixture outage");
    },
  };
  const context = createContext({
    console: { error() {} },
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    crypto,
    process: { env: {} },
    setTimeout,
    clearTimeout,
    Date,
    TextEncoder,
    TextDecoder,
    structuredClone,
    AbortSignal,
  });
  const cache = new Map();
  function synthetic(name, exports) {
    const exportedModule = new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports))
          this.setExport(key, value);
      },
      { context, identifier: name },
    );
    cache.set(name, exportedModule);
    return exportedModule;
  }
  synthetic("cloudflare:workers", { env });
  synthetic("@/app/chatgpt-auth", {
    async getChatGPTUser() {
      return fixture.user;
    },
  });
  synthetic("zod", { z });
  synthetic("@/packages/integrations", integrations);
  const files = {
    "@/lib/server": "lib/server.ts",
    "./server": "lib/server.ts",
    "./demo": "lib/demo.ts",
    "@/lib/demo": "lib/demo.ts",
    "@/packages/core": "packages/core/index.ts",
    "@/packages/integrations/unsubscribe":
      "packages/integrations/unsubscribe.ts",
    "@/lib/gmail-server": "lib/gmail-server.ts",
  };
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const path = files[name] ?? name;
    const existing = cache.get(path);
    if (existing) return existing;
    const pending = (async () => {
      const code = ts.transpileModule(
        await readFile(`${root}/${path}`, "utf8"),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        },
      ).outputText;
      return new SourceTextModule(code, { context, identifier: path });
    })();
    cache.set(path, pending);
    return pending;
  }
  const route = await load("app/api/[...path]/route.ts");
  await route.link(load);
  await route.evaluate();
  async function request(path, body, origin = "https://app.example.org") {
    const method = body === undefined ? "GET" : "POST";
    return route.namespace[method](
      new Request(`https://app.example.org/api/${path}`, {
        method,
        headers:
          body === undefined
            ? {}
            : { Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
  async function connect(userId = "alice") {
    fixture.user = { userId, email: `${userId}@example.org` };
    await request("state");
    const tokens = {
      access_token: "fixture",
      refresh_token: "fixture",
      expires_in: 3600,
      token_type: "Bearer",
    };
    const encrypted = await oauth.encryptTokens(
      tokens,
      env.TOKEN_ENCRYPTION_KEY,
      userId,
    );
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO credentials(tenant,encrypted,email,updated) VALUES(?,?,?,?)",
      )
      .run(userId, encrypted, "gmail@example.org", Date.now());
    const current = JSON.parse(
      sqlite.prepare("SELECT settings FROM tenants WHERE id=?").get(userId)
        .settings,
    );
    sqlite
      .prepare("UPDATE tenants SET settings=? WHERE id=?")
      .run(JSON.stringify({ ...current, source: "gmail" }), userId);
  }
  const gmailModule = await cache.get("lib/gmail-server.ts");
  const serverModule = await cache.get("lib/server.ts");
  return {
    sqlite,
    fixture,
    mutations,
    request,
    connect,
    env,
    async client() {
      return gmailModule.namespace.clientFor(
        await serverModule.namespace.tenant(),
        new Request("https://app.example.org"),
      );
    },
  };
}

test("actual API rejects unauthenticated requests and foreign-origin mutations", async () => {
  const h = await harness();
  h.fixture.user = null;
  assert.equal((await h.request("state")).status, 401);
  h.fixture.user = { userId: "alice", email: "alice@example.org" };
  assert.equal(
    (await h.request("demo", {}, "https://attacker.example.org")).status,
    403,
  );
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM tenants").get().n, 0);
});
test("actual API scopes state, preview, actions and rule IDs to authenticated tenant", async () => {
  const h = await harness();
  await h.request("demo", {});
  const aliceState = await (await h.request("state")).json();
  const group = aliceState.groups.find((g) => !g.protected);
  const preview = await (
    await h.request("preview", { ids: [group.id] })
  ).json();
  h.fixture.user = { userId: "bob", email: "bob@example.org" };
  await h.request("demo", {});
  const state = await (await h.request("state")).json();
  assert.ok(state.groups.every((g) => g.tenant === "bob"));
  assert.equal((await h.request("preview", { ids: [group.id] })).status, 409);
  assert.equal(
    (await h.request("execute", { planId: preview.id, approved: true })).status,
    404,
  );
  assert.equal((await h.request("undo", { actionId: preview.id })).status, 404);
  assert.equal((await h.request("protect", { id: group.id })).status, 404);
  assert.equal(
    (await h.request("rule-toggle", { id: "alice-rule", enabled: true }))
      .status,
    404,
  );
  assert.equal(h.mutations.length, 0);
});
test("actual API rejects plan tampering and revokes stale demo preview when protections change", async () => {
  const h = await harness();
  await h.request("demo", {});
  const state = await (await h.request("state")).json();
  const group = state.groups.find((g) => !g.protected);
  const preview = await (
    await h.request("preview", { ids: [group.id] })
  ).json();
  assert.equal(
    (
      await h.request("execute", {
        planId: preview.id,
        approved: true,
        total: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (await h.request("execute", { planId: preview.id, approved: false }))
      .status,
    400,
  );
  await h.request("protect", { id: group.id });
  assert.equal(
    (await h.request("execute", { planId: preview.id, approved: true })).status,
    409,
  );
  assert.equal(
    h.sqlite.prepare("SELECT status FROM mail_groups WHERE id=?").get(group.id)
      .status,
    "active",
  );
});
test("actual Gmail execution skips fresh starred, attachment and replied-thread protections", async () => {
  for (const protection of ["starred", "attachment", "reply"]) {
    const h = await harness();
    await h.connect();
    await h.request("gmail/scan", {});
    const row = h.sqlite
      .prepare("SELECT id FROM messages WHERE tenant=?")
      .get("alice");
    const preview = await (
      await h.request("gmail/preview", { ids: [row.id] })
    ).json();
    assert.ok(preview.id);
    if (protection === "starred") h.fixture.message.labelIds.push("STARRED");
    if (protection === "attachment")
      h.fixture.message.payload = {
        mimeType: "multipart/mixed",
        parts: [{ mimeType: "application/pdf", filename: "invoice.pdf" }],
      };
    if (protection === "reply") h.fixture.replied = true;
    const response = await h.request("gmail/execute", {
      planId: preview.id,
      approved: true,
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 0);
    assert.equal(result.skipped, 1);
    assert.equal(h.mutations.length, 0);
  }
});
test("actual Gmail plan replay causes one provider mutation and preserves tenant access", async () => {
  const h = await harness();
  await h.connect();
  await h.request("gmail/scan", {});
  const row = h.sqlite.prepare("SELECT id FROM messages").get();
  const preview = await (
    await h.request("gmail/preview", { ids: [row.id] })
  ).json();
  const response = await h.request("gmail/execute", {
    planId: preview.id,
    approved: true,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
  assert.equal(h.mutations.length, 1);
  assert.equal(
    (
      await (
        await h.request("gmail/execute", { planId: preview.id, approved: true })
      ).json()
    ).duplicate,
    true,
  );
  assert.equal(h.mutations.length, 1);
  h.fixture.user = { userId: "bob", email: "bob@example.org" };
  assert.equal(
    (await h.request("gmail/execute", { planId: preview.id, approved: true }))
      .status,
    409,
  );
  assert.equal(h.mutations.length, 1);
});
test("actual OAuth callback consumes state once and rejects another tenant", async () => {
  const h = await harness();
  const start = await h.request("oauth/start");
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get(
    "state",
  );
  h.fixture.user = { userId: "bob", email: "bob@example.org" };
  assert.equal(
    (await h.request(`oauth/callback?state=${state}&code=fixture`)).status,
    400,
  );
  assert.equal(h.fixture.exchangeCount, 0);
  h.fixture.user = { userId: "alice", email: "alice@example.org" };
  assert.equal(
    (await h.request(`oauth/callback?state=${state}&code=fixture`)).status,
    302,
  );
  assert.equal(h.fixture.exchangeCount, 1);
  assert.equal(
    (await h.request(`oauth/callback?state=${state}&code=fixture`)).status,
    400,
  );
  assert.equal(h.fixture.exchangeCount, 1);
});
test("actual disconnect removes local credentials even when provider revocation fails", async () => {
  const h = await harness();
  await h.connect();
  h.fixture.revokeFails = true;
  const response = await h.request("gmail/disconnect", {});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.disconnected, true);
  assert.equal(result.revocationConfirmed, false);
  assert.equal(
    h.sqlite.prepare("SELECT COUNT(*) n FROM credentials").get().n,
    0,
  );
});
test("actual credential refresh cannot overwrite a concurrently reconnected Gmail account", async () => {
  const h = await harness();
  await h.connect();
  h.sqlite
    .prepare("UPDATE credentials SET updated=0 WHERE tenant=?")
    .run("alice");
  const client = await h.client();
  let newEnvelope;
  h.fixture.onRefresh = async () => {
    newEnvelope = await oauth.encryptTokens(
      {
        access_token: "new-account",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      },
      h.env.TOKEN_ENCRYPTION_KEY,
      "alice",
    );
    h.sqlite
      .prepare(
        "UPDATE credentials SET email=?,encrypted=?,updated=? WHERE tenant=?",
      )
      .run("new-gmail@example.org", newEnvelope, Date.now(), "alice");
  };
  await assert.rejects(client.getSafetyMessage("message1"));
  assert.equal(
    h.sqlite
      .prepare("SELECT encrypted FROM credentials WHERE tenant=?")
      .get("alice").encrypted,
    newEnvelope,
  );
});
