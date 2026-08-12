#!/usr/bin/env node
/**
 * Static audit: exactly one NetInfo.addEventListener in the mobile codebase.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, files);
    } else if (/\.(ts|tsx)$/.test(name)) {
      files.push(p);
    }
  }
  return files;
}

const hits = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  if (text.includes("NetInfo.addEventListener")) {
    hits.push(relative(ROOT, file).replace(/\\/g, "/"));
  }
}

const allowed = "src/lib/connectivity/connectivity-service.ts";
const extra = hits.filter((f) => f !== allowed);

if (hits.length !== 1 || extra.length > 0) {
  console.error("[verify:netinfo] FAIL");
  console.error("  Found NetInfo.addEventListener in:", hits);
  console.error("  Expected exactly:", allowed);
  process.exit(1);
}

console.log("[verify:netinfo] PASS — exactly 1 NetInfo subscription in connectivity-service.ts");
