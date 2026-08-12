/**
 * Repair settlement mismatches — dry-run | apply | rollback
 *
 * Run:
 *   bun --env-file=.env run scripts/recovery/repair-settlement-mismatch.ts --dry-run
 *   bun --env-file=.env run scripts/recovery/repair-settlement-mismatch.ts --apply
 */
import prisma from "../../src/lib/prisma";
import { settlementSyncService } from "../../src/services/settlement-sync.service";
import { paymentReconciliationService } from "../../src/services/payment-reconciliation.service";

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rollback") ? "rollback" : "dry-run";
const r2 = (n: number) => Math.round(n * 100) / 100;

type Action = { kind: string; detail: string; sql?: string };

async function plan(): Promise<Action[]> {
  const actions: Action[] = [];

  const backfillMapping = await prisma.$queryRawUnsafe<
    Array<{ payment_id: string; settlement_id: string }>
  >(`
    SELECT p.id AS payment_id, ps.settlement_id
    FROM payments p
    JOIN payment_settlements ps ON ps.payment_id = p.id
    WHERE p.settlement_id IS NULL
  `);
  if (backfillMapping.length > 0) {
    actions.push({
      kind: "BACKFILL_SETTLEMENT_ID",
      detail: `${backfillMapping.length} payments have PaymentSettlement but NULL settlement_id`,
      sql: "UPDATE payments SET settlement_id = ps.settlement_id FROM payment_settlements ps WHERE ps.payment_id = payments.id AND payments.settlement_id IS NULL",
    });
  }

  const nullCompleted = await prisma.payment.count({
    where: { status: "SUCCESS", completedAt: null },
  });
  if (nullCompleted > 0) {
    actions.push({
      kind: "BACKFILL_COMPLETED_AT",
      detail: `${nullCompleted} SUCCESS payments missing completed_at`,
      sql: "UPDATE payments SET completed_at = created_at WHERE status = 'SUCCESS' AND completed_at IS NULL",
    });
  }

  const staleAggregate = await prisma.reconciliationIssue.count({
    where: { referenceId: null, details: { contains: "payments unsettled" } },
  });
  if (staleAggregate > 0) {
    actions.push({
      kind: "PURGE_STALE_AGGREGATE_ISSUES",
      detail: `${staleAggregate} inflated aggregate SETTLEMENT_MISMATCH rows (no reference_id)`,
    });
  }

  const unsettled = await prisma.payment.count({ where: { status: "SUCCESS", settlementId: null } });
  actions.push({
    kind: "SETTLEMENT_SYNC",
    detail: `${unsettled} SUCCESS payments still unsettled — will run Razorpay settlement sync`,
  });

  actions.push({ kind: "RECONCILIATION_RERUN", detail: "Recompute match rate with rebuilt engine" });

  return actions;
}

async function apply(actions: Action[]) {
  const audit: string[] = [];

  if (actions.some((a) => a.kind === "BACKFILL_SETTLEMENT_ID")) {
    const n = await prisma.$executeRawUnsafe(`
      UPDATE payments p SET settlement_id = ps.settlement_id, settled_at = COALESCE(p.settled_at, ps.settled_at), settled_amount = COALESCE(p.settled_amount, ps.settled_amount)
      FROM payment_settlements ps WHERE ps.payment_id = p.id AND p.settlement_id IS NULL
    `);
    audit.push(`BACKFILL_SETTLEMENT_ID: ${n} rows`);
  }

  if (actions.some((a) => a.kind === "BACKFILL_COMPLETED_AT")) {
    const n = await prisma.$executeRawUnsafe(`
      UPDATE payments SET completed_at = created_at WHERE status = 'SUCCESS' AND completed_at IS NULL
    `);
    audit.push(`BACKFILL_COMPLETED_AT: ${n} rows`);
  }

  if (actions.some((a) => a.kind === "PURGE_STALE_AGGREGATE_ISSUES")) {
    const n = await prisma.reconciliationIssue.deleteMany({
      where: { referenceId: null, details: { contains: "payments unsettled" } },
    });
    audit.push(`PURGE_STALE_AGGREGATE_ISSUES: ${n.count} rows`);
  }

  if (actions.some((a) => a.kind === "SETTLEMENT_SYNC")) {
    const sync = await settlementSyncService.runSync();
    audit.push(`SETTLEMENT_SYNC: synced=${sync.synced} discrepancies=${sync.discrepancies} accuracy=${sync.accuracyPct}%`);
  }

  if (actions.some((a) => a.kind === "RECONCILIATION_RERUN")) {
    const recon = await paymentReconciliationService.runDailyReconciliation();
    audit.push(`RECONCILIATION_RERUN: matchPct=${recon.matchPct}% issues=${recon.issues}`);
  }

  return audit;
}

async function main() {
  console.log(`\n=== repair-settlement-mismatch · mode=${mode} · ${new Date().toISOString()} ===\n`);
  const actions = await plan();
  for (const a of actions) console.log(`  • [${a.kind}] ${a.detail}`);

  if (mode === "dry-run") {
    console.log("\nDry run complete. Pass --apply to execute.");
    process.exit(0);
  }

  if (mode === "rollback") {
    console.log("\nRollback not automated — restore from DB backup if needed.");
    process.exit(1);
  }

  const audit = await apply(actions);
  console.log("\nApplied:");
  for (const line of audit) console.log(`  ✓ ${line}`);

  const unsettled = await prisma.payment.count({ where: { status: "SUCCESS", settlementId: null } });
  const settled = await prisma.payment.count({ where: { status: "SUCCESS", settlementId: { not: null } } });
  const issues = await prisma.reconciliationIssue.count();
  console.log(`\nPost-repair: settled=${settled} unsettled=${unsettled} open_issues=${issues}`);
  process.exit(unsettled === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
