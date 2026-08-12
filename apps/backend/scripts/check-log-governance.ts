/**
 * CI/CD LOG GOVERNANCE GATE — fail the build if anyone tries to re-open the log explosion.
 *
 * Run in CI (and pre-commit). Exits non-zero on any violation:
 *   1. A second writer to `appLogEntry.create` outside the governed persister.
 *   2. The DB allowlist containing anything other than ERROR/CRITICAL.
 *   3. Any .env* configuring LOG_DB_PERSIST_LEVELS with info/warn/debug.
 *   4. The persister bypassing `evaluateLogPersistence`.
 *
 * Usage: bun run scripts/check-log-governance.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const violations: string[] = [];
const GOVERNED_PERSISTER = "src/services/log-aggregation.service.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

// CHECK 1+4: appLogEntry.create must exist ONLY in the governed persister, and that persister must
// route through evaluateLogPersistence.
for (const f of files) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  if (/appLogEntry\s*\.\s*create\b/.test(src) || /prisma\.appLogEntry\.create/.test(src)) {
    if (rel !== GOVERNED_PERSISTER) {
      violations.push(`[C1] ${rel}: writes app_log_entries outside the governed persister. All DB log writes MUST go through ${GOVERNED_PERSISTER}.`);
    } else if (!/evaluateLogPersistence\s*\(/.test(src)) {
      violations.push(`[C4] ${rel}: persister no longer routes through evaluateLogPersistence() — governance bypassed.`);
    }
  }
}

// CHECK 2: the allowlist in log-governance.ts must be ERROR/CRITICAL only.
const gov = readFileSync(join(SRC, "lib/log-governance.ts"), "utf8");
const dbTrue = [...gov.matchAll(/(\w+):\s*\{\s*level:\s*"(\w+)",\s*db:\s*(true|false)/g)];
for (const m of dbTrue) {
  const [, , level, db] = m;
  if (db === "true" && !["error", "critical"].includes(level)) {
    violations.push(`[C2] log-governance LOG_TIERS: level "${level}" has db:true — only error/critical may persist.`);
  }
}

// CHECK 3: no .env* may set LOG_DB_PERSIST_LEVELS to include info/warn/debug.
for (const env of [".env", ".env.example", ".env.production"]) {
  try {
    const txt = readFileSync(join(ROOT, env), "utf8");
    const line = txt.split(/\r?\n/).find((l) => l.startsWith("LOG_DB_PERSIST_LEVELS="));
    if (line) {
      const val = line.split("=")[1]?.toLowerCase() ?? "";
      const bad = ["info", "warn", "debug"].filter((b) => val.includes(b));
      if (bad.length) violations.push(`[C3] ${env}: LOG_DB_PERSIST_LEVELS includes ${bad.join(",")} — forbidden.`);
    }
  } catch { /* env file absent — fine */ }
}

if (violations.length) {
  console.error(`\n❌ LOG GOVERNANCE GATE FAILED (${violations.length} violation(s)):\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\nOnly ERROR and CRITICAL may persist to the database. Fix the above before merging.\n");
  process.exit(1);
}
console.log(`✅ LOG GOVERNANCE GATE PASSED — scanned ${files.length} files. Only ERROR/CRITICAL can reach the DB; single governed writer; no env re-enables INFO/WARN/DEBUG.`);
