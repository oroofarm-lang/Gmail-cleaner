import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.INBOX_E2E_STATE ??= mkdtempSync(join(tmpdir(), "inbox-e2e-"));
export default defineConfig({
  globalTeardown: "./tests/e2e/cleanup.mjs",
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: false,
    env: { INBOX_LOCAL_STATE: process.env.INBOX_E2E_STATE },
    timeout: 120000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
