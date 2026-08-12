#!/usr/bin/env node
/**
 * CI regression gate — fast startup deadlock + guard checks.
 * Fails build if startup can hang or known anti-patterns reappear.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");
const REPO = join(ROOT, "..");

const steps = [
  { name: "lint-guards", cmd: "node", args: [join(DIR, "startup-lint-guards.mjs")] },
  { name: "scenario-matrix", cmd: "node", args: [join(DIR, "startup-scenario-matrix.mjs")] },
  { name: "performance-budgets", cmd: "node", args: [join(DIR, "startup-performance-budget-check.mjs")] },
  { name: "certification", cmd: "node", args: [join(DIR, "startup-certification.mjs")] },
];

let failed = 0;

console.log("========================================");
console.log(" HOMIGO MOBILE — STARTUP REGRESSION CI");
console.log("========================================\n");

for (const step of steps) {
  const res = spawnSync(step.cmd, step.args, { cwd: REPO, stdio: "inherit", shell: false });
  if (res.status !== 0) {
    console.error(`\n[FAIL] ${step.name} (exit ${res.status ?? "signal"})`);
    failed++;
  } else {
    console.log(`\n[PASS] ${step.name}`);
  }
}

console.log("\n========================================");
if (failed) {
  console.error(` REGRESSION CI: FAIL (${failed} step(s))`);
  process.exit(1);
}
console.log(" REGRESSION CI: PASS");
process.exit(0);
