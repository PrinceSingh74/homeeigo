import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { financialIntegrityService } from "../services/financial-integrity.service";

/**
 * 6E — the finance health signal has to be capable of being green.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * The refund integrity rule accepted exactly REFUNDED and SUCCESS beside a refund, so every
 * PARTIALLY_REFUNDED payment was reported as an integrity issue. `booking-refund.service` sets that
 * status DELIBERATELY while a refund is still short of the full amount, and `admin.service` and
 * `invoice-report.service` already treat it as a normal refunded state — the rule simply predates
 * partial refunds.
 *
 * The consequence was not a wrong number on a page. Nine partially-refunded payments kept every
 * integrity run at FAIL, which pinned `serviceHealth.finance` to "degraded" permanently. A health
 * signal that is always red carries no information: a genuine refund mismatch would have arrived as
 * the tenth line of a list operators had already learned to scroll past. Measured across the
 * database at the time: 9 PARTIALLY_REFUNDED, 14 REFUNDED, zero refunds against a payment that never
 * succeeded — every issue the rule raised was false.
 *
 * These cases pin both halves: the legitimate states no longer fire, and the states that genuinely
 * cannot be true still do.
 */
const RUN = `refund-integrity-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

/** A payment needs a booking, an idempotency key and a gateway order id — all NOT NULL. */
async function seedPayment(index: number, status: PaymentStatus, amount: number, refunded: number) {
  const bookingId = `${RUN}-b-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO bookings (id, booking_number, user_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval, $7, $7, $7, NOW(), NOW())`,
    bookingId,
    `${bookingId}-BN`,
    ctx.customerA.id,
    ctx.serviceId,
    ctx.addressAId,
    String(index + 1),
    amount,
  );

  const id = `${RUN}-p-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO payments (id, booking_id, idempotency_key, razorpay_order_id, user_id, amount,
                           refunded_amount, status, payment_method, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"PaymentStatus", 'wallet', NOW(), NOW())`,
    id,
    bookingId,
    `${id}-idem`,
    `order_${id}`,
    ctx.customerA.id,
    amount,
    refunded,
    status,
  );
  return id;
}

async function clearPayments() {
  await prisma.$executeRawUnsafe(`DELETE FROM payments WHERE id LIKE $1`, `${RUN}-p-%`);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id LIKE $1`, `${RUN}-b-%`);
}

/** Issues this rule raised for the payments this file seeded. */
async function refundIssuesForSeeded(): Promise<Array<{ referenceId: string; details: string }>> {
  const result = await financialIntegrityService.validate();
  return result.issues
    .filter((i) => i.category === "REFUND_MISMATCH" && String(i.referenceId ?? "").startsWith(`${RUN}-p-`))
    .map((i) => ({ referenceId: String(i.referenceId), details: String(i.details) }));
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearPayments();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearPayments();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("a refund against a legitimate payment state is not an integrity issue", () => {
  test("PARTIALLY_REFUNDED is a normal state, not a mismatch", async () => {
    if (!dbOk) return;
    await clearPayments();
    // Exactly what the refund service writes while a refund is short of the full amount.
    const id = await seedPayment(0, PaymentStatus.PARTIALLY_REFUNDED, 500, 100);

    const issues = await refundIssuesForSeeded();
    expect(issues.map((i) => i.referenceId)).not.toContain(id);
  });

  test("REFUNDED, SUCCESS and REFUNDING are all accepted beside a refund", async () => {
    if (!dbOk) return;
    await clearPayments();
    const ids = [
      await seedPayment(1, PaymentStatus.REFUNDED, 500, 500),
      await seedPayment(2, PaymentStatus.SUCCESS, 500, 100),
      await seedPayment(3, PaymentStatus.REFUNDING, 500, 250),
    ];

    const flagged = (await refundIssuesForSeeded()).map((i) => i.referenceId);
    for (const id of ids) expect(flagged).not.toContain(id);
  });
});

describe("a refund that cannot be true is still an integrity issue", () => {
  test("money refunded against a payment that never succeeded is flagged", async () => {
    if (!dbOk) return;
    await clearPayments();
    /**
     * The check that actually matters. A payment sitting in PENDING or FAILED took no money, so a
     * refund recorded against it is either a bookkeeping error or money leaving the platform for
     * nothing.
     */
    const pending = await seedPayment(4, PaymentStatus.PENDING, 500, 100);
    const failed = await seedPayment(5, PaymentStatus.FAILED, 500, 100);

    const flagged = (await refundIssuesForSeeded()).map((i) => i.referenceId);
    expect(flagged).toContain(pending);
    expect(flagged).toContain(failed);
  });

  test("refunding more than was ever paid is flagged HIGH", async () => {
    if (!dbOk) return;
    await clearPayments();
    // The rule inspected STATUS and never compared AMOUNTS, so a payment refunded twice over passed
    // as long as its status read REFUNDED.
    const id = await seedPayment(6, PaymentStatus.REFUNDED, 100, 250);

    const result = await financialIntegrityService.validate();
    const issue = result.issues.find(
      (i) => i.category === "REFUND_MISMATCH" && String(i.referenceId) === id,
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("HIGH");
    expect(String(issue!.details)).toContain("more money returned than was taken");
  });

  test("a refund equal to the amount paid is not an over-refund", async () => {
    if (!dbOk) return;
    await clearPayments();
    // A full refund is the ordinary case and must not trip the amount comparison.
    const id = await seedPayment(7, PaymentStatus.REFUNDED, 500, 500);

    const flagged = (await refundIssuesForSeeded()).map((i) => i.referenceId);
    expect(flagged).not.toContain(id);
  });
});

describe("the finance health signal can reach green", () => {
  test("no refund mismatch survives, and the dashboard tracks the run it reports", async () => {
    if (!dbOk) return;
    await clearPayments();

    const result = await financialIntegrityService.validate();
    const { observabilityService } = await import("../services/observability.service");
    const dash = await observabilityService.getHealthDashboard();

    /**
     * Scoped to the category this decision governs.
     *
     * An earlier version asserted the WHOLE run was PASS, which is a platform-wide property any
     * money-moving suite sharing the database can break — and did, through unreconciled ledger
     * backfill that had nothing to do with refunds. A test that fails because of someone else's rows
     * reports noise, not a defect.
     *
     * What this file owns is that a partially-refunded payment is not an integrity issue, and that
     * the dashboard reports the run it actually read rather than a hardcoded state.
     */
    expect(result.issues.filter((i) => i.category === "REFUND_MISMATCH")).toEqual([]);

    // The linkage: finance is degraded exactly when the latest run failed, and healthy otherwise.
    expect(dash.serviceHealth.finance.status).toBe(
      dash.serviceHealth.finance.lastIntegrityStatus === "FAIL" ? "degraded" : "healthy",
    );
  });

  test("green is reachable — a clean refund picture produces no refund issues at all", async () => {
    if (!dbOk) return;
    await clearPayments();
    // The property that was lost while the rule flagged every partial refund: with correct data,
    // the refund category contributes nothing to the run.
    await seedPayment(80, PaymentStatus.PARTIALLY_REFUNDED, 500, 100);
    await seedPayment(81, PaymentStatus.REFUNDED, 500, 500);

    const result = await financialIntegrityService.validate();
    expect(result.issues.filter((i) => i.category === "REFUND_MISMATCH")).toEqual([]);
  });
});
