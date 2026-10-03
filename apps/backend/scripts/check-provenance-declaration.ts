/**
 * Gate: a script that creates business-shaped rows must declare where that data came from.
 *
 * WHY
 * ---
 * On 2026-09-21, 97% of `refund_requests` were certification or test artifacts and the only record
 * of that fact was free text somebody happened to type into `reason`. 289 rows said "f2 cert",
 * 38 said something E2E-ish, and every refund analytic in the platform was computed over that
 * population as though it were business activity.
 *
 * `data_origin` now exists. The obvious next step — hand-editing the 43 scripts that create this
 * data — is not a control: it fixes today and does nothing about the 44th script. A future
 * certification run that omits the field is once again indistinguishable from real business, which
 * is the exact defect the column was added to prevent.
 *
 * So the rule is enforced the same way `check-ddl-guard-coverage` enforces "a script that reaches a
 * database must state which one": mechanically, at the gate.
 *
 * SCOPE
 * -----
 * New and modified scripts only, detected through git, matching `check-migration-safety`. Scanning
 * the full history would fail on 43 pre-existing files and the gate would be disabled within a day.
 * Anything touched from now on has to comply. `--all` audits everything.
 *
 *   bun run scripts/check-provenance-declaration.ts
 *   bun run scripts/check-provenance-declaration.ts --all
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** Tables that carry `data_origin`. Keep in step with the DataOrigin migration. */
const GUARDED_MODELS = ["refundRequest", "booking", "user"] as const;

/** Creating rows in these ways produces business-shaped data. */
const CREATE_RE = new RegExp(`\\.(${GUARDED_MODELS.join("|")})\\.(create|createMany|upsert)\\s*\\(`, "g");

/** The declaration that satisfies the gate. */
const DECLARES_RE = /\bdataOrigin\s*:/;

/**
 * Scripts that legitimately create these rows without declaring an origin.
 *
 * Each needs a stated reason. An entry without one is not an exception, it is an unreviewed bypass.
 */
const ALLOWED: Record<string, string> = {
  "scripts/provenance-report.ts":
    "Backfills data_origin on existing rows; it classifies rather than creates, and never inserts.",
};

function allScriptFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) allScriptFiles(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function changedScripts(): string[] | null {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const run = (cmd: string) => execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const untracked = run("git ls-files --others --exclude-standard -- scripts").split(/\r?\n/);
    const base = process.env.MIGRATION_SAFETY_BASE?.trim();
    const diffRef = base && /^[0-9a-f]{7,40}$/i.test(base) ? `${base}...HEAD` : "HEAD";
    const changed = run(`git diff --name-only --diff-filter=AM ${diffRef} -- scripts`).split(/\r?\n/);
    return [...new Set([...untracked, ...changed])]
      .map((l) => l.trim())
      .filter((l) => l.endsWith(".ts"))
      .map((rel) => join(ROOT, rel));
  } catch {
    // No git. Fall back to the full scan — check everything rather than silently check nothing.
    return null;
  }
}

const all = process.argv.includes("--all");
const fresh = all ? null : changedScripts();
const files = (fresh ?? allScriptFiles(join(ROOT, "scripts"))).filter((f) => existsSync(f));
const scope = all
  ? "ALL scripts (full audit)"
  : fresh
    ? `${files.length} new/modified script(s)`
    : "ALL scripts (git unavailable; failing safe)";

type Violation = { file: string; model: string; line: number };
const violations: Violation[] = [];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWED[rel]) continue;

  let src = "";
  try { src = readFileSync(file, "utf8"); } catch { continue; }

  CREATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const hits: Violation[] = [];
  while ((m = CREATE_RE.exec(src))) {
    hits.push({ file: rel, model: m[1]!, line: src.slice(0, m.index).split("\n").length });
  }
  if (hits.length === 0) continue;

  // A single declaration anywhere in the file is accepted: these scripts commonly build a shared
  // payload once. The gate is about intent being stated, not about where it is stated.
  if (!DECLARES_RE.test(src)) violations.push(...hits);
}

if (violations.length === 0) {
  console.log(`[provenance-declaration] OK — every script creating business rows declares an origin (${scope})`);
  process.exit(0);
}

const byFile = new Map<string, Violation[]>();
for (const v of violations) {
  byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
}

console.error(`
==============================================================================
PROVENANCE NOT DECLARED: ${byFile.size} SCRIPT(S)
==============================================================================
`);
for (const [file, vs] of byFile) {
  console.error(`  ${file}`);
  for (const v of vs) console.error(`    :${v.line}  creates prisma.${v.model}.* without dataOrigin`);
}
console.error(`
A script that creates business-shaped rows must say what they are:

    data: { ..., dataOrigin: "CERTIFICATION" }   // or TEST / FIXTURE / SYNTHETIC / REAL

97% of refund_requests are certification or test artifacts, and before data_origin existed the only
record of that was prose in a 'reason' field. Rows created without a declared origin are counted as
real business activity by src/lib/analytics-scope.ts.

If a script genuinely must not declare one, add it to ALLOWED in this file WITH a reason.
==============================================================================
`);
process.exit(1);
