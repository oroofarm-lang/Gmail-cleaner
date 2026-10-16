import { existsSync, readFileSync } from "node:fs";
const preview = process.argv.includes("--preview");
const required = [
  "dist/server/index.js",
  "dist/extension/manifest.json",
  "docs/capability-map.md",
  "docs/architecture.md",
  "docs/data-map.md",
  "docs/release-report.md",
  ".github/workflows/ci.yml",
  ".env.example",
];
const missing = required.filter((p) => !existsSync(p));
if (missing.length) {
  console.error("Missing release artifacts:", missing.join(", "));
  process.exit(1);
}
const extension = JSON.parse(
  readFileSync("dist/extension/manifest.json", "utf8"),
);
if (
  extension.manifest_version !== 3 ||
  (extension.host_permissions?.length ?? 0) !== 0
) {
  console.error("Extension safety gate failed");
  process.exit(1);
}
if (preview) {
  console.log(
    "Private engineering preview artifact checks PASS. This is not public release certification.",
  );
  process.exit(0);
}
console.error(
  "NOT READY: live Gmail/AI verification, worker scheduling/PubSub, safe automatic unsubscribe transport, extension pairing, production ingress authentication, accessibility/manual screen reader, operational recovery and external approvals remain required. See docs/release-report.md.",
);
process.exit(1);
