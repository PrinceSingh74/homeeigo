/**
 * Refund tender follows how the money ARRIVED, and a cancellation never promises money that was
 * never paid — runs against the ISOLATED homigo_test DB.
 *
 *   cd apps/backend
 *   bun test "D:/homigo/apps/backend/src/__tests__/refund-tender-evidence.integration.test.ts" --timeout 120000
 *
 * Two defects found while tracing live-closure step B (2026-09-27):
 *
 *  1. `payments.payment_method` is a LABEL. Booking create accepts any string from the client,
 *     `createOrder` copies it onto the payments row, and the refund paths routed on it. A booking
 *     created with the label "wallet" and then paid through the gateway was refunded as in-app
 *     wallet credit: the customer's money never went back to its source, and the ledger moved
 *     PLATFORM_ESCROW for funds that had arrived as CUSTOMER_FUNDS.
 *
 *  2. `bookingService.cancel` wrote the QUOTE into `bookings.refund_amount`, the outbox event, the
 *     realtime frame and the customer notification even when nothing had been paid — so a customer
 *     who never paid was told "₹… refund is on the way".
 *
 * No `expect(promise).resolves` — see bun-expect-resolves-pending-hang.
 */
import { describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { bookingService } from "../services/booking.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";
import { arrivedThroughGateway, isWalletTender, refundTenderLabel } from "../lib/refund-tender";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const rnd = () => Math.random().toString(36).slice(2, 8);

async function user(tag: string, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  const email = `rte-${tag}-${Date.now()}-${rnd()}@test.test`;
  return prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9174${Math.floor(1e7 + Math.random() * 8e7)}`,
      firstName: "Rte",
      lastName: tag,
      password: "x".repeat(20),
      role,
      walletBalance: 0,
    } as never,
  });
}

async function booking(userId: string, data: Record<string, unknown>) {
  const s = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE, name: `rte-${rnd()}-${Date.now()}`, slug: `rte-${rnd()}-${Date.now()}`, description: "x", category: "cleaning", basePrice: 500, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  return prisma.booking.create({
    data: {
      bookingNumber: `RTE-${Date.now()}-${rnd()}`,
      userId, serviceId: s.id, addressId: a.id,
      scheduledDate: new Date(Date.now() + 72 * 3_600_000),
      baseAmount: 500, finalAmount: 500, totalAmount: 500,
      ...data,
    } as never,
  });
}

/**
 * A gateway payment on a booking the client LABELLED `label`, produced by the application itself:
 * the booking carries the label the client sent, `createOrder` copies it onto the payments row, and
 * `verify` captures the payment. Nothing here is written by hand — this is the shape production
 * writes, which is the whole point: O7's structural test existed because no fixture could reach the
 * wallet-labelled payments row honestly. This one does.
 */
async function gatewayPaid(label: string) {
  const u = await user("gw");
  const b = await booking(u.id, { status: "PENDING", paymentStatus: "PENDING", paymentMethod: label });

  const order = await paymentService.createOrder(u.id, b.id);
  if (!order || "error" in order) throw new Error(`createOrder: ${JSON.stringify(order)}`);
  const paymentId = `pay_Trte${rnd()}${rnd()}`;
  const verified = await paymentService.verify(u.id, {
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: razorpayService.computePaymentSignature(order.razorpayOrderId, paymentId),
  });
  if (!verified || "error" in verified) throw new Error(`verify: ${JSON.stringify(verified)}`);

  const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
  // The premise of every test below, asserted rather than assumed.
  expect(p.status).toBe("SUCCESS");
  expect(p.paymentMethod).toBe(label);
  expect(p.razorpayPaymentId).toBe(paymentId);
  expect(await prisma.walletTransaction.count({ where: { referenceId: b.id, type: "DEBIT" } })).toBe(0);
  return { userId: u.id, bookingId: b.id, paymentId: p.id };
}

async function walletFunded() {
  const u = await user("wf");
  const b = await booking(u.id, { status: "PENDING", paymentStatus: "PENDING" });
  const t = await walletService.addMoney(u.id, 500);
  if ("error" in t) throw new Error(String(t.error));
  await walletService.verifyTopUp(u.id, { razorpayOrderId: t.razorpayOrderId, razorpayPaymentId: `pay_${Date.now()}_${rnd()}`, razorpaySignature: "sig" });
  const paid = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
  if (!("ok" in paid)) throw new Error(JSON.stringify(paid));
  return { userId: u.id, bookingId: b.id };
}

const wallet = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;

async function settle(bookingId: string) {
  for (let i = 0; i < 100; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return b.refundStatus;
    await new Promise((r) => setTimeout(r, 100));
  }
  return "pending";
}

describe("refund tender is decided by how the money arrived, not by the label", () => {
  test("a gateway-captured payment labelled 'wallet' is refunded through the gateway on cancellation", async () => {
    const f = await gatewayPaid("wallet");
    const before = await wallet(f.userId);

    const res = await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte cancel");
    expect("refundAmount" in res && res.refundAmount).toBe(500);
    await settle(f.bookingId);

    // The customer's wallet is untouched: no store credit was minted for money that came by gateway.
    expect(await wallet(f.userId)).toBe(before);
    expect(await prisma.walletTransaction.count({ where: { referenceId: f.bookingId, type: "REFUND" } })).toBe(0);

    const rr = await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId } });
    expect(rr.length).toBe(1);
    expect(rr[0].status).toBe("COMPLETED");
    // NODE_ENV=test has no gateway credential: the dev-mock gateway answered, and ITS id is the proof
    // that the gateway path ran. The wallet path writes `wallet:<txn id>` here.
    expect(rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(true);
  }, 60_000);

  test("the same payment is refunded through the gateway by an admin refund too", async () => {
    const f = await gatewayPaid("wallet");
    const before = await wallet(f.userId);
    const admin = await user("adm", "ADMIN");

    const res = await bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: admin.id, amount: 200, reason: "rte admin" });
    expect("error" in res).toBe(false);

    expect(await wallet(f.userId)).toBe(before);
    const rr = await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId } });
    expect(rr.length).toBe(1);
    expect(rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(true);
  }, 60_000);

  test("the quote shown before cancelling promises the gateway, not an instant wallet credit", async () => {
    const f = await gatewayPaid("wallet");
    const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
    expect(q?.refundAmount).toBe(500);
    expect(q?.refundMethodHint).toBe("gateway_5_7_days");
  });

  test("control: an ordinary gateway payment is unchanged", async () => {
    const f = await gatewayPaid("razorpay");
    const before = await wallet(f.userId);
    await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte control");
    await settle(f.bookingId);
    expect(await wallet(f.userId)).toBe(before);
    const rr = await prisma.refundRequest.findMany({ where: { paymentId: f.paymentId } });
    expect(rr.length).toBe(1);
    expect(rr[0].gatewayRefundId?.startsWith("rfnd_dev_")).toBe(true);
  }, 60_000);

  test("control: a booking the wallet really paid is still refunded to the wallet", async () => {
    const f = await walletFunded();
    expect(await wallet(f.userId)).toBe(0);
    const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
    expect(q?.refundMethodHint).toBe("wallet_instant");

    await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte wallet control");
    expect(await settle(f.bookingId)).toBe("processed");
    expect(await wallet(f.userId)).toBe(500);
    expect(await prisma.walletTransaction.count({ where: { referenceId: f.bookingId, type: "REFUND" } })).toBe(1);
  }, 60_000);
});

describe("a cancellation never promises money that was never paid", () => {
  async function unpaid() {
    const u = await user("np");
    const b = await booking(u.id, { status: "ASSIGNED", paymentStatus: "PENDING" });
    return { userId: u.id, bookingId: b.id };
  }

  test("admin cancel of an unpaid booking: refund ₹0 everywhere, and the notification says nothing about a refund", async () => {
    const f = await unpaid();
    const admin = await user("adm2", "ADMIN");

    const res = await bookingService.cancel({ userId: admin.id, admin: { refundPolicy: "full" } }, f.bookingId, "rte unpaid");
    expect("error" in res).toBe(false);
    expect("refundAmount" in res && res.refundAmount).toBe(0);
    expect("refundStatus" in res && res.refundStatus).toBe("none");

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(b.refundStatus).toBe("none");
    expect(b.refundAmount ?? 0).toBe(0);

    // `createForUserDetached` — give it a moment to land.
    let n = null as null | { message: string };
    for (let i = 0; i < 50 && !n; i++) {
      n = await prisma.notification.findFirst({ where: { referenceId: f.bookingId, type: "booking_cancelled_by_support" }, select: { message: true } });
      if (!n) await new Promise((r) => setTimeout(r, 100));
    }
    expect(n).not.toBeNull();
    expect(n!.message).not.toContain("refund");
    expect(n!.message).toContain("cancelled by support");
  }, 60_000);

  test("customer cancel of an unpaid booking reports a refund of ₹0", async () => {
    const f = await unpaid();
    const res = await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte unpaid self");
    expect("refundAmount" in res && res.refundAmount).toBe(0);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    expect(b.refundAmount ?? 0).toBe(0);
  }, 60_000);

  // Found by the real Razorpay TEST-mode run (2026-09-27): the amount was fixed, but the response still
  // carried the policy tier's message — "Free cancellation — full refund." — and fee for a booking that
  // was never paid.
  test("the unpaid cancel response promises no refund and claims no fee, in every policy tier", async () => {
    for (const hoursAhead of [72, 1]) {
      const u = await user("npm");
      const bk = await booking(u.id, { status: "ASSIGNED", paymentStatus: "PENDING", scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000) });
      const res = await bookingService.cancel({ userId: u.id }, bk.id, "rte unpaid message");
      expect("error" in res).toBe(false);
      if (!("refundMessage" in res)) throw new Error("no refundMessage");
      expect(res.refundAmount).toBe(0);
      expect(res.cancellationFee).toBe(0);
      expect(res.refundMessage).not.toMatch(/full refund|refund is on the way|% refund|fee applies/i);
      expect((res.refundMessage ?? "").toLowerCase()).toContain("nothing to refund");
    }
  }, 60_000);

  // Found on an Android emulator (coding-phase certification 2026-09-28): a checkout interrupted after
  // the order was created left the booking PENDING / payment INITIATED, and the cancel dialog showed
  // "Paid ₹550 · You get back ₹550 · Free cancellation — full refund." The quote fell back to the
  // booking PRICE whenever nothing was refundable, so it disagreed with the cancellation it previews.
  test("the quote shown before cancelling an unpaid booking promises nothing, and the cancellation agrees", async () => {
    for (const [hoursAhead, withOrder] of [[72, true], [1, false]] as const) {
      const u = await user("npq");
      const bk = await booking(u.id, { status: "PENDING", paymentStatus: "PENDING", scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000) });
      if (withOrder) {
        const order = await paymentService.createOrder(u.id, bk.id);
        if (!order || "error" in order) throw new Error(`createOrder: ${JSON.stringify(order)}`);
        expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: bk.id } })).status).toBe("INITIATED");
      }
      const q = await bookingRefundService.quoteForBooking(bk.id, "user");
      if (!q) throw new Error("no quote");
      expect(q.paidAmount).toBe(0);
      expect(q.feeAmount).toBe(0);
      expect(q.refundAmount).toBe(0);
      expect(q.message).not.toMatch(/full refund|% refund|fee applies/i);
      expect(q.message.toLowerCase()).toContain("nothing to refund");

      const res = await bookingService.cancel({ userId: u.id }, bk.id, "rte unpaid quote");
      if (!("refundMessage" in res)) throw new Error(`cancel: ${JSON.stringify(res)}`);
      expect(res.refundAmount).toBe(q.refundAmount);
      expect(res.cancellationFee).toBe(q.feeAmount);
      expect(res.refundMessage).toBe(q.message);
    }
  }, 60_000);

  test("control: the quote for a PAID booking still shows the money, the fee and the tier", async () => {
    const f = await walletFunded();
    await prisma.booking.update({ where: { id: f.bookingId }, data: { scheduledDate: new Date(Date.now() + 1 * 3_600_000) } });
    const q = await bookingRefundService.quoteForBooking(f.bookingId, "user");
    if (!q) throw new Error("no quote");
    expect(q.paidAmount).toBe(500);
    expect(q.feeAmount).toBe(125);
    expect(q.refundAmount).toBe(375);
    expect(q.message).toContain("25% cancellation fee");
    await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte paid quote cleanup");
    await settle(f.bookingId);
  }, 60_000);

  test("control: a PAID cancel still carries the policy tier's message and fee", async () => {
    const f = await walletFunded();
    await prisma.booking.update({ where: { id: f.bookingId }, data: { scheduledDate: new Date(Date.now() + 1 * 3_600_000) } });
    const res = await bookingService.cancel({ userId: f.userId }, f.bookingId, "rte paid late");
    if (!("refundMessage" in res)) throw new Error("no refundMessage");
    expect(res.cancellationFee).toBe(125);
    expect(res.refundMessage).toContain("25% cancellation fee");
    await settle(f.bookingId);
  }, 60_000);

  test("control: a paid booking cancelled by support still tells the customer the refund amount", async () => {
    const f = await walletFunded();
    const admin = await user("adm3", "ADMIN");
    const res = await bookingService.cancel({ userId: admin.id, admin: { refundPolicy: "full" } }, f.bookingId, "rte paid");
    expect("refundAmount" in res && res.refundAmount).toBe(500);
    let n = null as null | { message: string };
    for (let i = 0; i < 50 && !n; i++) {
      n = await prisma.notification.findFirst({ where: { referenceId: f.bookingId, type: "booking_cancelled_by_support" }, select: { message: true } });
      if (!n) await new Promise((r) => setTimeout(r, 100));
    }
    expect(n!.message).toContain("₹500 refund is on the way");
  }, 60_000);
});

describe("the tender rule, stated once", () => {
  test("a gateway payment id is the evidence; the label is not", () => {
    expect(arrivedThroughGateway({ razorpayPaymentId: "pay_T20jG0cKzv68MQ" })).toBe(true);
    expect(arrivedThroughGateway({ razorpayPaymentId: null })).toBe(false);
    expect(arrivedThroughGateway({ razorpayPaymentId: "" })).toBe(false);
    expect(arrivedThroughGateway(null)).toBe(false);
    // Not a gateway id: an internal reference must not be mistaken for one.
    expect(arrivedThroughGateway({ razorpayPaymentId: "wallet_txn_123" })).toBe(false);
  });

  test("wallet tender is a wallet label with NO gateway payment behind it", () => {
    expect(isWalletTender({ paymentMethod: "wallet", razorpayPaymentId: null })).toBe(true);
    expect(isWalletTender({ paymentMethod: "WALLET", razorpayPaymentId: null })).toBe(true);
    expect(isWalletTender({ paymentMethod: "wallet", razorpayPaymentId: "wallet_txn_123" })).toBe(true);
    expect(isWalletTender({ paymentMethod: "wallet", razorpayPaymentId: "pay_abc" })).toBe(false);
    expect(isWalletTender({ paymentMethod: "razorpay", razorpayPaymentId: null })).toBe(false);
    expect(isWalletTender({ paymentMethod: "upi", razorpayPaymentId: "pay_abc" })).toBe(false);
  });

  test("the quote describes the refund that will be made", () => {
    expect(refundTenderLabel(null, "wallet")).toBe("wallet");
    expect(refundTenderLabel({ paymentMethod: "wallet", razorpayPaymentId: "pay_abc" }, "wallet")).toBe("razorpay");
    expect(refundTenderLabel({ paymentMethod: "wallet", razorpayPaymentId: null }, "wallet")).toBe("wallet");
    expect(refundTenderLabel({ paymentMethod: "upi", razorpayPaymentId: "pay_abc" }, "wallet")).toBe("upi");
    // The split method is never rewritten: the split path owns its own allocation.
    expect(refundTenderLabel({ paymentMethod: "wallet_razorpay_split", razorpayPaymentId: "pay_abc" }, null)).toBe("wallet_razorpay_split");
  });
});
