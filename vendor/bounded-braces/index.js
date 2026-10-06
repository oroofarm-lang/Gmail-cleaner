"use strict";
// Vendored MIT braces 3.0.3: bound input before its recursive parser/compiler.
const upstream = require("./upstream");
function validateString(pattern) {
  if (typeof pattern !== "string") return;
  if (pattern.length > 4096)
    throw new RangeError("Brace pattern exceeds safe length");
  let depth = 0,
    openings = 0,
    alternatives = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
      continue;
    }
    if (pattern[i] === "{") {
      openings++;
      if (++depth > 16)
        throw new RangeError("Brace pattern exceeds safe nesting");
    } else if (pattern[i] === "}") depth = Math.max(0, depth - 1);
    else if (pattern[i] === ",") alternatives++;
  }
  // Conservative upper bound: never allocate combinatorial multi-brace expansions.
  if (openings > 16 || Math.pow(alternatives + 1, openings) > 4096)
    throw new RangeError("Brace expansion exceeds safe complexity");
  for (const match of pattern.matchAll(
    /\{(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?\}/g,
  )) {
    const count =
      Math.ceil(
        Math.abs(Number(match[2]) - Number(match[1])) /
          Math.max(1, Math.abs(Number(match[3] ?? 1))),
      ) + 1;
    if (!Number.isFinite(count) || count > 1024)
      throw new RangeError("Brace range exceeds safe limit");
  }
}
function validate(input) {
  if (typeof input === "string") {
    validateString(input);
    return;
  }
  if (Array.isArray(input)) {
    if (input.length > 256) throw new RangeError("Too many brace patterns");
    for (const pattern of input) {
      if (typeof pattern !== "string")
        throw new RangeError("Brace patterns must be strings");
      validateString(pattern);
    }
    return;
  }
  if (input && typeof input === "object") {
    const stack = [[input, 0]],
      seen = new Set();
    let nodes = 0;
    while (stack.length) {
      const [node, depth] = stack.pop();
      if (depth > 32 || ++nodes > 8192)
        throw new RangeError("Brace AST exceeds safe limits");
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) throw new RangeError("Cyclic brace AST");
      seen.add(node);
      if (Array.isArray(node.nodes))
        for (const child of node.nodes) stack.push([child, depth + 1]);
    }
  }
}
function bounded(input, options) {
  validate(input);
  return upstream(input, { ...options, rangeLimit: 1024 });
}
for (const name of ["parse", "stringify", "compile", "expand", "create"])
  bounded[name] = (input, options) => {
    validate(input);
    return upstream[name](input, { ...options, rangeLimit: 1024 });
  };
module.exports = bounded;
