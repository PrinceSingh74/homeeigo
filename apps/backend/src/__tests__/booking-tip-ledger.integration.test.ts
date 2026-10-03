import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { ratingService } from "../services/rating.service";
import { walletService } from "../services/wallet.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { ledgerBackfillService } from "../services/ledger-backfill.service";
import { financialIntegrityService } from "../services/financial-integrity.service";

/**
 * A tip is money: it must leave the customer's wallet, arrive in the partner's wallet (rupee AND
 * paise), leave a COMPLETED wallet transaction on both sides that satisfies the
 * wallet_balance_consistency check, and post a balanced ledger journal — all or nothing.
 * Before this path existed the provider wallet was simply incremented from thin air.
 */
const RUN = `tip-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;

async function completedBooking(tag: string) {
  return prisma.booking.create({
    data: {
      bookingNumber: `TIP-${RUN}-${tag}`,
      userId: ctx.customerA.id,
      providerId: ctx.providerId,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: BookingStatus.COMPLETED,
      completedAt: new Date(),
      scheduledDate: new Date(Date.now() - 3_600_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
    },
  });
}

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
  // Funded through the real top-up (ledger-consistent), not a direct balance write: the tip journals this
  // suite posts would otherwise debit a wallet the ledger never credited, leaving ₹100 of liability drift.
  const topUp = await walletService.addMoney(ctx.customerA.id, 100);
  if ("error" in topUp) throw new Error(`fixture top-up failed: ${topUp.error}`);
  await walletService.verifyTopUp(ctx.customerA.id, {
    razorpayOrderId: topUp.razorpayOrderId,
    razorpayPaymentId: `pay_${RUN}_topup`,
    razorpaySignature: "fixture",
  });
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { walletBalance: 0, walletBalancePaise: 0n },
  });
}, 60_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.rating.deleteMany({ where: { userId: ctx.customerA.id } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("customer tip → wallet + ledger", () => {
  it("moves the tip from customer wallet to partner wallet with transactions and a journal", async () => {
    if (!reachable) return;
    const booking = await completedBooking("ok");
    const customerBefore = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id } });
    const providerBefore = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId } });
    const payableBefore = await financialLedgerService.getAccountBalance("PROVIDER_PAYABLE");
    const walletLiabBefore = await financialLedgerService.getAccountBalance("CUSTOMER_WALLET");

    const result = await ratingService.create(ctx.customerA.id, { bookingId: booking.id, rating: 5, tipAmount: 40 });
    expect("error" in result).toBe(false);

    const customerAfter = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id } });
    const providerAfter = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId } });
    expect(customerAfter.walletBalance).toBeCloseTo(customerBefore.walletBalance - 40, 2);
    expect(customerAfter.walletBalancePaise - customerBefore.walletBalancePaise).toBe(-4_000n);
    expect(providerAfter.walletBalance).toBeCloseTo(providerBefore.walletBalance + 40, 2);
    expect(providerAfter.walletBalancePaise - providerBefore.walletBalancePaise).toBe(4_000n);

    const debit = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: `tip-debit:${booking.id}` } });
    const credit = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: `tip-credit:${booking.id}` } });
    expect(debit?.status).toBe("COMPLETED");
    expect(debit?.type).toBe("DEBIT");
    expect(debit?.userId).toBe(ctx.customerA.id);
    expect(debit!.walletBalanceAfter).toBeCloseTo(debit!.walletBalanceBefore - 40, 2);
    expect(credit?.status).toBe("COMPLETED");
    expect(credit?.type).toBe("CREDIT");
    expect(credit?.providerId).toBe(ctx.providerId);
    expect(credit!.walletBalanceAfter).toBeCloseTo(credit!.walletBalanceBefore + 40, 2);

    const journal = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: `booking_tip:${booking.id}` },
      include: { lines: { include: { account: true } } },
    });
    expect(journal).not.toBeNull();
    const byCode = Object.fromEntries(journal!.lines.map((l) => [l.account.code, { d: l.debit, c: l.credit }]));
    expect(byCode.CUSTOMER_WALLET).toEqual({ d: 40, c: 0 });
    expect(byCode.PROVIDER_PAYABLE).toEqual({ d: 0, c: 40 });

    // Ops wallets and ledger accounts moved by the same amount → the integrity check stays green.
    expect((await financialLedgerService.getAccountBalance("PROVIDER_PAYABLE")) - payableBefore).toBeCloseTo(40, 2);
    expect((await financialLedgerService.getAccountBalance("CUSTOMER_WALLET")) - walletLiabBefore).toBeCloseTo(-40, 2);

    const rating = await prisma.rating.findUnique({ where: { bookingId: booking.id } });
    expect(rating?.tipAmount).toBe(40);
  });

  it("the ledger backfill does not book a tip a second time", async () => {
    if (!reachable) return;
    const booking = await completedBooking("backfill");
    const result = await ratingService.create(ctx.customerA.id, { bookingId: booking.id, rating: 5, tipAmount: 10 });
    expect("error" in result).toBe(false);
    const debit = await prisma.walletTransaction.findUniqueOrThrow({ where: { idempotencyKey: `tip-debit:${booking.id}` } });
    const walletLiabBefore = await financialLedgerService.getAccountBalance("CUSTOMER_WALLET");

    // The tip is already on the ledger as booking_tip:<bookingId>. The backfill looked only for
    // wallet_debit:<txnId>, never found it, and wrote a second WALLET_DEBIT journal for the same money.
    await ledgerBackfillService.run({ types: ["WALLET_DEBIT"], limit: 5000, startedBy: "tip-ledger-test" });

    expect(await prisma.journalEntry.findUnique({ where: { idempotencyKey: `wallet_debit:${debit.id}` } })).toBeNull();
    expect(await financialLedgerService.getAccountBalance("CUSTOMER_WALLET")).toBeCloseTo(walletLiabBefore, 2);
    // Every tip carries its booking_tip journal, so the integrity check must not call any tip unjournaled.
    // (It stops at the first missing journal it finds, hence all tips rather than just this one.)
    const tipDebits = new Set(
      (await prisma.walletTransaction.findMany({ where: { referenceType: "booking_tip", type: "DEBIT" }, select: { id: true } })).map((t) => t.id),
    );
    const report = await financialIntegrityService.validate();
    const flagged = report.issues.filter((i) => i.category === "MISSING_LEDGER_ENTRY" && "referenceId" in i && tipDebits.has(String(i.referenceId)));
    expect(flagged).toEqual([]);
  });

  it("rejects a tip the wallet cannot fund and saves nothing", async () => {
    if (!reachable) return;
    const booking = await completedBooking("poor");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id } });

    const result = await ratingService.create(ctx.customerA.id, { bookingId: booking.id, rating: 4, tipAmount: 5_000 });
    expect(result).toEqual({ error: "TIP_INSUFFICIENT_WALLET" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id } });
    expect(after.walletBalance).toBe(before.walletBalance);
    expect(await prisma.rating.findUnique({ where: { bookingId: booking.id } })).toBeNull();
    expect(await prisma.walletTransaction.findUnique({ where: { idempotencyKey: `tip-debit:${booking.id}` } })).toBeNull();
    expect(await prisma.journalEntry.findUnique({ where: { idempotencyKey: `booking_tip:${booking.id}` } })).toBeNull();

    // The customer can still rate without a tip.
    const retry = await ratingService.create(ctx.customerA.id, { bookingId: booking.id, rating: 4 });
    expect("error" in retry).toBe(false);
  });

  it("a rating without a tip touches no wallet", async () => {
    if (!reachable) return;
    const booking = await completedBooking("notip");
    const before = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId } });
    const result = await ratingService.create(ctx.customerA.id, { bookingId: booking.id, rating: 3 });
    expect("error" in result).toBe(false);
    const after = await prisma.provider.findUniqueOrThrow({ where: { id: ctx.providerId } });
    expect(after.walletBalance).toBe(before.walletBalance);
    expect(await prisma.journalEntry.findUnique({ where: { idempotencyKey: `booking_tip:${booking.id}` } })).toBeNull();
  });
});
