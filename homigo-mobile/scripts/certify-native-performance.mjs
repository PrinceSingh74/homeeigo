#!/usr/bin/env node
/**
 * Phase 6: Native performance — BLOCKED without physical device profilers.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", ".certification-evidence");

const result = {
  generatedAt: new Date().toISOString(),
  status: "BLOCKED",
  reason: "Android Studio Profiler and Xcode Instruments require physical devices — no synthetic p50/p95/p99 without hardware",
  metrics: {
    fps: { p50: null, p95: null, p99: null },
    cpu: { p50: null, p95: null, p99: null },
    memory: { p50: null, p95: null, p99: null },
    battery: { drainPerHour: null },
    coldStart: { p50: null, p95: null, p99: null },
    warmStart: { p50: null, p95: null, p99: null },
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "native-performance.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(2);
