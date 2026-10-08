import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDashboardUrl } from "../apps/extension/url.js";
test("extension has no mail access, broad permissions or remote code", async () => {
  const manifest = JSON.parse(
    await readFile("apps/extension/manifest.json", "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["sidePanel", "storage"]);
  for (const field of [
    "host_permissions",
    "content_scripts",
    "externally_connectable",
    "web_accessible_resources",
  ])
    assert.equal(manifest[field], undefined);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src 'none'/,
  );
  assert.match(
    manifest.content_security_policy.extension_pages,
    /script-src 'self'/,
  );
  const html = await readFile("apps/extension/sidepanel.html", "utf8");
  assert.match(html, /Connection pending/);
  assert.match(html, /not available in this extension/);
  assert.match(html, /noopener noreferrer/);
});
test("dashboard configuration rejects active URL schemes and accidental credentials", () => {
  for (const value of [
    null,
    {},
    "http://example.com",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com#secret",
    "//example.com",
    "data:text/html,x",
  ])
    assert.equal(validateDashboardUrl(value), null);
  assert.equal(
    validateDashboardUrl(" https://example.com/ "),
    "https://example.com/",
  );
});

test("relay rejects forged origins, unbounded projections and unsolicited/replayed packets", async () => {
  const { createRelay, trustedSender, validProjection } =
    await import("../apps/extension/relay.js");
  const sender = {
    url: "https://app.example/?view=settings",
    tab: { id: 4 },
    frameId: 0,
  };
  for (const fake of [
    { ...sender, id: "evil" },
    { ...sender, frameId: 1 },
    { ...sender, url: "https://evil.example/" },
    { ...sender, url: "https://app.example/legal/privacy" },
    { url: sender.url },
  ])
    assert.equal(trustedSender(fake, "https://app.example"), false);
  assert.equal(trustedSender(sender, null), false);
  const state = {};
  const storage = {
    get: async (key) => ({ [key]: state[key] }),
    set: async (value) => Object.assign(state, value),
    remove: async (key) => delete state[key],
  };
  const relay = createRelay(
    storage,
    "https://app.example",
    () => "867a5094-73ba-42ee-a41b-54a0f217ba6b",
    () => "1".repeat(64),
  );
  const hello = await relay({ kind: "hello" }, sender);
  const p = {
    version: 1,
    source: "demo",
    connected: false,
    total: 50,
    protected: 20,
    actions: 1,
    issued: Date.now(),
    expires: Date.now() + 119000,
  };
  assert.equal(validProjection({ ...p, email: "secret@example.com" }), false);
  assert.equal(validProjection({ ...p, total: -1 }), false);
  assert.equal(validProjection({ ...p, expires: Date.now() + 600000 }), false);
  const packet = {
    kind: "summary",
    id: hello.id,
    nonce: hello.nonce,
    projection: p,
  };
  await assert.rejects(relay({ ...packet, nonce: "wrong" }, sender));
  await assert.rejects(relay(packet, { ...sender, tab: { id: 5 } }));
  assert.deepEqual(await relay(packet, sender), { received: true });
  await assert.rejects(relay(packet, sender));
  await assert.rejects(
    relay({ kind: "reset", id: hello.id, nonce: "bad" }, sender),
  );
  assert.deepEqual(
    await relay({ kind: "reset", id: hello.id, nonce: hello.nonce }, sender),
    { reset: true },
  );
  await relay.forget();
  assert.equal(state.companion, undefined);
  await assert.rejects(relay(packet, sender));
});
