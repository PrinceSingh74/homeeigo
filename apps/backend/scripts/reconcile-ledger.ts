/**
 * Ledger backfill + liability reconciliation.
 *
 *   bun --env-file=.env run scripts/reconcile-ledger.ts
 *       DRY RUN (default). Backfills missing journals, then reports each liability delta. Posts no
 *       correcting adjustment.
 *
 *   bun --env-file=.env run scripts/reconcile-ledger.ts --post --reason "<why this is a correction>"
 *       Also posts ADJUSTMENT entries for invariant-backed accounts, with the reason written into
 *       every journal description.
 *
 * This used to post adjustments unconditionally and with no reason. "Detect a mismatch" and
 * "silence it" were one command, and the ₹32 wallet drift that `diagnose-wallet-liability.ts`
 * attributes to two specific historical errors could be erased — along with the evidence of what
 * caused it — by anyone who ran the obvious-looking script. Run the diagnosis first; a correcting
 * entry is an accounting decision, not a clean-up step.
 *
 * The service enforces the reason too (`ADJUSTMENT_REASON_REQUIRED`), so no other caller can post a
 * silent plug either.
 */
import "../src/load-env";
import {
  ledgerReconciliationService,
  MIN_ADJUSTMENT_REASON_LENGTH,
} from "../src/services/ledger-reconciliation.service";
import { financialIntegrityService } from "../src/services/financial-integrity.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const post = process.argv.includes("--post");
  const reason = arg("reason")?.trim() ?? "";

  // Refused here as well as in the service, so the operator gets a usable message before the
  // backfill has run rather than a stack trace after it.
  if (post && reason.length < MIN_ADJUSTMENT_REASON_LENGTH) {
    console.error(
      `REFUSING: --post requires --reason "<at least ${MIN_ADJUSTMENT_REASON_LENGTH} characters>" explaining why ` +
        `the delta is being corrected rather than attributed. Run scripts/diagnose-wallet-liability.ts first.`,
    );
    process.exit(2);
  }

  console.log(`[reconcile] mode: ${post ? "POST ADJUSTMENTS" : "DRY RUN — no adjustment will be posted"}`);
  const result = await ledgerReconciliationService.reconcile({
    backfillLimit: 5000,
    postAdjustments: post,
    adjustmentReason: post ? reason : undefined,
  });

  console.log("[reconcile] before:", JSON.stringify(result.before, null, 2));
  console.log("[reconcile] after backfill:", JSON.stringify(result.afterBackfill, null, 2));
  console.log("[reconcile] adjustments posted:", JSON.stringify(result.adjustments, null, 2));
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
