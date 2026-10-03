/**
 * Coverage check: no script may reach a database without stating which one.
 *
 * The 2026-09-16 incident was not caused by a missing guard — it was caused by a path that did not
 * go through one. A guard that protects four scripts while a fifth hardcodes a live url is not a
 * control, it is a suggestion. This walks `scripts/` and refuses any file that:
 *
 *   a) hardcodes a postgres url naming a non-test database, or
 *   b) runs raw DDL (CREATE/ALTER/DROP/TRUNCATE via $executeRaw*) without importing the guard.
 *
 * Read-only scripts, and scripts whose writes go through the ordinary service layer (which is
 * already bounded by the application's own authorization), are out of scope: this is about
 * schema-level and bulk operations that no request path would ever perform.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SCRIPTS = import.meta.dir;
const GUARD_IMPORT = /ddl-target-guard/;
/**
 * A url literal whose database segment is not a test database.
 *
 * `user:pass@host:port/db` style placeholders inside error messages and regexes are documentation,
 * not connections — they contain no real host, so they are excluded by name rather than by a
 * blanket "ignore anything in a string", which would also hide a genuine hardcoded url.
 */
const HARDCODED_LIVE_URL = /postgres(?:ql)?:\/\/[^\s"'`]*\/(\w+)/gi;
const PLACEHOLDER_HOSTS = /(?:^|[@/])(?:host|hostname|<host>|example\.com)(?::|\/|$)/i;
/** Raw DDL through Prisma's escape hatch. */
const RAW_DDL = /\$executeRaw(?:Unsafe)?[(`][\s\S]{0,200}?\b(CREATE|ALTER|DROP|TRUNCATE)\s/i;

/**
 * Scripts that legitimately name a non-test database and are already guarded, or that only ever
 * READ. Each entry is a decision, not a silencer — adding one is a review-visible act.
 */
const ALLOWED: Record<string, string> = {
  "check-ddl-guard-coverage.ts": "this checker (contains the patterns it searches for)",
  "db-execute-test.ts": "guarded: asserts intent 'test' before invoking prisma",
  "apply-wallet-bonus-consistency.ts": "guarded: per-leg assertDdlTarget, live leg opt-in",
  "apply-withdrawal-idempotency.ts": "guarded: assertDdlTarget before DDL",
  "apply-partner-incentive-enum.ts": "guarded: assertDdlTarget before DDL",
  "setup-test-db.ts":
    "test-only by construction: testDatabaseUrl() falls back to homigo_test and never returns a live url",
  "backup-db.ts": "reads only (pg_dump); backing up the live DB is its purpose",
  "restore-postgres.ts": "operator-run disaster recovery; target is an explicit argument",
};

type Finding = { file: string; reason: string; evidence: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(p, out);
    } else if (entry.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const findings: Finding[] = [];
for (const file of walk(SCRIPTS)) {
  const rel = relative(SCRIPTS, file).split(/[\\/]/).join("/");
  const base = rel.split("/").pop() ?? "";
  if (ALLOWED[base]) continue;
  const src = readFileSync(file, "utf8");
  const guarded = GUARD_IMPORT.test(src);

  if (!guarded) {
    for (const m of src.matchAll(HARDCODED_LIVE_URL)) {
      const db = m[1] ?? "";
      if (!db || /test/i.test(db)) continue;
      if (PLACEHOLDER_HOSTS.test(m[0])) continue; // "postgresql://user:pass@host:port/db" in a message
      findings.push({
        file: rel,
        reason: `hardcodes a url naming the non-test database "${db}" and does not import the DDL guard`,
        evidence: m[0].replace(/:\/\/[^@]*@/, "://***@"),
      });
      break; // one finding per file is enough to fail it
    }

    const ddl = src.match(RAW_DDL);
    if (ddl) {
      findings.push({
        file: rel,
        reason: "runs raw DDL ($executeRaw CREATE/ALTER/DROP/TRUNCATE) without importing the DDL guard",
        evidence: ddl[0].replace(/\s+/g, " ").slice(0, 120),
      });
    }
  }
}

if (findings.length === 0) {
  console.log("[ddl-guard-coverage] OK — every DDL/hardcoded-url script states its target");
  process.exit(0);
}

console.error(`\n${"=".repeat(78)}`);
console.error(`DDL GUARD COVERAGE: ${findings.length} UNGUARDED SCRIPT PATH(S)`);
console.error("=".repeat(78));
for (const f of findings) {
  console.error(`\n  scripts/${f.file}`);
  console.error(`    ${f.reason}`);
  console.error(`    ${f.evidence}`);
}
console.error(`\n${"=".repeat(78)}`);
console.error("A script that reaches a database must state which one:");
console.error('  import { assertDdlTarget, announceDdlTarget } from "../src/lib/ddl-target-guard";');
console.error('  const target = assertDdlTarget("test");   // or "live", which needs HOMIGO_DDL_CONFIRM');
console.error("");
console.error("If a script genuinely needs an exception, add it to ALLOWED in this file WITH a reason.");
console.error("=".repeat(78));
process.exit(1);
