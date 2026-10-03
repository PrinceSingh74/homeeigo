import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CashbackStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { cashbackService } from "../services/cashback.service";

/**
 * OWNER DECISION #4 — a partial refund does not reverse cashback.
 *
 * ── What it used to do ──────────────────────────────────────────────────────
 *
 * `reverseOnRefund` reversed the ENTIRE cashback on any refund, so a 50-rupee partial refund on a
 * 500-rupee booking clawed back every rupee of the reward earned on the 450 the customer still paid.
 *
 * ── Why full-refund-only rather than pro-rating ─────────────────────────────
 *
 * Pro-rating is more precise and was rejected deliberately: `MembershipCashback` has no
 * reversed-amount column and a one-shot status machine, so pro-rating across successive partial
 * refunds would need new persistent state on a money table.
 *
 * The asymmetry decided it. Over-reversal cannot be undone reliably — the debit is capped at the
 * customer's current wallet balance, so someone who already spent the cashback keeps the shortfall
 * and the books disagree with the balance permanently. Under-reversal costs the platform a bounded
 * amount, harms nobody, and self-corrects when the remainder is refunded.
 *
 * These cases pin both directions, because a rule that only ever protects the customer would be as
 * wrong as the original: a full refund must still take the reward back.
 */
const RUN = `cashback-decision-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

async function seedBookingWithCashback(index: number, paid: number, refunded: number, cashback: number) {
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
    paid,
  );

  const status = refunded >= paid - 0.005 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
  await prisma.$executeRawUnsafe(
    `INSERT INTO payments (id, booking_id, idempotency_key, razorpay_order_id, user_id, amount,
                           refunded_amount, status, payment_method, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"PaymentStatus", 'wallet', NOW(), NOW())`,
    `${RUN}-p-${index}`,
    bookingId,
    `${RUN}-p-${index}-idem-${Date.now()}`,
    `order_${RUN}_${index}_${Date.now()}`,
    ctx.customerA.id,
    paid,
    refunded,
    status,
  );

  await prisma.membershipCashback.create({
    data: {
      userId: ctx.customerA.id,
      bookingId,
      amount: cashback,
      cashbackPct: 10,
      settledAmount: paid,
      status: CashbackStatus.CREDITED,
    },
  });
  return bookingId;
}

async function clearAll() {
  await prisma.membershipCashback.deleteMany({ where: { bookingId: { startsWith: `${RUN}-b-` } } });
  await prisma.$executeRawUnsafe(`DELETE FROM payments WHERE id LIKE $1`, `${RUN}-p-%`);
  await prisma.$executeRawUnsafe(`DELETE FROM bookings WHERE id LIKE $1`, `${RUN}-b-%`);
}

/**
 * Give the customer enough balance that a reversal is never capped by an empty wallet.
 *
 * This writes the balance directly, which by itself breaks `wallet_balance_consistency`: the ops
 * balance moves and the ledger does not. That is acceptable only because the original balance is
 * restored in `afterAll` — an earlier version of this file did not restore it and left the platform
 * ledger 1,400 rupees out of step, which the financial integrity run correctly reported as
 * WALLET_LIABILITY_MISMATCH and which failed a completely different suite.
 */
async function fundWallet(amount: number) {
  await prisma.user.update({
    where: { id: ctx.customerA.id },
    data: { walletBalance: amount, walletBalancePaise: BigInt(Math.round(amount * 100)) },
  });
}

/** The customer's balance before this file touched it, restored on the way out. */
let originalWallet: { walletBalance: number; walletBalancePaise: bigint } | null = null;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  originalWallet = await prisma.user.findUnique({
    where: { id: ctx.customerA.id },
    select: { walletBalance: true, walletBalancePaise: true },
  });
  await clearAll();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearAll();
  // Put the balance back before anything else measures the platform's wallet-versus-ledger totals.
  if (originalWallet) {
    await prisma.user
      .update({ where: { id: ctx.customerA.id }, data: originalWallet })
      .catch(() => undefined);
  }
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("a partial refund leaves the reward standing", () => {
  test("a 50 rupee refund on a 500 rupee booking does not touch the cashback", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = await seedBookingWithCashback(0, 500, 50, 50);

    const result = await cashbackService.reverseOnRefund(bookingId);

    expect(result.reversed).toBe(false);
    expect(result.amount).toBe(0);
    const row = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    expect(row?.status).toBe(CashbackStatus.CREDITED);
  });

  test("a refund just short of the full amount still leaves it standing", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    // 499.98 of 500 — outside the half-paise tolerance, so still partial.
    const bookingId = await seedBookingWithCashback(1, 500, 499.98, 50);

    expect((await cashbackService.reverseOnRefund(bookingId)).reversed).toBe(false);
    const row = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    expect(row?.status).toBe(CashbackStatus.CREDITED);
  });

  test("the customer's wallet is not debited by a partial refund", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = await seedBookingWithCashback(2, 500, 100, 50);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });
    await cashbackService.reverseOnRefund(bookingId);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });

    // The whole point of the decision: money the customer earned is not taken back on a part refund.
    expect(after.walletBalance).toBe(before.walletBalance);
  });
});

describe("a full refund still reverses the reward", () => {
  test("refunding the entire amount reverses the cashback", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = await seedBookingWithCashback(3, 500, 500, 50);

    const result = await cashbackService.reverseOnRefund(bookingId);

    expect(result.reversed).toBe(true);
    expect(result.amount).toBe(50);
    const row = await prisma.membershipCashback.findUnique({ where: { bookingId } });
    expect(row?.status).toBe(CashbackStatus.REVERSED);
  });

  test("a refund within the half-paise tolerance counts as full", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    // The same tolerance the refund path uses to decide REFUNDED vs PARTIALLY_REFUNDED.
    const bookingId = await seedBookingWithCashback(4, 500, 499.999, 50);

    expect((await cashbackService.reverseOnRefund(bookingId)).reversed).toBe(true);
  });

  test("reversal remains one-shot — a second call does not debit again", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = await seedBookingWithCashback(5, 500, 500, 50);

    const first = await cashbackService.reverseOnRefund(bookingId);
    const balanceAfterFirst = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });
    const second = await cashbackService.reverseOnRefund(bookingId);
    const balanceAfterSecond = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });

    expect(first.reversed).toBe(true);
    expect(second.reversed).toBe(false);
    expect(balanceAfterSecond.walletBalance).toBe(balanceAfterFirst.walletBalance);
  });

  test("concurrent reversals of the same full refund debit exactly once", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = await seedBookingWithCashback(6, 500, 500, 50);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });

    /**
     * Three call sites reach this function and a refund can trip more than one of them. The advisory
     * lock plus the CREDITED check must collapse them to a single debit.
     */
    const results = await Promise.all([
      cashbackService.reverseOnRefund(bookingId).catch(() => ({ reversed: false, amount: 0 })),
      cashbackService.reverseOnRefund(bookingId).catch(() => ({ reversed: false, amount: 0 })),
      cashbackService.reverseOnRefund(bookingId).catch(() => ({ reversed: false, amount: 0 })),
    ]);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });

    expect(results.filter((r) => r.reversed).length).toBe(1);
    expect(before.walletBalance - after.walletBalance).toBeCloseTo(50, 2);
  });
});

describe("edge cases that must not reverse", () => {
  test("a booking with no payment row does not reverse — an unprovable full refund is treated as partial", async () => {
    if (!dbOk) return;
    await clearAll();
    await fundWallet(1000);
    const bookingId = `${RUN}-b-90`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO bookings (id, booking_number, user_id, service_id, address_id, scheduled_date,
                             base_amount, final_amount, total_amount, updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + '91 hours'::interval, 500, 500, 500, NOW(), NOW())`,
      bookingId,
      `${bookingId}-BN`,
      ctx.customerA.id,
      ctx.serviceId,
      ctx.addressAId,
    );
    await prisma.membershipCashback.create({
      data: {
        userId: ctx.customerA.id,
        bookingId,
        amount: 50,
        cashbackPct: 10,
        settledAmount: 500,
        status: CashbackStatus.CREDITED,
      },
    });

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });
    const result = await cashbackService.reverseOnRefund(bookingId);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.customerA.id },
      select: { walletBalance: true },
    });

    expect(result.reversed).toBe(false);
    expect(after.walletBalance).toBe(before.walletBalance);
  });

  test("a zero-amount payment cannot exist, so it is not a case this rule must handle", async () => {
    if (!dbOk) return;
    /**
     * Worth recording rather than testing behaviourally: `payments_amount_paise_positive` refuses a
     * payment of zero at the database level, so `paid > 0` in the rule above can never be the thing
     * that saves us. An earlier version of this file tried to seed one and the insert was rejected —
     * which is the correct answer, from the right layer.
     */
    await expect(
      (async () => {
        await prisma.$executeRawUnsafe(
          `INSERT INTO payments (id, booking_id, idempotency_key, razorpay_order_id, user_id, amount,
                                 refunded_amount, status, payment_method, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, 0, 'REFUNDED'::"PaymentStatus", 'wallet', NOW(), NOW())`,
          `${RUN}-zero`,
          `${RUN}-b-0`,
          `${RUN}-zero-idem`,
          `order_${RUN}_zero`,
          ctx.customerA.id,
        );
      })(),
    ).rejects.toThrow();
  });
});
