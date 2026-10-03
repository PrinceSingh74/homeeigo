/**
 * Section 04 incentive pipeline cert (avoids bun:test segfault on this file).
 * Usage: bun --env-file=.env.test run scripts/section04-incentive-cert.ts
 */
import "../src/load-env";
import { BookingStatus, JournalEntryType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { partnerIncentivePayoutService } from "../src/services/partner-incentive-payout.service";
import { financialLedgerService } from "../src/services/financial-ledger.service";
import {
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
} from "../src/__tests__/helpers/adversarial-fixtures";

const RUN_ID = `s04-inc-${Date.now().toString(36)}`;
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  await financialLedgerService.ensureAccountsSeeded();
  await prisma.partnerIncentiveRule.deleteMany({ where: { code: { startsWith: "S04_TEST_" } } });
  const ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.partnerIncentivePayout.deleteMany({ where: { providerId: ctx.providerId } });
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
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { walletBalance: 0, walletBalancePaise: 0n },
  });
  await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
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

  const before = await prisma.provider.findUniqueOrThrow({
    where: { id: ctx.providerId },
    select: { walletBalance: true },
  });
  const first = await partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId);
  const payout = await prisma.partnerIncentivePayout.findFirst({
    where: { providerId: ctx.providerId, ruleId: rule.id },
  });
  const after = await prisma.provider.findUniqueOrThrow({
    where: { id: ctx.providerId },
    select: { walletBalance: true },
  });
  const journal = payout
    ? await prisma.journalEntry.findFirst({
        where: { type: JournalEntryType.PARTNER_INCENTIVE, referenceId: payout.id },
      })
    : null;
  const second = await partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId);

  gate("incentive.credited", first.credited.length >= 1, `n=${first.credited.length}`);
  gate("incentive.payout_row", Boolean(payout) && payout?.amount === 250 && payout?.status === "CREDITED");
  gate("incentive.wallet", payout && after.walletBalance === before.walletBalance + payout.amount, `${before.walletBalance} → ${after.walletBalance} (payout ${payout?.amount})`);
  gate("incentive.ledger", Boolean(journal));
  gate("incentive.idempotent", second.credited.length === 0);

  const raceRule = await prisma.partnerIncentiveRule.create({
    data: {
      code: `S04_TEST_${RUN_ID}-race`,
      name: "Race Bonus",
      period: "DAILY",
      metric: "completed_jobs",
      threshold: 1,
      bonusAmount: 100,
      isActive: true,
    },
  });
  await Promise.all([
    partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
    partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
    partnerIncentivePayoutService.evaluateAndCreditIncentives(ctx.providerId),
  ]);
  const raceCount = await prisma.partnerIncentivePayout.count({
    where: { providerId: ctx.providerId, ruleId: raceRule.id },
  });
  gate("incentive.concurrent_one_payout", raceCount === 1, `count=${raceCount}`);

  await prisma.partnerIncentivePayout.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.partnerIncentiveRule.deleteMany({ where: { code: { startsWith: "S04_TEST_" } } });
  await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
  console.log(failed === 0 ? "\nSECTION 04 INCENTIVE CERT: FULL PASS" : `\nSECTION 04 INCENTIVE CERT: FAIL (${failed})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
