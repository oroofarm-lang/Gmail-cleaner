import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const execute = promisify(execFile);
test(
  "native unpacked Chromium relay enforces origin/frame/replay and Forget boundaries",
  { timeout: 60000 },
  async () => {
    const profile = await mkdtemp(
      path.join(os.tmpdir(), "inbox-extension-runtime-"),
    );
    let context;
    const env = { ...process.env };
    delete env.INBOX_EXTENSION_ORIGIN;
    try {
      await execute(process.execPath, ["scripts/build-extension.mjs"], {
        env: { ...env, INBOX_EXTENSION_ORIGIN: "https://app.example" },
      });
      const extension = path.resolve("dist/extension");
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      });
      await context.route("https://**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Synthetic origin</title>",
        }),
      );
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker", { timeout: 20000 }));
      const id = new URL(worker.url()).host;
      const page = await context.newPage();
      await page.goto("https://app.example/");
      const result = await page.evaluate(async (id) => {
        const send = (payload) =>
          new Promise((resolve, reject) =>
            chrome.runtime.sendMessage(id, payload, (result) =>
              chrome.runtime.lastError
                ? reject(Error(chrome.runtime.lastError.message))
                : resolve(result),
            ),
          );
        const hello = await send({ kind: "hello" });
        const now = Date.now();
        const packet = {
          kind: "summary",
          id: hello.id,
          nonce: hello.nonce,
          projection: {
            version: 1,
            source: "demo",
            connected: false,
            total: 40,
            protected: 10,
            actions: 2,
            issued: now,
            expires: now + 119000,
          },
        };
        return {
          hello,
          packet,
          accepted: await send(packet),
          replay: await send(packet),
        };
      }, id);
      assert.equal(result.accepted.received, true);
      assert.ok(result.replay.error);
      const panel = await context.newPage();
      await panel.setViewportSize({ width: 320, height: 720 });
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await panel.getByText("Synthetic summary:", { exact: false }).waitFor();
      assert.equal(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await panel
        .getByRole("button", {
          name: "Forget companion approval on this device",
          exact: true,
        })
        .focus();
      await panel.keyboard.press("Enter");
      await panel
        .getByText("Local approval and summary removed.", { exact: false })
        .waitFor();
      const stale = await page.evaluate(
        ({ id, packet }) =>
          new Promise((resolve) =>
            chrome.runtime.sendMessage(id, packet, resolve),
          ),
        { id, packet: result.packet },
      );
      assert.ok(stale.error);
      await page.goto("https://evil.example/");
      assert.equal(
        await page.evaluate(() => !!globalThis.chrome?.runtime?.sendMessage),
        false,
      );
      await page.goto("https://app.example/");
      await page.setContent('<iframe src="https://app.example/"></iframe>');
      const frame = page.frames().find((f) => f.parentFrame());
      await frame.waitForLoadState();
      const denied = await frame.evaluate(
        (id) =>
          new Promise((resolve) =>
            chrome.runtime.sendMessage(id, { kind: "hello" }, resolve),
          ),
        id,
      );
      assert.ok(denied.error);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
      await execute(process.execPath, ["scripts/build-extension.mjs"], { env });
    }
  },
);
