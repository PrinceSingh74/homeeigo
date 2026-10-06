/**
 * Split (wallet + gateway) refunds and crash-safe gateway refunds — runs against the ISOLATED homigo_test DB.
 *   NODE_ENV=test bun test D:/homigo/apps/backend/src/__tests__/split-refund.integration.test.ts
 *
 * Every booking is paid through the REAL checkouts (initiateSplit + verifySplit, or payment
 * createOrder + verify) on the offline dev gateway that NODE_ENV=test selects. Nothing is inserted
 * into `payments` by hand.
 *
 * D1: a split refund is two legs, proportional to the original tender, exact in paise.
 * D2: a refund lost to a crash — before it started, or during the gateway call — is recovered once.
 */
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { razorpayService } from "../services/razorpay.service";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { paymentService } from "../services/payment.service";
import { bookingService } from "../services/booking.service";
import { allocateSplitRefund, bookingRefundService } from "../services/booking-refund.service";
import { refundOrchestratorService } from "../services/refund-orchestrator.service";
import { financialIntegrityService } from "../services/financial-integrity.service";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const RUN = `spr-${Date.now().toString(36)}`;
let seq = 0;

async function customer(walletFunding: number) {
  seq++;
  const u = await prisma.user.create({
    data: { email: `${RUN}-${seq}@test.test`, phoneNumber: `+9178${Math.floor(1e6 + Math.random() * 8e6)}`, firstName: "Spr", lastName: `T${seq}`, password: "x".repeat(20), role: "CUSTOMER", walletBalance: 0 },
  });
  if (walletFunding > 0) {
    const t = await walletService.addMoney(u.id, walletFunding);
    if ("error" in t) throw new Error(t.error);
    await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_${RUN}_${seq}_t`, razorpaySignature: "sig" });
  }
  const s = await prisma.service.create({ data: { ...LIVE_FIXTURE_SERVICE, name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60 } });
  const a = await prisma.address.create({ data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 } });
  const b = await prisma.booking.create({
    data: { bookingNumber: `SPR-${RUN}-${seq}`, userId: u.id, serviceId: s.id, addressId: a.id, status: "PENDING", scheduledDate: new Date(Date.now() + 72 * 3_600_000), baseAmount: 1000, finalAmount: 1000, totalAmount: 1000, paymentStatus: "PENDING" },
  });
  return { userId: u.id, bookingId: b.id };
}
async function splitPaid(walletShare = 400) {
  const c = await customer(walletShare);
  const init = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, walletShare);
  if (!("mode" in init) || init.mode !== "split") throw new Error(JSON.stringify(init));
  const pid = `pay_${RUN}_${seq}`;
  const v = await walletCheckoutService.verifySplit(c.userId, { razorpayOrderId: init.razorpayOrderId, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, pid) });
  if (!("ok" in v)) throw new Error(JSON.stringify(v));
  return c;
}
async function gatewayPaid() {
  const c = await customer(0);
  const order = (await paymentService.createOrder(c.userId, c.bookingId)) as { razorpayOrderId?: string };
  const pid = `pay_${RUN}_${seq}`;
  await paymentService.verify(c.userId, { razorpayOrderId: order.razorpayOrderId!, razorpayPaymentId: pid, razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId!, pid) });
  return c;
}
async function legs(bookingId: string, userId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
  const gatewayDone = await prisma.refundRequest.findMany({ where: { paymentId: payment.id, status: "COMPLETED" } });
  const walletRefunds = await prisma.walletTransaction.findMany({ where: { referenceId: bookingId, userId, type: "REFUND", status: "COMPLETED" } });
  return {
    gatewayPaise: gatewayDone.reduce((s, r) => s + Math.round(r.amount * 100), 0),
    gatewayRequests: gatewayDone.length,
    walletPaise: walletRefunds.reduce((s, t) => s + Number(t.amountPaise), 0),
    walletCredits: walletRefunds.length,
    payment,
  };
}
async function settle(bookingId: string) {
  for (let i = 0; i < 60; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
/** The state a crash between the committed cancellation and its detached refund leaves behind. */
async function cancelWithoutRefund(userId: string, bookingId: string) {
  const spy = spyOn(bookingRefundService, "processCancellationRefund").mockImplementation(() => new Promise(() => {}));
  try {
    await bookingService.cancel({ userId }, bookingId, "crash before refund");
  } finally {
    spy.mockRestore();
  }
}

afterAll(async () => {
  // Ledger rows are history and stay.
});

describe("allocateSplitRefund", () => {
  const o = { gatewayPaise: 60_000n, walletPaise: 40_000n };
  test("proportional to the original tender and exact", () => {
    expect(allocateSplitRefund(50_000n, o, o)).toEqual({ gatewayPaise: 30_000n, walletPaise: 20_000n });
    expect(allocateSplitRefund(100_000n, o, o)).toEqual({ gatewayPaise: 60_000n, walletPaise: 40_000n });
  });
  test("floors the gateway leg; the wallet takes the rounding residual; the sum is exact", () => {
    const r = allocateSplitRefund(10_001n, { gatewayPaise: 66_666n, walletPaise: 33_333n }, { gatewayPaise: 66_666n, walletPaise: 33_333n });
    expect(r).toEqual({ gatewayPaise: 6_667n, walletPaise: 3_334n });
  });
  test("clamps a leg to what it can still refund without changing the sum", () => {
    expect(allocateSplitRefund(60_000n, o, { gatewayPaise: 20_000n, walletPaise: 40_000n })).toEqual({ gatewayPaise: 20_000n, walletPaise: 40_000n });
  });
  test("refuses more than both legs together, and nonsense input", () => {
    expect(allocateSplitRefund(60_001n, o, { gatewayPaise: 20_000n, walletPaise: 40_000n })).toEqual({ error: "AMOUNT_EXCEEDS_REFUNDABLE" });
    expect(allocateSplitRefund(0n, o, o)).toEqual({ error: "INVALID_AMOUNT" });
    expect(allocateSplitRefund(1n, { gatewayPaise: 0n, walletPaise: 0n }, o)).toEqual({ error: "NOTHING_PAID" });
  });
});

describe("D1 — split wallet + gateway refund", () => {
  test("cancellation quotes and refunds the full ₹1000 as ₹600 gateway + ₹400 wallet", async () => {
    const c = await splitPaid();
    expect((await bookingRefundService.quoteForBooking(c.bookingId, "user"))?.refundAmount).toBe(1000);
    const res = await bookingService.cancel({ userId: c.userId }, c.bookingId, "split test");
    expect("refundAmount" in res && res.refundAmount).toBe(1000);
    await settle(c.bookingId);
    const l = await legs(c.bookingId, c.userId);
    expect(l.gatewayPaise).toBe(60_000);
    expect(l.walletPaise).toBe(40_000);
    expect(l.payment.status).toBe("REFUNDED");
    const escrowRelease = await prisma.journalEntry.findUnique({ where: { idempotencyKey: `wallet_booking_refund:${c.bookingId}` }, include: { lines: { include: { account: true } } } });
    expect(escrowRelease?.lines.find((x) => x.account.code === "PLATFORM_ESCROW")?.debit).toBe(400);
    expect(escrowRelease?.lines.find((x) => x.account.code === "CUSTOMER_WALLET")?.credit).toBe(400);
  });

  test("a ₹500 admin refund splits ₹300 + ₹200 and leaves ₹500 quoted", async () => {
    const c = await splitPaid();
    const r = await bookingRefundService.processAdminRefund({ bookingId: c.bookingId, userId: c.userId, adminId: c.userId, amount: 500, reason: "partial" });
    expect("error" in r).toBe(false);
    const l = await legs(c.bookingId, c.userId);
    expect(l.gatewayPaise).toBe(30_000);
    expect(l.walletPaise).toBe(20_000);
    expect((await bookingRefundService.quoteForBooking(c.bookingId, "user"))?.refundAmount).toBe(500);
  });

  test("eight concurrent refunds make one of each leg and nobody reports a fabricated pending", async () => {
    const c = await splitPaid();
    await cancelWithoutRefund(c.userId, c.bookingId);
    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        bookingRefundService.processCancellationRefund({ bookingId: c.bookingId, userId: c.userId, actorUserId: c.userId, reason: "x8", cancelledBy: "user", refundAmount: 1000 }),
      ),
    );
    expect(rs.every((r) => r.status === "processed" || r.status === "processing")).toBe(true);
    const l = await legs(c.bookingId, c.userId);
    expect([l.gatewayRequests, l.walletCredits]).toEqual([1, 1]);
    expect(l.gatewayPaise + l.walletPaise).toBe(100_000);
  });
});

describe("D2 — crash-safe gateway refund", () => {
  test("a cancellation whose refund never started is finished by the sweep (gateway-only)", async () => {
    const c = await gatewayPaid();
    await cancelWithoutRefund(c.userId, c.bookingId);
    expect(await prisma.refundRequest.count({ where: { idempotencyKey: `cancel-refund:${c.bookingId}` } })).toBe(0);
    const sweep = await bookingRefundService.recoverStrandedCancellationRefunds(100, new Date(), 0);
    expect(sweep.recovered).toBeGreaterThanOrEqual(1);
    expect((await legs(c.bookingId, c.userId)).gatewayPaise).toBe(100_000);
    const again = await bookingRefundService.recoverStrandedCancellationRefunds(100, new Date(), 0);
    expect((await legs(c.bookingId, c.userId)).gatewayRequests).toBe(1);
    expect(again.scanned).toBe(0);
  });

  test("a refund left REFUNDING by a crash, absent at the gateway, is failed and retried once", async () => {
    const c = await gatewayPaid();
    await cancelWithoutRefund(c.userId, c.bookingId);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    // The reservation commits, then the process dies before the gateway answers.
    const reserved = await prisma.$transaction((tx) =>
      refundOrchestratorService.reserveInTx(tx, { paymentId: payment.id, amount: 1000, reason: "crash", actorUserId: c.userId, source: "cancellation", idempotencyKey: `cancel-refund:${c.bookingId}` }),
    );
    expect(reserved.proceed).toBe(true);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REFUNDING");

    const stale = await bookingRefundService.recoverStaleGatewayRefunds(100, new Date(), 0);
    expect(stale.notAtGateway).toBeGreaterThanOrEqual(1);
    await bookingRefundService.retryFailedRefunds(100);
    const l = await legs(c.bookingId, c.userId);
    expect(l.gatewayRequests).toBe(1);
    expect(l.gatewayPaise).toBe(100_000);
    expect(l.payment.status).toBe("REFUNDED");
  });

  test("a refund the gateway DID make before the crash is confirmed, never issued twice", async () => {
    const c = await gatewayPaid();
    await cancelWithoutRefund(c.userId, c.bookingId);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    const key = `cancel-refund:${c.bookingId}`;
    await prisma.$transaction((tx) =>
      refundOrchestratorService.reserveInTx(tx, { paymentId: payment.id, amount: 1000, reason: "crash", actorUserId: c.userId, source: "cancellation", idempotencyKey: key }),
    );
    // Provider state: the gateway holds a refund for exactly this operation.
    const fetchSpy = spyOn(razorpayService, "fetchRefundsForPayment").mockResolvedValue([
      { id: `rfnd_${RUN}_held`, payment_id: payment.razorpayPaymentId!, amount: 100_000, status: "processed", notes: { homigo_operation: key } },
    ]);
    const execSpy = spyOn(razorpayService, "executeGatewayRefund");
    try {
      const stale = await bookingRefundService.recoverStaleGatewayRefunds(100, new Date(), 0);
      await bookingRefundService.retryFailedRefunds(100);
      expect(stale.confirmed).toBeGreaterThanOrEqual(1);
      expect(execSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      execSpy.mockRestore();
    }
    const l = await legs(c.bookingId, c.userId);
    expect(l.gatewayRequests).toBe(1);
    expect(l.gatewayPaise).toBe(100_000);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `refund:rfnd_${RUN}_held` } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } })).refundStatus).toBe("processed");
  });
});

describe("booking-level refund integrity", () => {
  test("detects a booking refunded beyond what was paid across both tenders", async () => {
    const c = await splitPaid();
    await bookingService.cancel({ userId: c.userId }, c.bookingId, "full");
    await settle(c.bookingId);
    // A corruption the refund paths cannot produce: an extra wallet refund with no ceiling check.
    const bogus = await prisma.walletTransaction.create({
      data: { transactionNumber: `BOGUS-${RUN}`, userId: c.userId, amount: 1, walletBalanceBefore: 0, walletBalanceAfter: 1, type: "REFUND", status: "COMPLETED", referenceId: c.bookingId, referenceType: "booking_admin_refund", description: "integrity positive control" },
    });
    try {
      const report = await financialIntegrityService.validate();
      expect(report.issues.some((i) => i.category === "REFUND_MISMATCH" && "referenceId" in i && i.referenceId === c.bookingId)).toBe(true);
    } finally {
      await prisma.walletTransaction.delete({ where: { id: bogus.id } });
    }
    const clean = await financialIntegrityService.validate();
    expect(clean.issues.some((i) => "referenceId" in i && i.referenceId === c.bookingId)).toBe(false);
  }, 30_000); // two full integrity runs; must not depend on the runner's default timeout
});
