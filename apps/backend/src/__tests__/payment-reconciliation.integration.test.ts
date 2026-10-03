/**
 * Payment reconciliation — both jobs, against the ISOLATED homigo_test DB, no gateway.
 *   NODE_ENV=test bun test D:/homigo/apps/backend/src/__tests__/payment-reconciliation.integration.test.ts
 *
 * `runDailyReconciliation` reads only local tables (payments, settlements, refunds) — no provider.
 * `runGatewayReconciliation` compares local rows with the provider's payment / refund / settlement
 * lists; here the provider is a test fixture at exactly those three fetch methods, returning the lists
 * a real gateway would. Payments are created through the real checkout (createOrder + verify on the dev
 * gateway) and settled through the real settlement-webhook handler. Rows the product can never create
 * — an over-refund, amountPaid ≠ amount — are written directly as detector positive controls and say so.
 *
 * Assertions are scoped to this suite's own payments: the jobs scan the whole window, and other suites
 * share the database.
 */
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { razorpayService } from "../services/razorpay.service";
import { paymentService } from "../services/payment.service";
import { settlementService } from "../services/settlement.service";
import { paymentReconciliationService } from "../services/payment-reconciliation.service";
import { gatewayReconciliationService } from "../services/gateway-reconciliation.service";

const RUN = `prec-${Date.now().toString(36)}`;
let seq = 0;

async function gatewayPaid(amount = 700) {
  seq++;
  const u = await prisma.user.create({
    data: { email: `${RUN}-${seq}@test.test`, phoneNumber: `+9179${Math.floor(1e6 + Math.random() * 8e6)}`, firstName: "Prec", lastName: `T${seq}`, password: "x".repeat(20), role: "CUSTOMER", walletBalance: 0 },
  });
  const s = await prisma.service.create({ data: { name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: amount, estimatedDuration: 60 } });
  const a = await prisma.address.create({ data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 } });
  const b = await prisma.booking.create({
    data: { bookingNumber: `PREC-${RUN}-${seq}`, userId: u.id, serviceId: s.id, addressId: a.id, status: "PENDING", scheduledDate: new Date(Date.now() + 72 * 3_600_000), baseAmount: amount, finalAmount: amount, totalAmount: amount, paymentStatus: "PENDING" },
  });
  const order = (await paymentService.createOrder(u.id, b.id)) as { razorpayOrderId?: string };
  const pid = `pay_${RUN}_${seq}`;
  await paymentService.verify(u.id, { razorpayOrderId: order.razorpayOrderId!, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId!, pid) });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
  expect(payment.status).toBe("SUCCESS");
  return payment;
}
async function dailyIssuesFor(paymentId: string) {
  return prisma.reconciliationIssue.findMany({ where: { referenceId: paymentId }, select: { issueType: true, reconciliationId: true } });
}

afterAll(async () => {
  // Reconciliation runs and issues are history and stay.
});

