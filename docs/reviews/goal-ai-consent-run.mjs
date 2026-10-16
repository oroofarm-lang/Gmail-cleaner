import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
let source = fs.readFileSync(
  path.join(root, "tests/backend/dispatch.test.mjs"),
  "utf8",
);
source = source.replace(
  'from "typescript"',
  `from "${root}/node_modules/typescript/lib/typescript.js"`,
);
source = source.replace(
  'const root = fileURLToPath(new URL("../../", import.meta.url));',
  `const root = ${JSON.stringify(root)};`,
);
const target = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "inbox-ai-review-")),
  "review.mjs",
);
fs.writeFileSync(
  target,
  source +
    "\n" +
    fs.readFileSync(
      new URL("goal-ai-consent-cases.mjs", import.meta.url),
      "utf8",
    ),
);
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "--test-name-pattern=Independent AI:",
    target,
  ],
  { stdio: "inherit", cwd: root },
);
fs.rmSync(path.dirname(target), { recursive: true });
process.exitCode = result.status ?? 1;
