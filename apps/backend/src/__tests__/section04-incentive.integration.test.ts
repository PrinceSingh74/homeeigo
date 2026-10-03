/**
 * Section 04 — Partner incentive qualification → payout → ledger → wallet.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus, JournalEntryType } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerIncentivePayoutService } from "../services/partner-incentive-payout.service";
import { financialLedgerService } from "../services/financial-ledger.service";

const RUN_ID = `s04-inc-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let testRuleId = "";

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  await financialLedgerService.ensureAccountsSeeded();
  ctx = await seedAdversarialFixtures(RUN_ID);

  const rule = await prisma.partnerIncentiveRule.create({
    data: {
      code: `S04_TEST_${RUN_ID}`,
      name: "Section 04 Test Bonus",
      period: "DAILY",
      metric: "completed_jobs",
      threshold: 1,
      bonusAmount: 250,
      isActive: true,
    },
  });
  testRuleId = rule.id;

  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { walletBalance: 0, walletBalancePaise: 0n },
  });
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.partnerIncentivePayout.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.partnerIncentiveRule.deleteMany({ where: { code: { startsWith: "S04_TEST_" } } });
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Section 04 partner incentive payout pipeline", () => {
  test("qualified rule creates payout, wallet credit, and ledger once", async () => {
    if (skipIfNoDb()) return;

    await prisma.booking.create({
      data: {
        bookingNumber: `S04-${RUN_ID}`,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.COMPLETED,
        completedAt: new Date(),
        scheduledDate: new Date(),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: "SUCCESS",
        paymentMethod: "razorpay",
      },
    });

    const beforeWallet = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { walletBalance: true },
    });

    const first = await partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId);
    expect(first.credited.length).toBeGreaterThanOrEqual(1);

    const payout = await prisma.partnerIncentivePayout.findFirst({
      where: { providerId: ctx.providerId, ruleId: testRuleId },
    });
    expect(payout).not.toBeNull();
    expect(payout!.amount).toBe(250);
    expect(payout!.status).toBe("CREDITED");

    const afterWallet = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { walletBalance: true },
    });
    expect(afterWallet.walletBalance).toBe(beforeWallet.walletBalance + 250);

    const walletTxn = await prisma.walletTransaction.findFirst({
      where: { providerId: ctx.providerId, referenceType: "partner_incentive_payout" },
    });
    expect(walletTxn).not.toBeNull();
    expect(walletTxn!.type).toBe("BONUS");
    expect(walletTxn!.amount).toBe(250);

    const journal = await prisma.journalEntry.findFirst({
      where: {
        type: JournalEntryType.PARTNER_INCENTIVE,
        referenceId: payout!.id,
      },
    });
    expect(journal).not.toBeNull();

    const second = await partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId);
    expect(second.credited.length).toBe(0);

    const payoutCount = await prisma.partnerIncentivePayout.count({
      where: { providerId: ctx.providerId, ruleId: testRuleId },
    });
    expect(payoutCount).toBe(1);
  });

  test("concurrent evaluation creates only one payout", async () => {
    if (skipIfNoDb()) return;

    const runId2 = `${RUN_ID}-race`;
    const rule = await prisma.partnerIncentiveRule.create({
      data: {
        code: `S04_TEST_${runId2}`,
        name: "Race Bonus",
        period: "DAILY",
        metric: "completed_jobs",
        threshold: 1,
        bonusAmount: 100,
        isActive: true,
      },
    });

    await prisma.booking.create({
      data: {
        bookingNumber: `S04R-${runId2}`,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.COMPLETED,
        completedAt: new Date(),
        scheduledDate: new Date(),
        baseAmount: 400,
        finalAmount: 400,
        totalAmount: 400,
        paymentStatus: "SUCCESS",
        paymentMethod: "razorpay",
      },
    });

    await Promise.all([
      partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
      partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
      partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
    ]);

    const count = await prisma.partnerIncentivePayout.count({
      where: { providerId: ctx.providerId, ruleId: rule.id },
    });
    expect(count).toBe(1);

    await prisma.partnerIncentivePayout.deleteMany({ where: { ruleId: rule.id } });
    await prisma.partnerIncentiveRule.delete({ where: { id: rule.id } });
  });
});
