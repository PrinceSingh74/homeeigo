/**
 * P2 — Wallet Integrity Check (runnable; REUSES financialIntegrityService).
 *
 * Run this BEFORE and AFTER a wallet load test to prove no double-spend, no
 * negative balances, and no ledger drift were introduced under concurrency.
 * It does not reimplement invariants — it invokes the production integrity
 * validator (src/services/financial-integrity.service.ts) and maps its findings
 * to the P2 wallet criteria.
 *
 *   bun --env-file=.env run scripts/p2-validation/wallet-integrity-check.ts
 *
 * Exit 0 only when zero CRITICAL/HIGH issues across the wallet invariants.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { financialIntegrityService } from "../../src/services/financial-integrity.service";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "..", "docs", "p2", "evidence");

// P2 wallet criteria → the integrity categories that would violate them.
const CRITERIA: Record<string, string[]> = {
  "No double-spend": ["DUPLICATE_PAYOUT", "DUPLICATE_JOURNAL"],
  "No negative balance": ["NEGATIVE_BALANCE", "NEGATIVE_PROVIDER_BALANCE"],
  "No ledger drift": [
    "LEDGER_IMBALANCE",
    "WALLET_LIABILITY_MISMATCH",
    "PROVIDER_PAYABLE_MISMATCH",
    "HCOIN_LIABILITY_MISMATCH",
    "GIFT_CARD_LIABILITY_DRIFT",
    "CASHBACK_LIABILITY_DRIFT",
    "MISSING_LEDGER_ENTRY",
    "ORPHAN_JOURNAL",
  ],
};

async function main() {
  let result;
  try {
    result = await financialIntegrityService.validate();
  } catch (e) {
    await emit(null, e instanceof Error ? e.message : String(e));
    console.error("[wallet-integrity] FAILED to run (DB unreachable?):", e instanceof Error ? e.message : e);
    process.exit(2);
  }

  const byCriterion = Object.entries(CRITERIA).map(([criterion, cats]) => {
    const hits = result.issues.filter((i) => cats.includes(i.category));
    return { criterion, violated: hits.length > 0, count: hits.length, examples: hits.slice(0, 3).map((h) => `${h.category}:${h.details}`) };
  });

  await emit({ result, byCriterion }, "");

  const anyViolation = byCriterion.some((c) => c.violated);
  console.error(`\n[wallet-integrity] score=${result.score}/100 status=${result.status} critical=${result.bySeverity.critical} warning=${result.bySeverity.warning}`);
  for (const c of byCriterion) console.error(`  ${c.violated ? "❌" : "✅"} ${c.criterion} (${c.count})`);
  console.error(`[wallet-integrity] evidence → docs/p2/evidence/wallet-integrity.md`);
  process.exit(anyViolation ? 1 : 0);
}

async function emit(
  data: { result: Awaited<ReturnType<typeof financialIntegrityService.validate>>; byCriterion: Array<{ criterion: string; violated: boolean; count: number; examples: string[] }> } | null,
  error: string,
) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md: string[] = [];
  md.push("# Evidence — Wallet Integrity Report");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  if (!data) {
    md.push("");
    md.push(`> **NOT VERIFIED** — could not run: ${error}`);
  } else {
    md.push(`Integrity score: **${data.result.score}/100**  ·  Status: **${data.result.status}**  ·  CRITICAL=${data.result.bySeverity.critical} WARNING=${data.result.bySeverity.warning} INFO=${data.result.bySeverity.info}`);
    md.push("");
    md.push("## P2 Wallet Criteria");
    md.push("| Criterion | Result | Violations | Examples |");
    md.push("|---|:--:|--:|---|");
    for (const c of data.byCriterion) md.push(`| ${c.criterion} | ${c.violated ? "FAIL ❌" : "PASS ✅"} | ${c.count} | ${c.examples.join("; ").replace(/\|/g, "\\|").slice(0, 200) || "—"} |`);
    md.push("");
    md.push("## All issues");
    if (data.result.issues.length === 0) md.push("- None — all invariants hold.");
    for (const i of data.result.issues) md.push(`- [${i.level}] ${i.category}${i.referenceId ? ` (${i.referenceId})` : ""}: ${i.details}`);
  }
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "wallet-integrity.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "wallet-integrity.json"), JSON.stringify({ error, ...data, generatedAt: new Date().toISOString() }, null, 2), "utf8");
}

main().catch((e) => {
  console.error("[wallet-integrity] fatal:", e);
  process.exit(3);
});
