#!/usr/bin/env node
/** Verify mobile startup alert rules exist in homigo-alerts.yml */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rulesPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "backend", "monitoring", "rules", "homigo-alerts.yml");
const yaml = readFileSync(rulesPath, "utf8");

const required = [
  "MobileStartupDurationP95High",
  "MobileStartupFailureRateHigh",
  "MobileAuthBootstrapFailureHigh",
  "MobileHydrationTimeoutHigh",
];

const missing = required.filter((name) => !yaml.includes(`alert: ${name}`));

if (missing.length) {
  console.error("[verify:alerts] FAIL — missing rules:", missing.join(", "));
  process.exit(1);
}

console.log("[verify:alerts] PASS — all 4 mobile startup alert rules present in homigo-alerts.yml");
