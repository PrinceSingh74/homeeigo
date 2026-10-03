/**
 * Gate: the deployed alert rules must be a copy of the canonical ones, not a parallel tree.
 *
 * WHY
 * ---
 * On 2026-09-21 the repository defined **111** alert rules and the running Prometheus had **27** —
 * verified against `/api/v1/rules`, not inferred from files. The local stack was mounting a snapshot
 * taken on 2026-07-04. Everything added in the three months between was dead, including every
 * money-integrity alert:
 *
 *     WalletLiabilityDrift · WalletLiabilityMismatch · ProviderPayableDrift · FinancialIntegrityBelow100
 *
 * At the same time, `financial_integrity_runs` was recording a WALLET_LIABILITY_MISMATCH failure on
 * **every single run**. The detector was firing into a table with nobody watching, because the alert
 * that watches it had never reached the runtime.
 *
 * The mount is fixed. This gate exists because the mount was only half the problem: rules live in
 * more than one physical place, and a hand-maintained second copy drifts silently. A stale copy is
 * worse than no copy — the repository shows coverage the runtime does not have, and nothing
 * reconciles the two.
 *
 * DESIGN
 * ------
 * The deploy tree is treated as a GENERATED ARTIFACT. It is compared byte-for-byte, which is only a
 * fair test because `--sync` produces it by copying. A semantic comparison would tolerate the
 * formatting differences that let two files hold the same alerts today and different ones tomorrow.
 *
 *   bun run scripts/check-alert-rule-drift.ts          # CI: fail on any difference
 *   bun run scripts/check-alert-rule-drift.ts --sync   # regenerate the deploy copy
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const BACKEND = resolve(import.meta.dir, "..");
const REPO = resolve(BACKEND, "..", "..");

/** The one source of truth. Every other rule tree is derived from this. */
const CANONICAL = join(BACKEND, "monitoring", "rules");

/**
 * Trees that must mirror the canonical one.
 *
 * `monitoring/_obsstack` is deliberately absent: its compose file now mounts `../rules` directly, so
 * it has no copy to drift. That is the preferred shape — a mount, not a duplicate.
 */
const MIRRORS = [
  { label: "staging deploy", dir: join(REPO, "deploy", "observability", "staging", "rules") },
];

const SYNC = process.argv.includes("--sync");

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const ruleFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yml")).sort() : []);

const canonicalFiles = ruleFiles(CANONICAL);
if (canonicalFiles.length === 0) {
  console.error(`[alert-rule-drift] REFUSING — no canonical rule files at ${CANONICAL}`);
  process.exit(2);
}

type Problem = { mirror: string; file: string; kind: "MISSING" | "DIFFERENT" | "EXTRA" };
const problems: Problem[] = [];
let synced = 0;

for (const mirror of MIRRORS) {
  if (!existsSync(mirror.dir)) {
    console.error(`[alert-rule-drift] REFUSING — mirror directory missing: ${mirror.dir}`);
    process.exit(2);
  }

  for (const file of canonicalFiles) {
    const src = join(CANONICAL, file);
    const dst = join(mirror.dir, file);
    if (!existsSync(dst)) {
      if (SYNC) { copyFileSync(src, dst); synced++; }
      else problems.push({ mirror: mirror.label, file, kind: "MISSING" });
      continue;
    }
    if (sha(src) !== sha(dst)) {
      if (SYNC) { copyFileSync(src, dst); synced++; }
      else problems.push({ mirror: mirror.label, file, kind: "DIFFERENT" });
    }
  }

  // A file the mirror has and canonical does not is an alert nobody can see in the source of truth.
  for (const file of ruleFiles(mirror.dir)) {
    if (!canonicalFiles.includes(file)) problems.push({ mirror: mirror.label, file, kind: "EXTRA" });
  }
}

if (SYNC) {
  console.log(`[alert-rule-drift] SYNCED — ${synced} file(s) regenerated from ${CANONICAL}`);
  process.exit(0);
}

if (problems.length === 0) {
  const total = canonicalFiles.reduce(
    (n, f) => n + (readFileSync(join(CANONICAL, f), "utf8").match(/^\s*- alert:/gm) ?? []).length,
    0,
  );
  console.log(
    `[alert-rule-drift] OK — ${MIRRORS.length} mirror(s) match canonical ` +
      `(${canonicalFiles.length} file(s), ${total} alert rules)`,
  );
  process.exit(0);
}

console.error(`
==============================================================================
ALERT RULE DRIFT: ${problems.length} PROBLEM(S)
==============================================================================
`);
for (const p of problems) {
  const why =
    p.kind === "MISSING" ? "not present in the deploy tree — this alert would not load"
    : p.kind === "DIFFERENT" ? "differs from canonical — the deployed set is not what the repo shows"
    : "exists only in the deploy tree — invisible in the source of truth";
  console.error(`  [${p.kind.padEnd(9)}] ${p.mirror}: ${p.file}\n              ${why}`);
}
console.error(`
The deploy rule tree is a GENERATED ARTIFACT, not a place to edit rules. Edit
apps/backend/monitoring/rules/ and regenerate:

    bun run scripts/check-alert-rule-drift.ts --sync

This gate exists because a stale copy of this exact tree left 84 of 111 alerts unloaded at runtime,
including every money-integrity alert, while the repository showed full coverage.
==============================================================================
`);
process.exit(1);
