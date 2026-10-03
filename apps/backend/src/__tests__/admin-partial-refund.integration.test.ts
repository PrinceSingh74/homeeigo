import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingRefundService } from "../services/booking-refund.service";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";

/**
 * Admin partial refunds of a wallet-paid booking: server-authoritative amount, cumulative refunds,
 * over-refund refused, identical retry a no-op, distinct second partial allowed.
 *
 * The booking is paid through the REAL wallet checkout, which writes no payments row. This suite used
 * to insert a `payments` row with paymentMethod "wallet" by hand — a state production never creates —
 * and so it tested a refund path real wallet bookings could not reach while the real path refunded ₹0.
 */
const RUN = `aref-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
let bookingId = "";

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
  await prisma.user.update({ where: { id: ctx.customerA.id }, data: { walletBalance: 0, walletBalancePaise: 0n } });
  // Funded through the product's own top-up path, so the ledger and the wallet agree.
  const topUp = await walletService.addMoney(ctx.customerA.id, 500);
  if ("error" in topUp) throw new Error(topUp.error);
  await walletService.verifyTopUp(ctx.customerA.id, {
    razorpayOrderId: topUp.razorpayOrderId,
    razorpayPaymentId: `pay_${RUN}_topup`,
    razorpaySignature: "sig",
  });
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `AREF-${RUN}`,
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: BookingStatus.PENDING,
      scheduledDate: new Date(Date.now() + 3 * 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.PENDING,
    },
  });
  bookingId = booking.id;
  const pay = await walletCheckoutService.payBookingFromWallet(ctx.customerA.id, bookingId);
  if (!("ok" in pay)) throw new Error(JSON.stringify(pay));
}, 60_000);

afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function wallet() {
  return (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id } })).walletBalance;
}
const remaining = () => bookingRefundService.refundableRemaining(bookingId, ctx.customerA.id);

describe("admin partial refund (wallet-paid through real checkout)", () => {
  it("the paid booking has no payments row and its whole price is refundable", async () => {
    if (!reachable) return;
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(0);
    expect(await wallet()).toBeCloseTo(0, 2);
    expect(await remaining()).toBe(500);
  });

  it("credits a partial amount", async () => {
    if (!reachable) return;
    const r = await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 200, reason: "[Admin] partial" });
    expect("error" in r).toBe(false);
    expect(await wallet()).toBeCloseTo(200, 2);
    expect(await remaining()).toBe(300);
  });

  it("an identical retry is a no-op (same idempotency key), not a second credit", async () => {
    if (!reachable) return;
    const r = await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 200, reason: "[Admin] partial again" });
    expect("error" in r).toBe(false);
    expect(await wallet()).toBeCloseTo(200, 2);
    expect(await remaining()).toBe(300);
  });

  it("a distinct second partial refund accumulates", async () => {
    if (!reachable) return;
    const r = await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 250, reason: "[Admin] second" });
    expect("error" in r).toBe(false);
    expect(await wallet()).toBeCloseTo(450, 2);
    expect(await remaining()).toBe(50);
  });

  it("refuses to exceed what was paid", async () => {
    if (!reachable) return;
    const r = await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 100, reason: "[Admin] too much" });
    expect(r).toEqual({ error: "AMOUNT_EXCEEDS_REFUNDABLE" });
    expect(await wallet()).toBeCloseTo(450, 2);
  });

  it("refuses zero / negative amounts", async () => {
    if (!reachable) return;
    expect(await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 0, reason: "x" })).toEqual({ error: "INVALID_AMOUNT" });
    expect(await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: -5, reason: "x" })).toEqual({ error: "INVALID_AMOUNT" });
  });

  it("the final remainder empties the booking and posts one balanced journal per refund", async () => {
    if (!reachable) return;
    const r = await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 50, reason: "[Admin] remainder" });
    expect("error" in r).toBe(false);
    expect(await wallet()).toBeCloseTo(500, 2);
    expect(await remaining()).toBe(0);

    const journals = await prisma.journalEntry.findMany({
      where: { referenceId: bookingId, referenceType: "booking_admin_refund" },
      include: { lines: { include: { account: true } } },
    });
    expect(journals.length).toBe(3);
    for (const j of journals) {
      const dr = j.lines.reduce((s, l) => s + Number(l.debitPaise), 0);
      const cr = j.lines.reduce((s, l) => s + Number(l.creditPaise), 0);
      expect(dr).toBe(cr);
      expect(j.lines.find((l) => l.account.code === "PLATFORM_ESCROW")?.debit).toBeGreaterThan(0);
      expect(j.lines.find((l) => l.account.code === "CUSTOMER_WALLET")?.credit).toBeGreaterThan(0);
    }

    // Nothing left: even ₹1 is now over the wallet ceiling.
    expect(await bookingRefundService.processAdminRefund({ bookingId, userId: ctx.customerA.id, adminId: ctx.financeAdmin.id, amount: 1, reason: "x" })).toEqual({ error: "AMOUNT_EXCEEDS_REFUNDABLE" });
  });
});
