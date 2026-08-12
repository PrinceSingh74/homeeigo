/**
 * War room final certification — evidence-based PASS/FAIL only.
 * Run: bun --env-file=.env run scripts/war-room/finance-war-room-certify.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import prisma from "../../src/lib/prisma";
import { financialIntegrityService } from "../../src/services/financial-integrity.service";
import { paymentReconciliationService } from "../../src/services/payment-reconciliation.service";

const DOCS = join(import.meta.dir, "../../docs/war-room");
const r2 = (n: number) => Math.round(n * 100) / 100;

mkdirSync(DOCS, { recursive: true });

async function ledgerBalance(code: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ bal: number }[]>(
    `SELECT COALESCE(SUM(le.credit) - SUM(le.debit), 0)::float AS bal
     FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id WHERE la.code = $1`,
    code,
  );
  return r2(Number(rows[0]?.bal ?? 0));
}

async function main() {
  const fi = await financialIntegrityService.validate();
  const metrics = await paymentReconciliationService.metricsSummary();

  const successTotal = await prisma.payment.count({ where: { status: "SUCCESS" } });
  const settledTotal = await prisma.payment.count({ where: { status: "SUCCESS", settlementId: { not: null } } });
  const pendingGrace = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT count(*)::int n FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL
      AND EXTRACT(day FROM now() - COALESCE(completed_at, created_at)) < 3
  `);
  const overdueUnsettled = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT count(*)::int n FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL
      AND EXTRACT(day FROM now() - COALESCE(completed_at, created_at)) >= 3
  `);
  const pendingGraceN = pendingGrace[0]?.n ?? 0;
  const overdueN = overdueUnsettled[0]?.n ?? 0;
  const settlementAccuracy = successTotal > 0 ? r2(((settledTotal + pendingGraceN) / successTotal) * 100) : 100;
  const matchRate = metrics.matchPct;

  const walletOps = r2(Number((await prisma.user.aggregate({ _sum: { walletBalance: true } }))._sum.walletBalance ?? 0));
  const walletLedger = Math.abs(await ledgerBalance("CUSTOMER_WALLET"));
  const provOps = r2(Number((await prisma.provider.aggregate({ _sum: { walletBalance: true } }))._sum.walletBalance ?? 0));
  const provLedger = Math.abs(await ledgerBalance("PROVIDER_PAYABLE"));
  const walletDrift = Math.abs(walletOps - walletLedger);
  const provDrift = Math.abs(provOps - provLedger);

  const unbal = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING ABS(SUM(debit)-SUM(credit))>0.01) x`,
  );

  const blockers: string[] = [];
  if (fi.score < 100 || fi.status !== "PASS") blockers.push(`Financial integrity ${fi.status} score=${fi.score}`);
  if (overdueN > 0) blockers.push(`${overdueN} payments overdue unsettled (>${3}d grace)`);
  if (settlementAccuracy < 99) blockers.push(`Settlement accuracy ${settlementAccuracy}% < 99%`);
  if (matchRate < 98) blockers.push(`Match rate ${matchRate}% < 98%`);
  if (walletDrift > 0.01) blockers.push(`Wallet drift ₹${walletDrift}`);
  if (provDrift > 0.01) blockers.push(`Provider payable drift ₹${provDrift}`);
  if (unbal[0].n > 0) blockers.push(`Unbalanced journals: ${unbal[0].n}`);

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Enterprise Payment Certification

Generated: ${new Date().toISOString()}

## Scores (evidence-based)

| Metric | Value | Target | Status |
|--------|------:|--------|--------|
| Financial Integrity | ${fi.score}/100 | 100 | ${fi.status === "PASS" && fi.score >= 100 ? "✅" : "❌"} |
| Settlement Accuracy | ${settlementAccuracy}% | >99% | ${settlementAccuracy >= 99 ? "✅" : "❌"} |
| Match Rate | ${matchRate}% | >98% | ${matchRate >= 98 ? "✅" : "❌"} |
| Wallet Drift | ₹${walletDrift} | 0 | ${walletDrift <= 0.01 ? "✅" : "❌"} |
| Provider Payable Drift | ₹${provDrift} | 0 | ${provDrift <= 0.01 ? "✅" : "❌"} |
| Unbalanced Journals | ${unbal[0].n} | 0 | ${unbal[0].n === 0 ? "✅" : "❌"} |
| Local Issues (open) | ${metrics.localIssues} | 0 | ${metrics.localIssues === 0 ? "✅" : "❌"} |
| Gateway Issues | ${metrics.gatewayIssues} | 0 | ${metrics.gatewayIssues === 0 ? "✅" : "❌"} |

## SQL Evidence

\`\`\`sql
-- Settlement coverage
SELECT count(*) FILTER (WHERE settlement_id IS NOT NULL) AS settled,
       count(*) AS total
FROM payments WHERE status = 'SUCCESS';
\`\`\`
Result: settled=${settledTotal} total=${successTotal}

## Final Verdict: **${verdict}**

${blockers.length > 0 ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All certification gates passed."}
`;

  writeFileSync(join(DOCS, "enterprise-payment-certification.md"), md);

  // Match rate report
  writeFileSync(
    join(DOCS, "match-rate-improvement-report.md"),
    `# Match Rate Improvement Report\n\nGenerated: ${new Date().toISOString()}\n\n| Metric | Before (avg historical) | After (latest run) |\n|--------|------------------------:|-------------------:|\n| Match % | ${metrics.avgMatchPct}% | ${matchRate}% |\n| Settled payments | ${settledTotal}/${successTotal} | ${settlementAccuracy}% |\n| Unsettled | ${successTotal - settledTotal} | — |\n`,
  );

  console.log(`Verdict: ${verdict}`);
  console.log(`Integrity=${fi.score} Settlement=${settlementAccuracy}% Match=${matchRate}%`);
  if (blockers.length) console.log("Blockers:", blockers.join("; "));
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
