import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import cleanup from "../../tests/e2e/cleanup.mjs";
test("cleanup only removes a matching direct temp child; missing state is a no-op", async () => {
  const owned = await mkdtemp(path.join(tmpdir(), "inbox-e2e-"));
  const foreign = await mkdtemp(path.join(tmpdir(), "review-foreign-"));
  const original = process.env.INBOX_E2E_STATE;
  try {
    await writeFile(path.join(owned, "sentinel"), "test");
    process.env.INBOX_E2E_STATE = owned;
    await cleanup();
    await assert.rejects(stat(owned), { code: "ENOENT" });
    process.env.INBOX_E2E_STATE = foreign;
    await cleanup();
    assert((await stat(foreign)).isDirectory());
    delete process.env.INBOX_E2E_STATE;
    await cleanup();
  } finally {
    if (original === undefined) delete process.env.INBOX_E2E_STATE;
    else process.env.INBOX_E2E_STATE = original;
    await rm(owned, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});
