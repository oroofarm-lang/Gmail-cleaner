import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const micromatch = require("micromatch");
const braces = require(
  require.resolve("braces", { paths: [require.resolve("micromatch")] }),
);
test("patched brace parser rejects resource-exhaustion payloads before recursion", () => {
  const nested = "{".repeat(30000) + "a" + "}".repeat(30000);
  for (const method of [
    braces,
    braces.parse,
    braces.compile,
    braces.expand,
    braces.create,
    braces.stringify,
  ])
    assert.throws(() => method(nested), RangeError);
  assert.throws(() => braces.expand("{1..999999999}"), RangeError);
  assert.throws(() => braces.expand("{a,b}".repeat(30)), RangeError);
  const cyclic = { nodes: [] };
  cyclic.nodes.push(cyclic);
  assert.throws(() => braces.stringify(cyclic), RangeError);
  const patterns = [];
  patterns.push(patterns);
  assert.throws(() => braces(patterns), RangeError);
});
test("bounded fork preserves application build globs", () => {
  assert.deepEqual(braces.expand("app/*.{ts,tsx}"), ["app/*.ts", "app/*.tsx"]);
  assert.deepEqual(
    micromatch(["app/page.tsx", "app/a.ts", "public/a.svg"], "app/*.{ts,tsx}"),
    ["app/page.tsx", "app/a.ts"],
  );
  assert.deepEqual(braces.expand("{1..3}"), ["1", "2", "3"]);
});
