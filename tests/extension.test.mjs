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
