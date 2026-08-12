/**
 * Run ledger backfill + liability reconciliation (fixes WALLET_LIABILITY_MISMATCH).
 * Usage: bun --env-file=.env run scripts/reconcile-ledger.ts
 */
import "../src/load-env";
import { ledgerReconciliationService } from "../src/services/ledger-reconciliation.service";
import { financialIntegrityService } from "../src/services/financial-integrity.service";

async function main() {
  const before = await ledgerReconciliationService.buildReport();
  console.log("[reconcile] before:", JSON.stringify(before, null, 2));

  const result = await ledgerReconciliationService.reconcile({ backfillLimit: 5000, postAdjustments: true });
  console.log("[reconcile] adjustments:", JSON.stringify(result.adjustments, null, 2));
  console.log("[reconcile] maxDelta:", result.maxDelta);

  const integrity = await financialIntegrityService.validate();
  const walletIssue = integrity.issues.find((i) => i.category === "WALLET_LIABILITY_MISMATCH");
  console.log(
    JSON.stringify(
      {
        score: integrity.score,
        status: integrity.status,
        walletLiabilityMismatch: walletIssue ?? null,
        issueCount: integrity.issues.length,
      },
      null,
      2,
    ),
  );

  if (walletIssue) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
