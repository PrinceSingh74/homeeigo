/**
 * Finance Integrity & Settlement Reconciliation Remediation
 *
 *   bun --env-file=.env run scripts/recovery/finance-remediation.ts --collect-before
 *   bun --env-file=.env run scripts/recovery/finance-remediation.ts --apply
 *   bun --env-file=.env run scripts/recovery/finance-remediation.ts --collect-after
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SettlementResolutionStatus } from "@prisma/client";
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { financialIntegrityService } from "../../src/services/financial-integrity.service";
import { paymentReconciliationService } from "../../src/services/payment-reconciliation.service";
import { settlementSyncService } from "../../src/services/settlement-sync.service";
import { settlementService } from "../../src/services/settlement.service";
import { settlementResolutionService } from "../../src/services/settlement-resolution.service";
import { financeValidationService } from "../../src/services/finance-validation.service";
import { ledgerBackfillService } from "../../src/services/ledger-backfill.service";
import { ledgerReconciliationService } from "../../src/services/ledger-reconciliation.service";
import { financialLedgerService } from "../../src/services/financial-ledger.service";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const EVIDENCE = join(REPO, "docs", "finance-remediation-evidence.json");

const mode = process.argv.find((a) => a.startsWith("--")) ?? "--collect-before";

async function collectMetrics(label: string) {
  const [
    integrity,
    reconMetrics,
    syncMetrics,
    syncHealth,
    financeValidation,
    paymentStats,
    issueBreakdown,
    discrepancyBreakdown,
    giftCardStats,
    escrowLedger,
    giftLiability,
    missingGiftJournals,
    mappingFailures,
    overdueUnsettled,
    pendingGrace,
  ] = await Promise.all([
    financialIntegrityService.validate(),
    paymentReconciliationService.metricsSummary(),
    settlementSyncService.metricsSummary(),
    settlementResolutionService.healthScore(),
    financeValidationService.runFullValidation(),
    prisma.$queryRawUnsafe<Array<{ success_total: number; settled_total: number }>>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success_total,
        COUNT(*) FILTER (WHERE status = 'SUCCESS' AND settlement_id IS NOT NULL)::int AS settled_total
      FROM payments`),
    prisma.$queryRawUnsafe<Array<{ issue_type: string; cnt: number }>>(`
      SELECT issue_type, COUNT(*)::int AS cnt FROM reconciliation_issues
      WHERE issue_type IN ('MISMATCH','MISSING_GATEWAY','SETTLEMENT_MISMATCH','REFUND_MISMATCH','SETTLEMENT_PENDING')
      GROUP BY issue_type ORDER BY cnt DESC`),
    prisma.$queryRawUnsafe<Array<{ type: string; resolved: boolean; cnt: number }>>(`
      SELECT type, resolved, COUNT(*)::int AS cnt FROM settlement_discrepancies
      GROUP BY type, resolved ORDER BY type, resolved`),
    prisma.$queryRawUnsafe<Array<{ issued: number; redeemed: number; refunded: number; outstanding: number }>>(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'PURCHASE'), 0)::float AS issued,
        COALESCE(SUM(amount) FILTER (WHERE type = 'REDEEM'), 0)::float AS redeemed,
        COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0)::float AS refunded,
        (SELECT COALESCE(SUM(balance), 0) FROM gift_cards WHERE status = 'ACTIVE')::float AS outstanding
      FROM gift_card_transactions`),
    financialLedgerService.getAccountBalance("PLATFORM_ESCROW"),
    prisma.giftCard.aggregate({ where: { status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.$queryRawUnsafe<Array<{ id: string; code: string; amount: number; balance: number }>>(`
      SELECT gc.id, gc.code, gc.amount, gc.balance
      FROM gift_cards gc
      LEFT JOIN journal_entries je ON je.idempotency_key = 'gift_card:' || gc.id
      WHERE gc.status IN ('ACTIVE','REDEEMED','EXPIRED') AND je.id IS NULL
      LIMIT 20`),
    prisma.$queryRawUnsafe<Array<{ payment_id: string; settlement_id: string }>>(`
      SELECT p.id AS payment_id, ps.settlement_id
      FROM payments p JOIN payment_settlements ps ON ps.payment_id = p.id
      WHERE p.settlement_id IS NULL LIMIT 20`),
    prisma.$queryRawUnsafe<Array<{ id: string; age_days: number }>>(`
      SELECT id, EXTRACT(EPOCH FROM (now() - COALESCE(completed_at, created_at))) / 86400 AS age_days
      FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL
        AND EXTRACT(EPOCH FROM (now() - COALESCE(completed_at, created_at))) / 86400 >= 3
      LIMIT 20`),
    prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT COUNT(*)::int AS n FROM payments
      WHERE status = 'SUCCESS' AND settlement_id IS NULL
        AND EXTRACT(EPOCH FROM (now() - COALESCE(completed_at, created_at))) / 86400 < 3`),
  ]);

  const stats = paymentStats[0] ?? { success_total: 0, settled_total: 0 };

  return {
    label,
    timestamp: new Date().toISOString(),
    financialIntegrityScore: integrity.score,
    integrityIssues: integrity.issues.map((i) => ({
      category: i.category,
      severity: i.severity,
      details: i.details,
      penalty:
        i.severity === "CRITICAL" ? 15 : i.severity === "HIGH" ? 8 : i.severity === "MEDIUM" ? 4 : 2,
    })),
    reconciliation: {
      matchRate: reconMetrics.matchPct,
      matchedPayments: reconMetrics.matchedPayments,
      successPayments: reconMetrics.successPayments,
      settlementPending: reconMetrics.settlementPending,
      localIssues: reconMetrics.localIssues,
      issueBreakdown,
    },
    settlementSync: {
      accuracyPct: syncMetrics.settlementAccuracyPct,
      openDiscrepancies: syncMetrics.openDiscrepancies,
      ...syncHealth,
    },
    financeValidation: {
      status: financeValidation.status,
      score: financeValidation.score,
      failedChecks: financeValidation.checks.filter((c) => c.status === "FAIL"),
    },
    giftCards: {
      issued: giftCardStats[0]?.issued ?? 0,
      redeemed: giftCardStats[0]?.redeemed ?? 0,
      refunded: giftCardStats[0]?.refunded ?? 0,
      outstanding: giftCardStats[0]?.outstanding ?? 0,
      escrowLedger,
      giftLiability: giftLiability._sum.balance ?? 0,
      drift: (giftLiability._sum.balance ?? 0) - escrowLedger,
      missingJournals: missingGiftJournals,
    },
    settlement: {
      successTotal: stats.success_total,
      settledTotal: stats.settled_total,
      mappingFailures,
      overdueUnsettled,
      pendingGrace: pendingGrace[0]?.n ?? 0,
    },
    discrepancyBreakdown,
  };
}

async function linkRemainingUnsettled(): Promise<number> {
  const batches = await prisma.settlementBatch.findMany({ orderBy: { settledAt: "asc" } });
  let total = 0;
  for (const batch of batches) {
    const linked = await settlementService.linkPaymentsToBatch(batch.id, batch.settlementId, {
      targetAmount: batch.amount,
      settledAt: batch.settledAt ?? new Date(),
      gatewayReference: batch.gatewayReference ?? batch.settlementId,
    });
    total += linked;
  }
  return total;
}

async function purgeResolvedReconciliationIssues(): Promise<number> {
  const n = await prisma.$executeRawUnsafe(`
    DELETE FROM reconciliation_issues ri
    USING payments p
    WHERE ri.reference_id = p.id
      AND ri.issue_type IN ('SETTLEMENT_MISMATCH', 'SETTLEMENT_PENDING')
      AND p.settlement_id IS NOT NULL
  `);
  return Number(n);
}

async function resolveUnknownSettlements() {
  const open = await prisma.settlementDiscrepancy.findMany({
    where: { type: "UNKNOWN_SETTLEMENT", resolved: false },
  });
  let resolved = 0;
  for (const d of open) {
    const batch = await prisma.settlementBatch.findUnique({ where: { settlementId: d.referenceId } });
    if (batch) {
      await prisma.settlementDiscrepancy.update({
        where: { id: d.id },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          status: SettlementResolutionStatus.RESOLVED,
          resolutionNotes: "Auto-resolved: settlement batch imported and linked",
        },
      });
      resolved += 1;
    }
  }
  return resolved;
}

async function applyRemediation() {
  const audit: string[] = [];

  // 1. Backfill settlement_id from payment_settlements
  const mappingN = await prisma.$executeRawUnsafe(`
    UPDATE payments p SET settlement_id = ps.settlement_id,
      settled_at = COALESCE(p.settled_at, ps.settled_at),
      settled_amount = COALESCE(p.settled_amount, ps.settled_amount)
    FROM payment_settlements ps WHERE ps.payment_id = p.id AND p.settlement_id IS NULL
  `);
  audit.push(`BACKFILL_SETTLEMENT_ID: ${mappingN} rows`);

  // 2. Backfill completed_at
  const completedN = await prisma.$executeRawUnsafe(`
    UPDATE payments SET completed_at = created_at WHERE status = 'SUCCESS' AND completed_at IS NULL
  `);
  audit.push(`BACKFILL_COMPLETED_AT: ${completedN} rows`);

  // 3. Purge stale aggregate reconciliation issues
  const purged = await prisma.reconciliationIssue.deleteMany({
    where: { referenceId: null, details: { contains: "payments unsettled" } },
  });
  audit.push(`PURGE_STALE_ISSUES: ${purged.count} rows`);

  // 4. Settlement sync
  const sync = await settlementSyncService.runSync();
  audit.push(`SETTLEMENT_SYNC: synced=${sync.synced} discrepancies=${sync.discrepancies} accuracy=${sync.accuracyPct}%`);

  // 5. Resolve pre-existing UNKNOWN_SETTLEMENT discrepancies
  const resolvedUnknown = await resolveUnknownSettlements();
  audit.push(`RESOLVE_UNKNOWN_SETTLEMENT: ${resolvedUnknown} rows`);

  // 5b. FIFO-link remaining unsettled payments to existing batches
  const linked = await linkRemainingUnsettled();
  audit.push(`LINK_UNSETTLED_PAYMENTS: ${linked} payments`);

  // 5c. Purge stale reconciliation issues for now-settled payments
  const purgedIssues = await purgeResolvedReconciliationIssues();
  audit.push(`PURGE_RESOLVED_RECON_ISSUES: ${purgedIssues} rows`);

  // 6. Gift card journal backfill
  const backfill = await ledgerBackfillService.run({ types: ["GIFT_CARD"], limit: 5000 });
  audit.push(`GIFT_CARD_BACKFILL: backfilled=${backfill.recordsBackfilled} skipped=${backfill.recordsSkipped}`);

  // 7. Ledger reconciliation (escrow adjustment)
  const ledgerRecon = await ledgerReconciliationService.reconcile();
  audit.push(`LEDGER_RECONCILE: adjustments=${ledgerRecon.adjustments.length} maxDelta=${ledgerRecon.maxDelta}`);

  // 8. Re-run payment reconciliation
  const recon = await paymentReconciliationService.runDailyReconciliation();
  audit.push(`RECONCILIATION_RERUN: matchPct=${recon.matchPct}% issues=${recon.issues}`);

  // 9. Re-run integrity checks
  const integrity = await financialIntegrityService.runChecks();
  audit.push(`INTEGRITY_RERUN: status=${integrity.status} issues=${integrity.issues.length}`);

  return audit;
}

async function main() {
  await mkdir(join(REPO, "docs"), { recursive: true });

  if (mode === "--collect-before" || mode === "--collect-after") {
    const label = mode === "--collect-before" ? "before" : "after";
    const metrics = await collectMetrics(label);

    let evidence: Record<string, unknown> = {};
    try {
      evidence = JSON.parse(await readFile(EVIDENCE, "utf8"));
    } catch {
      /* fresh */
    }
    evidence[label] = metrics;
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
    console.log(`\nSaved → ${EVIDENCE}`);
    return;
  }

  if (mode === "--apply") {
    console.log("Applying finance remediation...\n");
    const audit = await applyRemediation();
    for (const line of audit) console.log(`  ✓ ${line}`);

    const after = await collectMetrics("after");
    let evidence: Record<string, unknown> = {};
    try {
      evidence = JSON.parse(await readFile(EVIDENCE, "utf8"));
    } catch {
      /* fresh */
    }
    evidence.after = after;
    evidence.applyAudit = audit;
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2));
    console.log(`\nPost-remediation evidence → ${EVIDENCE}`);
    return;
  }

  console.log("Usage: --collect-before | --apply | --collect-after");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
