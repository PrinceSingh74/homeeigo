/**
 * Production blocker elimination — execution evidence.
 * Run: bun run scripts/production-blocker-elimination.ts
 */
import "../src/load-env";
import { ledgerReconciliationService } from "../src/services/ledger-reconciliation.service";
import { financialIntegrityService } from "../src/services/financial-integrity.service";
import { observabilityService } from "../src/services/observability.service";
import { prisma } from "../src/__tests__/helpers/adversarial-fixtures";

async function main() {
  console.log("=".repeat(80));
  console.log("PRODUCTION BLOCKER ELIMINATION");
  console.log(new Date().toISOString());
  console.log("=".repeat(80));

  const beforeIntegrity = await financialIntegrityService.validate();
  console.log("\n[BEFORE] Integrity:", {
    score: beforeIntegrity.score,
    status: beforeIntegrity.status,
    issues: beforeIntegrity.issues.length,
    top: beforeIntegrity.issues.slice(0, 3).map((i) => i.category),
  });

  const reportBefore = await ledgerReconciliationService.buildReport();
  console.log("\n[BEFORE] Reconciliation report:");
  for (const r of reportBefore) {
    console.log(`  ${r.source}: ops=${r.operationalBalance} ledger=${r.ledgerBalance} delta=${r.delta}`);
  }

  const reconciled = await ledgerReconciliationService.reconcile({ backfillLimit: 5000 });
  console.log("\n[RECONCILE] adjustments:", reconciled.adjustments);
  console.log("[RECONCILE] maxDelta:", reconciled.maxDelta);

  const afterIntegrity = await financialIntegrityService.validate();
  console.log("\n[AFTER] Integrity:", {
    score: afterIntegrity.score,
    status: afterIntegrity.status,
    issues: afterIntegrity.issues.length,
    liabilityIssues: afterIntegrity.issues
      .filter((i) => i.category.includes("MISMATCH") || i.category.includes("DRIFT"))
      .map((i) => `${i.category}: ${i.details}`),
  });

  const dash = await observabilityService.getHealthDashboard();
  console.log("\n[DASHBOARD] finance:", dash.serviceHealth.finance);
  console.log("[DASHBOARD] wallet:", dash.serviceHealth.wallet);

  const reportAfter = await ledgerReconciliationService.buildReport();
  console.log("\n[AFTER] Reconciliation report:");
  for (const r of reportAfter) {
    console.log(`  ${r.source}: ops=${r.operationalBalance} ledger=${r.ledgerBalance} delta=${r.delta}`);
  }

  const maxDelta = Math.max(...reportAfter.map((r) => Math.abs(r.delta)), 0);
  const pass =
    afterIntegrity.status === "PASS" &&
    maxDelta <= 0.01 &&
    dash.serviceHealth.finance.status !== "degraded";

  console.log("\n" + "=".repeat(80));
  console.log(pass ? "VERDICT: BLOCKERS ELIMINATED" : "VERDICT: BLOCKERS REMAIN");
  console.log({ maxDelta, integrityStatus: afterIntegrity.status, financeHealth: dash.serviceHealth.finance.status });
  console.log("=".repeat(80));

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