describe("runDailyReconciliation (local only, no provider)", () => {
  test("a settled payment is matched and raises nothing", async () => {
    const p = await gatewayPaid();
    const settled = await settlementService.recordFromWebhook({
      settlementId: `setl_${RUN}_a`,
      amount: p.amountPaid,
      raw: { payments: [{ id: p.razorpayPaymentId, amount: Math.round(p.amountPaid * 100) }] },
    });
    expect(settled.linked).toBe(1);
    await paymentReconciliationService.runDailyReconciliation();
    expect(await dailyIssuesFor(p.id)).toEqual([]);
  });

  test("an unsettled payment inside the grace window is SETTLEMENT_PENDING", async () => {
    const p = await gatewayPaid();
    await paymentReconciliationService.runDailyReconciliation();
    expect((await dailyIssuesFor(p.id)).map((i) => i.issueType)).toEqual(["SETTLEMENT_PENDING"]);
  });

  test("an unsettled payment past the 3-day grace is SETTLEMENT_MISMATCH", async () => {
    const p = await gatewayPaid();
    // Time only: the payment completed four days ago (still inside the 7-day scan window).
    await prisma.payment.update({ where: { id: p.id }, data: { completedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await paymentReconciliationService.runDailyReconciliation();
    expect((await dailyIssuesFor(p.id)).map((i) => i.issueType)).toEqual(["SETTLEMENT_MISMATCH"]);
  });

  test("re-running is idempotent: an open issue is not raised a second time", async () => {
    const p = await gatewayPaid();
    const first = await paymentReconciliationService.runDailyReconciliation();
    const second = await paymentReconciliationService.runDailyReconciliation();
    const issues = await dailyIssuesFor(p.id);
    expect(issues.length).toBe(1);
    expect(issues[0]!.reconciliationId).toBe(first.reconciliationId);
    expect(second.reconciliationId).not.toBe(first.reconciliationId);
  });

  test("positive controls: amount mismatch and over-refund are detected (rows the product cannot produce)", async () => {
    const p = await gatewayPaid();
    const q = await gatewayPaid();
    try {
      await prisma.payment.update({ where: { id: p.id }, data: { amountPaid: p.amountPaid - 1 } });
      await prisma.payment.update({ where: { id: q.id }, data: { refundedAmount: q.amountPaid + 1, status: "REFUNDED" } });
      await paymentReconciliationService.runDailyReconciliation();
      expect((await dailyIssuesFor(p.id)).map((i) => i.issueType)).toContain("MISMATCH");
      expect((await dailyIssuesFor(q.id)).map((i) => i.issueType)).toContain("REFUND_MISMATCH");
    } finally {
      // The corruption is this test's own instrument. Left behind, it is a real over-refund that every
      // later database-wide integrity assertion in the run would (correctly) report.
      await prisma.payment.update({ where: { id: p.id }, data: { amountPaid: p.amountPaid } });
      await prisma.payment.update({ where: { id: q.id }, data: { refundedAmount: 0, status: "SUCCESS" } });
    }
  });
});

describe("runGatewayReconciliation (provider as a fixture at its fetch methods)", () => {
  function provider(payments: Array<{ id: string; amount: number; status: string }>, refunds: Array<{ id: string; payment_id: string; amount: number; status: string }> = []) {
    return [
      spyOn(razorpayService, "fetchPayments").mockResolvedValue(payments as never),
      spyOn(razorpayService, "fetchRefunds").mockResolvedValue(refunds),
      spyOn(razorpayService, "fetchSettlements").mockResolvedValue([] as never),
    ];
  }
  async function gatewayIssuesFor(runId: string, ref: string) {
    return prisma.gatewayReconciliationIssue.findMany({
      where: { runId, OR: [{ localReference: ref }, { gatewayReference: ref }] },
      select: { issueType: true },
    });
  }

  test("provider agrees → matched; provider lacks it → MISSING_GATEWAY; provider has an unknown one → MISSING_LOCAL", async () => {
    const agreed = await gatewayPaid(700);
    const absent = await gatewayPaid(800);
    const unknown = `pay_${RUN}_unknown`;
    const spies = provider([
      { id: agreed.razorpayPaymentId!, amount: 70_000, status: "captured" },
      { id: unknown, amount: 12_300, status: "captured" },
    ]);
    try {
      const run = await gatewayReconciliationService.runGatewayReconciliation();
      expect(await gatewayIssuesFor(run.runId, agreed.id)).toEqual([]);
      expect((await gatewayIssuesFor(run.runId, absent.id)).map((i) => i.issueType)).toEqual(["MISSING_GATEWAY"]);
      expect((await gatewayIssuesFor(run.runId, unknown)).map((i) => i.issueType)).toEqual(["MISSING_LOCAL"]);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test("provider amount differs → MISMATCH", async () => {
    const p = await gatewayPaid(700);
    const spies = provider([{ id: p.razorpayPaymentId!, amount: 69_900, status: "captured" }]);
    try {
      const run = await gatewayReconciliationService.runGatewayReconciliation();
      expect((await gatewayIssuesFor(run.runId, p.id)).map((i) => i.issueType)).toEqual(["MISMATCH"]);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test("refund confirmed locally → nothing; refund the provider holds but we never recorded → REFUND_MISMATCH", async () => {
    const recorded = await gatewayPaid(700);
    const refund = await paymentService.refund(recorded.id, 700, "full", { userId: recorded.userId, isAdmin: true });
    expect(refund && typeof refund === "object" && "error" in refund).toBe(false);
    const localRefundId = (await prisma.payment.findUniqueOrThrow({ where: { id: recorded.id } })).razorpayRefundId!;
    const unrecorded = await gatewayPaid(600);
    const spies = provider(
      [
        { id: recorded.razorpayPaymentId!, amount: 70_000, status: "refunded" },
        { id: unrecorded.razorpayPaymentId!, amount: 60_000, status: "captured" },
      ],
      [
        { id: localRefundId, payment_id: recorded.razorpayPaymentId!, amount: 70_000, status: "processed" },
        { id: `rfnd_${RUN}_ghost`, payment_id: unrecorded.razorpayPaymentId!, amount: 60_000, status: "processed" },
      ],
    );
    try {
      const run = await gatewayReconciliationService.runGatewayReconciliation();
      expect((await gatewayIssuesFor(run.runId, localRefundId)).map((i) => i.issueType)).toEqual([]);
      expect((await gatewayIssuesFor(run.runId, `rfnd_${RUN}_ghost`)).map((i) => i.issueType)).toEqual(["REFUND_MISMATCH"]);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test("provider unreachable → the run fails whole (no partial run is recorded), and a retry succeeds", async () => {
    const before = await prisma.gatewayReconciliationRun.count();
    const spies = [
      spyOn(razorpayService, "fetchPayments").mockRejectedValue(new Error("ETIMEDOUT")),
      spyOn(razorpayService, "fetchRefunds").mockResolvedValue([]),
      spyOn(razorpayService, "fetchSettlements").mockResolvedValue([] as never),
    ];
    try {
      await expect(gatewayReconciliationService.runGatewayReconciliation()).rejects.toThrow("ETIMEDOUT");
      expect(await prisma.gatewayReconciliationRun.count()).toBe(before);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const retrySpies = provider([]);
    try {
      const run = await gatewayReconciliationService.runGatewayReconciliation();
      expect(run.runId).toBeTruthy();
      expect(await prisma.gatewayReconciliationRun.count()).toBe(before + 1);
    } finally {
      retrySpies.forEach((s) => s.mockRestore());
    }
  });
});
