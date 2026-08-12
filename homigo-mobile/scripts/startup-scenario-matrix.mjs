#!/usr/bin/env node
/**
 * Maps Phase 4 regression scenarios → certification harness phases.
 * Fails if certification script stops covering a required scenario.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cert = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "startup-certification.mjs"),
  "utf8",
);

const REQUIRED = [
  { scenario: "cold-start", certPhase: "phase1", pattern: /async function phase1/ },
  { scenario: "warm-start", certPhase: "phase11", pattern: /warmStartAvgMs/ },
  { scenario: "kill-reopen", certPhase: "phase3", pattern: /crash recovery/ },
  { scenario: "offline-start", certPhase: "phase4", pattern: /offline then online/ },
  { scenario: "expired-token", certPhase: "phase7", pattern: /expired-token/ },
  { scenario: "corrupt-storage", certPhase: "phase8", pattern: /corrupt AsyncStorage/ },
  { scenario: "backend-unavailable", certPhase: "phase5", pattern: /backend unavailable/ },
];

const missing = REQUIRED.filter((r) => !r.pattern.test(cert));

if (missing.length) {
  console.error("[FAIL] startup-scenario-matrix — certification missing scenarios:");
  for (const m of missing) console.error(`  - ${m.scenario} (${m.certPhase})`);
  process.exit(1);
}

console.log("[PASS] startup-scenario-matrix — all Phase 4 scenarios mapped to certification");
for (const r of REQUIRED) {
  console.log(`  ${r.scenario} → ${r.certPhase}`);
}
process.exit(0);
