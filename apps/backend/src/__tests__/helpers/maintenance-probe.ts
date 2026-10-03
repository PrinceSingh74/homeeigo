/**
 * Child-process probe for maintenance-target-guard.test.ts. NOT a test file.
 *
 * Starts the real scheduler in a process of its own, so nothing it starts (workflow bootstrap, outbox
 * processor, boot-health marks) can leak into the parent test runner. Prisma is imported — and so bound
 * to homigo_test — BEFORE DATABASE_URL is changed; only the guard reads the changed variable. Prints the
 * call counts of every autonomous job it watched, then exits.
 *
 *   NODE_ENV=test bun src/__tests__/helpers/maintenance-probe.ts <database-url-the-guard-should-see>
 */
import "../../load-env";

const prisma = (await import("../../lib/prisma")).default;
const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]!.d;
/**
 * The configured test database, whatever it is called (homigo_test, a CI-generated name, a
 * migrations-only clone). The name is never hard-coded here — it must only satisfy the platform's
 * isolation convention, which the guard itself enforces: an isolated database ends in `_test`.
 */
if (!/_test$/.test(db)) {
  console.log(JSON.stringify({ refused: `bound to ${db}, which is not an isolated *_test database` }));
  process.exit(2);
}
const { paymentReconciliationService } = await import("../../services/payment-reconciliation.service");
const { financialIntegrityService } = await import("../../services/financial-integrity.service");
const { bookingRefundService } = await import("../../services/booking-refund.service");
const { partnerIncentivePayoutService } = await import("../../services/partner-incentive-payout.service");
const { startMaintenance, stopMaintenance } = await import("../../lib/maintenance");

const calls: Record<string, number> = {};
function watch(obj: Record<string, unknown>, method: string, label: string) {
  calls[label] = 0;
  const orig = (obj[method] as (...a: unknown[]) => unknown).bind(obj);
  obj[method] = (...a: unknown[]) => {
    calls[label]++;
    return orig(...a);
  };
}
watch(paymentReconciliationService as unknown as Record<string, unknown>, "runDailyReconciliation", "payment_reconciliation");
watch(financialIntegrityService as unknown as Record<string, unknown>, "runChecks", "financial_integrity");
watch(bookingRefundService as unknown as Record<string, unknown>, "retryFailedRefunds", "refund_retry");
watch(bookingRefundService as unknown as Record<string, unknown>, "recoverStaleGatewayRefunds", "refund_stale_recovery");
watch(bookingRefundService as unknown as Record<string, unknown>, "recoverStrandedCancellationRefunds", "refund_stranded_recovery");
watch(partnerIncentivePayoutService as unknown as Record<string, unknown>, "evaluateRecentActiveProviders", "incentive_eval");

process.env.DATABASE_URL = process.argv[2] ?? "";
startMaintenance();
await new Promise((r) => setTimeout(r, 2500));
stopMaintenance();
console.log(`PROBE ${JSON.stringify({ guardSaw: process.env.DATABASE_URL.replace(/\/\/[^@]*@/, "//***@"), boundTo: db, calls })}`);
process.exit(0);
