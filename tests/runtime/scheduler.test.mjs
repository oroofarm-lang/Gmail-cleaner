import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const execute = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "production worker scheduled handler executes against isolated local D1 without mailbox access",
  { timeout: 90000 },
  async () => {
    const work = await mkdtemp(path.join(tmpdir(), "inbox-scheduler-runtime-"));
    const env = {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_CF_FETCH_ENABLED: "false",
      WRANGLER_LOG_PATH: path.join(work, "wrangler.log"),
    };
    for (const key of Object.keys(env))
      if (
        /^(GOOGLE_|OPENAI_|TOKEN_ENCRYPTION_KEY|GMAIL_SYNC_SCHEDULER)/.test(key)
      )
        delete env[key];
    const config = JSON.parse(
      await readFile(path.join(root, "dist/server/wrangler.json"), "utf8"),
    );
    config.name = "inbox-scheduler-runtime-test";
    // Wrangler injects its native scheduled-event test middleware only when bundling.
    config.no_bundle = false;
    config.main = path.join(root, "dist/server/index.js");
    config.assets = { directory: path.join(root, "dist/client") };
    config.vars = {
      GMAIL_SYNC_SCHEDULER: "enabled",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_REDIRECT_URI: "",
      TOKEN_ENCRYPTION_KEY: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
    };
    for (const db of config.d1_databases)
      db.migrations_dir = path.join(root, "drizzle");
    const file = path.join(work, "wrangler.json");
    await writeFile(file, JSON.stringify(config));
    const dbName = config.d1_databases.find(
      (db) => db.binding === "DB",
    ).database_name;
    const local = [
      "--config",
      file,
      "--local",
      "--persist-to",
      path.join(work, "state"),
    ];
    let server,
      logs = "";
    try {
      await execute(
        process.execPath,
        [cli, "d1", "migrations", "apply", dbName, ...local],
        { cwd: work, env, timeout: 30000 },
      );
      const reservation = createServer();
      await new Promise((resolve) =>
        reservation.listen(0, "127.0.0.1", resolve),
      );
      const port = reservation.address().port;
      await new Promise((resolve) => reservation.close(resolve));
      server = spawn(
        process.execPath,
        [
          cli,
          "dev",
          ...local,
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--inspector-port",
          "0",
          "--test-scheduled",
        ],
        { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      for (const stream of [server.stdout, server.stderr])
        stream.on("data", (chunk) => {
          logs = (logs + chunk).slice(-4000);
        });
      const deadline = Date.now() + 40000;
      let ready = false;
      while (Date.now() < deadline && server.exitCode === null) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {}
        await delay(200);
      }
      assert.ok(ready, `isolated worker did not start: ${logs}`);
      const response = await fetch(
        `http://127.0.0.1:${port}/__scheduled?cron=*+*+*+*+*`,
        { signal: AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 200, await response.text());
      const query =
        "SELECT last_tick,(SELECT COUNT(*) FROM credentials) credentials,(SELECT COUNT(*) FROM sync_schedules) schedules FROM scheduler_health WHERE id='gmail-sync'";
      const result = await execute(
        process.execPath,
        [cli, "d1", "execute", dbName, ...local, "--command", query, "--json"],
        { cwd: work, env, timeout: 15000 },
      );
      const rows = JSON.parse(result.stdout)[0].results;
      assert.equal(rows.length, 1);
      assert.ok(Date.now() - rows[0].last_tick < 30000);
      assert.equal(rows[0].credentials, 0);
      assert.equal(rows[0].schedules, 0);
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => server.once("exit", resolve)),
          delay(5000),
        ]);
        if (server.exitCode === null) server.kill("SIGKILL");
      }
      await rm(work, { recursive: true, force: true });
    }
  },
);
