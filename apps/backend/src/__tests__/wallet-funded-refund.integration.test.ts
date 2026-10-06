/**
 * Wallet-funded booking refunds — runs against the ISOLATED homigo_test DB.
 *   NODE_ENV=test bun test D:/homigo/apps/backend/src/__tests__/wallet-funded-refund.integration.test.ts
 *
 * A booking paid through `walletCheckoutService.payBookingFromWallet` has NO payments row. Every other
 * wallet-refund test builds that row by hand (a row production never writes), which is why a customer
 * quoted "Free cancellation — full refund" could receive ₹0 while the suite stayed green. These tests
 * use the real checkout and assert the money, not the response.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { provenanceForNewUser } from "../lib/data-provenance";
import "../load-env";
import prisma from "../lib/prisma";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { bookingService } from "../services/booking.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { LIVE_FIXTURE_SERVICE } from "./helpers/live-fixture-service";

const createdUserIds: string[] = [];

async function walletPaidBooking(price = 500, hoursAhead = 72) {
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`wfr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.test`),
      email: `wfr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.test`,
      phoneNumber: `+9177${Math.floor(1e6 + Math.random() * 8e6)}`,
      firstName: "Wfr",
      lastName: "Test",
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });
  createdUserIds.push(u.id);
  const t = await walletService.addMoney(u.id, price);
  if ("error" in t) throw new Error(t.error);
  await walletService.verifyTopUp(u.id, {
    razorpayOrderId: t.razorpayOrderId,
    razorpayPaymentId: `pay_${Date.now()}_${Math.random()}`,
    razorpaySignature: "sig",
  });
  const s = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE, name: `wfr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, slug: `wfr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, description: "x", category: "cleaning", basePrice: price, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `WFR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: u.id, serviceId: s.id, addressId: a.id, status: "PENDING",
      scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000),
      baseAmount: price, finalAmount: price, totalAmount: price, paymentStatus: "PENDING",
    },
  });
  const pay = await walletCheckoutService.payBookingFromWallet(u.id, b.id);
  if (!("ok" in pay)) throw new Error(JSON.stringify(pay));
  expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(0);
  return { userId: u.id, bookingId: b.id };
}

async function walletPaise(userId: string) {
  return Number((await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalancePaise: true } })).walletBalancePaise);
}
async function refundTxns(bookingId: string) {
  return prisma.walletTransaction.findMany({ where: { referenceId: bookingId, type: "REFUND", status: "COMPLETED" } });
}
async function settle(bookingId: string) {
  for (let i = 0; i < 50; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

afterAll(async () => {
  // Ledger rows are history and stay; only non-financial fixtures would be removable, so nothing is deleted.
  void createdUserIds;
});

describe("wallet-funded booking refunds (no payments row)", () => {
  test("cancellation credits the quoted full refund once, with one balanced journal", async () => {
    const f = await walletPaidBooking(500);
    const quote = await bookingRefundService.quoteForBooking(f.bookingId, "user");
    expect(quote?.refundAmount).toBe(500);
    const res = await bookingService.cancel({ userId: f.userId }, f.bookingId, "wfr test");
    expect("refundAmount" in res && res.refundAmount).toBe(500);
    await settle(f.bookingId);

    expect(await walletPaise(f.userId)).toBe(50_000);
    const txns = await refundTxns(f.bookingId);
    expect(txns.length).toBe(1);
    const journal = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: `wallet_booking_refund:${f.bookingId}` },
      include: { lines: true },
    });
    expect(journal).not.toBeNull();
    const dr = journal!.lines.reduce((s, e) => s + Number(e.debitPaise), 0);
    const cr = journal!.lines.reduce((s, e) => s + Number(e.creditPaise), 0);
    expect(dr).toBe(50_000);
    expect(cr).toBe(50_000);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    expect(b.refundStatus).toBe("processed");
    expect(b.refundAmount).toBe(500);
  });

  test("eight concurrent refunds credit once and every caller reports processed", async () => {
    const f = await walletPaidBooking(400);
    await prisma.booking.update({ where: { id: f.bookingId }, data: { status: "CANCELLED_BY_USER", cancelledAt: new Date() } });
    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        bookingRefundService.processCancellationRefund({ bookingId: f.bookingId, userId: f.userId, actorUserId: f.userId, reason: "x8", cancelledBy: "user", refundAmount: 400 }),
      ),
    );
    expect(rs.every((r) => r.status === "processed")).toBe(true);
    expect((await refundTxns(f.bookingId)).length).toBe(1);
    expect(await walletPaise(f.userId)).toBe(40_000);
  });

  test("admin partial refunds are capped by what the wallet paid", async () => {
    const f = await walletPaidBooking(1000);
    const admins = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        bookingRefundService.processAdminRefund({ bookingId: f.bookingId, userId: f.userId, adminId: `${f.userId}-a${i}`, amount: 200, reason: "x8" }),
      ),
    );
    expect(admins.filter((a) => !("error" in a)).length).toBe(5);
    expect(admins.filter((a) => "error" in a && a.error === "AMOUNT_EXCEEDS_REFUNDABLE").length).toBe(3);
    expect(await walletPaise(f.userId)).toBe(100_000);
    // Nothing left to refund: a later cancellation quotes and pays ₹0.
    const quote = await bookingRefundService.quoteForBooking(f.bookingId, "user");
    expect(quote?.refundAmount).toBe(0);
  });

  test("a cancellation whose refund was lost to a crash is recovered exactly once", async () => {
    const f = await walletPaidBooking(300);
    // The state a crash between the cancel commit and the detached refund leaves behind.
    await prisma.booking.update({
      where: { id: f.bookingId },
      data: { status: "CANCELLED_BY_USER", cancelledAt: new Date(Date.now() - 120_000), refundStatus: "pending", refundAmount: 300, cancelledBy: "user" },
    });
    const first = await bookingRefundService.recoverStrandedCancellationRefunds(25);
    expect(first.recovered).toBeGreaterThanOrEqual(1);
    const second = await bookingRefundService.recoverStrandedCancellationRefunds(25);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    expect(b.refundStatus).toBe("processed");
    expect((await refundTxns(f.bookingId)).length).toBe(1);
    expect(await walletPaise(f.userId)).toBe(30_000);
    expect(second.scanned).toBe(0);
  });
});
