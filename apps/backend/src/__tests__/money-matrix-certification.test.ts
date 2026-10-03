/**
 * Pass 11 — Numbered money matrix cases 7, 8, 11–20 against REAL PostgreSQL (homigo_test).
 *
 * Prior docs (PARTNER_OS_FORENSIC_CERTIFICATION) note cases 1–6 / 9–10 already PASS and
 * historically labeled 7–8 as walletId-tamper gaps; this harness implements the Pass 11
 * cover list against live services (not p0-financial-races simulations).
 *
 * Case map:
 *   7  — duplicate withdrawal
 *   8  — concurrent withdrawal
 *  11  — retry (same idempotency / completion retry)
 *  12  — stale balance
 *  13  — duplicate completion
 *  14  — duplicate payout
 *  15  — duplicate incentive
 *  16  — duplicate referral reward
 *  17  — replay (financial event / journal replay)
 *  18  — duplicate journal
 *  19  — ownership tampering
 *  20  — invalid financial transition
 *
 * Run alone:
 *   cd apps/backend && bun test src/__tests__/money-matrix-certification.test.ts
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  BookingStatus,
  JournalEntryType,
  PaymentStatus,
  UserRole,
  WithdrawalStatus,
} from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  fixturePhone,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { providerWalletReservationService } from "../services/provider-wallet-reservation.service";
import { earningsService } from "../services/earnings.service";
import { bookingService } from "../services/booking.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { partnerIncentivePayoutService, incentivePeriodKey, legacyUtcPeriodKey, LEGACY_PERIOD_KEY_CUTOVER } from "../services/partner-incentive-payout.service";
import { partnerReferralService } from "../services/partner-referral.service";
import { razorpayService } from "../services/razorpay.service";
import { assertReferralTransition } from "../lib/partner-referral-fsm";
import { PARTNER_REFERRAL_REWARD_RUPEES } from "../lib/partner-referral-policy";
import { isBookingTransitionAllowed } from "../middleware/conflict";

const RUN_ID = `mm-${Date.now().toString(36)}`;

const BANK = {
  bankAccountNumber: "123456789012",
  ifscCode: "HDFC0001234",
  accountHolder: "MoneyMatrix",
};

type MatrixReport = {
  PRECONDITION: string;
  ACTION: string;
  EXPECTED: string;
  ACTUAL: string;
  "WALLET EFFECT": string;
  "LEDGER EFFECT": string;
  "JOURNAL EFFECT": string;
  IDEMPOTENCY: string;
  CONCURRENCY: string;
  "FINAL STATE": string;
};

let ctx: AdvCtx;
let dbOk = false;
let otherProviderId = "";
let otherVendorUserId = "";
let referredProviderId = "";
let referredUserId = "";
let payoutSpy: ReturnType<typeof spyOn> | null = null;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable — money matrix not executed");
    return true;
  }
  return false;
}

function reportCase(caseNo: number, title: string, r: MatrixReport) {
  console.log(`\n=== MONEY MATRIX CASE ${caseNo} — ${title} ===`);
  for (const key of Object.keys(r) as (keyof MatrixReport)[]) {
    console.log(`${key}: ${r[key]}`);
  }
}

async function walletSnap(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: { walletBalance: true, reservedBalance: true, walletBalancePaise: true },
  });
  const available = providerWalletReservationService.availableBalance(p.walletBalance, p.reservedBalance);
  return {
    balance: round2(p.walletBalance),
    reserved: round2(p.reservedBalance),
    available: round2(available),
    paise: Number(p.walletBalancePaise ?? 0n),
  };
}

/** OPENING + CREDITS − DEBITS = CLOSING and MONEY DRIFT = 0 */
function assertMoneyInvariant(opts: {
  opening: number;
  credits: number;
  debits: number;
  closing: number;
}) {
  const expected = round2(opts.opening + opts.credits - opts.debits);
  const closing = round2(opts.closing);
  const drift = round2(closing - expected);
  expect(closing).toBe(expected);
  expect(drift).toBe(0);
  return { expected, drift };
}

async function resetProviderWallet(providerId: string, balance: number) {
  await prisma.providerWalletReservation.deleteMany({ where: { providerId } });
  await prisma.payoutAttempt.deleteMany({
    where: { withdrawal: { providerId } },
  });
  await prisma.withdrawal.deleteMany({ where: { providerId } });
  await prisma.provider.update({
    where: { id: providerId },
    data: {
      walletBalance: balance,
      walletBalancePaise: BigInt(Math.round(balance * 100)),
      reservedBalance: 0,
    },
  });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;

  await financialLedgerService.ensureAccountsSeeded();
  ctx = await seedAdversarialFixtures(RUN_ID);
  await resetProviderWallet(ctx.providerId, 1000);

  const passwordHash = ctx.customerA.password;
  const otherVendor = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`adv-${RUN_ID}-other-vendor@adv.test`),
      email: `adv-${RUN_ID}-other-vendor@adv.test`,
      phoneNumber: fixturePhone(RUN_ID, "other-vendor"),
      firstName: "Other",
      lastName: "Vendor",
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  otherVendorUserId = otherVendor.id;
  const otherProvider = await prisma.provider.create({
    data: {
      userId: otherVendor.id,
      serviceCategories: [ctx.serviceId],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      isOnline: true,
      walletBalance: 200,
      walletBalancePaise: 20000n,
      reservedBalance: 0,
    },
  });
  otherProviderId = otherProvider.id;

  const referredUser = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`adv-${RUN_ID}-referred@adv.test`),
      email: `adv-${RUN_ID}-referred@adv.test`,
      phoneNumber: fixturePhone(RUN_ID, "referred"),
      firstName: "Referred",
      lastName: "Partner",
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  referredUserId = referredUser.id;
  const referred = await prisma.provider.create({
    data: {
      userId: referredUser.id,
      serviceCategories: [ctx.serviceId],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      city: "Noida",
    },
  });
  referredProviderId = referred.id;

  payoutSpy = spyOn(razorpayService, "createPayout").mockImplementation(async (ref: string) => ({
    payoutId: `pout_mm_${ref.slice(-12)}`,
    status: "processing",
  }));
}, 120_000);

afterAll(async () => {
  payoutSpy?.mockRestore();
  if (!dbOk) return;

  try {
    const providerIds = [ctx.providerId, otherProviderId, referredProviderId].filter(Boolean);
    await prisma.payoutAttempt.deleteMany({ where: { withdrawal: { providerId: { in: providerIds } } } });
    await prisma.providerWalletReservation.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.withdrawal.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.earning.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.walletTransaction.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.partnerIncentivePayout.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.partnerIncentiveRule.deleteMany({ where: { code: { startsWith: `MM_${RUN_ID}` } } });
    await prisma.partnerReferralReward.deleteMany({
      where: { referrerProviderId: { in: providerIds } },
    });
    await prisma.partnerReferral.deleteMany({
      where: {
        OR: [{ referrerProviderId: { in: providerIds } }, { referredProviderId: { in: providerIds } }],
      },
    });
    await prisma.partnerReferralCode.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.booking.deleteMany({ where: { providerId: { in: providerIds } } });
    if (referredProviderId) await prisma.provider.deleteMany({ where: { id: referredProviderId } });
    if (referredUserId) await prisma.user.deleteMany({ where: { id: referredUserId } });
    if (otherProviderId) await prisma.provider.deleteMany({ where: { id: otherProviderId } });
    if (otherVendorUserId) await prisma.user.deleteMany({ where: { id: otherVendorUserId } });
  } catch (err) {
    console.warn("money-matrix cleanup:", err instanceof Error ? err.message : err);
  }

  await cleanupAdversarialFixtures(RUN_ID);
}, 90_000);

describe.serial("Pass 11 money matrix certification (cases 7, 8, 11–20)", () => {
  test("CASE 7 — duplicate withdrawal (same idempotency key)", async () => {
    if (skipIfNoDb()) return;
    await resetProviderWallet(ctx.providerId, 1000);
    const opening = await walletSnap(ctx.providerId);
    const key = `mm7-${RUN_ID}`;
    const body = { amount: 100, ...BANK, idempotencyKey: key };

    const first = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body);
    const second = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, body);
    const closing = await walletSnap(ctx.providerId);
    const count = await prisma.withdrawal.count({
      where: { providerId: ctx.providerId, idempotencyKey: key },
    });
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 0,
      closing: closing.balance,
    });

    expect("withdrawal" in first).toBe(true);
    expect("withdrawal" in second).toBe(true);
    if ("withdrawal" in first && "withdrawal" in second) {
      expect(second.withdrawal.id).toBe(first.withdrawal.id);
    }
    expect(count).toBe(1);
    expect(closing.reserved).toBe(100);
    expect(closing.available).toBe(900);

    reportCase(7, "duplicate withdrawal", {
      PRECONDITION: `provider wallet=${opening.balance} reserved=0 key=${key}`,
      ACTION: "reserveAndCreateWithdrawal ×2 with identical idempotencyKey",
      EXPECTED: "single withdrawal row; reserved +=100 once; MONEY DRIFT=0",
      ACTUAL: `count=${count} reserved=${closing.reserved} drift=${inv.drift}`,
      "WALLET EFFECT": `balance ${opening.balance}→${closing.balance}; reserved ${opening.reserved}→${closing.reserved}`,
      "LEDGER EFFECT": "none (reservation only)",
      "JOURNAL EFFECT": "none",
      IDEMPOTENCY: "PASS — same withdrawal id returned",
      CONCURRENCY: "n/a (serial duplicate)",
      "FINAL STATE": `OPENING+CREDITS-DEBITS=${inv.expected}; MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 8 — concurrent withdrawal (race serializes to one winner)", async () => {
    if (skipIfNoDb()) return;
    await resetProviderWallet(ctx.providerId, 500);
    const opening = await walletSnap(ctx.providerId);

    const results = await Promise.all([
      providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
        amount: 400,
        ...BANK,
        idempotencyKey: `mm8a-${RUN_ID}`,
      }),
      providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
        amount: 400,
        ...BANK,
        idempotencyKey: `mm8b-${RUN_ID}`,
      }),
    ]);

    const wins = results.filter((r) => "withdrawal" in r);
    const fails = results.filter((r) => "error" in r);
    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 0,
      closing: closing.balance,
    });

    expect(wins.length).toBe(1);
    expect(fails.length).toBe(1);
    expect(closing.reserved).toBe(400);
    expect(closing.available).toBe(100);
    expect(closing.available).toBeGreaterThanOrEqual(0);

    reportCase(8, "concurrent withdrawal", {
      PRECONDITION: `wallet=${opening.balance} available=${opening.available}; two 400 withdraws`,
      ACTION: "Promise.all reserveAndCreateWithdrawal(400) ×2",
      EXPECTED: "exactly 1 success, 1 INSUFFICIENT_BALANCE; reserved=400; drift=0",
      ACTUAL: `wins=${wins.length} fails=${fails.length} reserved=${closing.reserved}`,
      "WALLET EFFECT": `balance unchanged ${closing.balance}; reserved=${closing.reserved}`,
      "LEDGER EFFECT": "none",
      "JOURNAL EFFECT": "none",
      IDEMPOTENCY: "distinct keys — concurrency control only",
      CONCURRENCY: "PASS — FOR UPDATE serializes",
      "FINAL STATE": `available=${closing.available}; MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 11 — retry (idempotent retry of withdrawal + payout complete)", async () => {
    if (skipIfNoDb()) return;
    await resetProviderWallet(ctx.providerId, 800);
    const opening = await walletSnap(ctx.providerId);
    const key = `mm11-${RUN_ID}`;

    const r1 = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 150,
      ...BANK,
      idempotencyKey: key,
    });
    expect("withdrawal" in r1).toBe(true);
    if (!("withdrawal" in r1)) return;

    // Client retry of the same request
    const r2 = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 150,
      ...BANK,
      idempotencyKey: key,
    });
    expect("withdrawal" in r2).toBe(true);
    if ("withdrawal" in r2) expect(r2.withdrawal.id).toBe(r1.withdrawal.id);

    await earningsService.approveWithdrawal(r1.withdrawal.id, ctx.financeAdmin.id);
    const p1 = await earningsService.processProviderPayout(r1.withdrawal.id, ctx.financeAdmin.id);
    const p2 = await earningsService.processProviderPayout(r1.withdrawal.id, ctx.financeAdmin.id);
    expect(p1.blocked ?? false).toBe(false);
    expect(p2.blocked).toBe(true);

    const c1 = await earningsService.completeProviderPayout(r1.withdrawal.id);
    const c2 = await earningsService.completeProviderPayout(r1.withdrawal.id);
    expect(c1.status).toBe(WithdrawalStatus.COMPLETED);
    expect(c2.status).toBe(WithdrawalStatus.COMPLETED);

    const journals = await prisma.journalEntry.count({
      where: { idempotencyKey: `provider_payout:${r1.withdrawal.id}` },
    });
    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 150,
      closing: closing.balance,
    });

    expect(journals).toBe(1);
    expect(closing.reserved).toBe(0);

    reportCase(11, "retry", {
      PRECONDITION: `wallet=${opening.balance}; withdrawal key=${key}`,
      ACTION: "retry reserve → approve → process×2 → complete×2",
      EXPECTED: "one payout journal; wallet −150 once; second process blocked",
      ACTUAL: `journals=${journals} blocked_retry=${p2.blocked} balance=${closing.balance}`,
      "WALLET EFFECT": `${opening.balance}→${closing.balance} (debit 150)`,
      "LEDGER EFFECT": "provider_payout journal once",
      "JOURNAL EFFECT": `count=${journals}`,
      IDEMPOTENCY: "PASS — key + COMPLETED short-circuit",
      CONCURRENCY: "n/a",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 12 — stale balance (post-reservation withdraw using stale available)", async () => {
    if (skipIfNoDb()) return;
    await resetProviderWallet(ctx.providerId, 600);
    const opening = await walletSnap(ctx.providerId);

    // First reservation consumes most available
    const first = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 500,
      ...BANK,
      idempotencyKey: `mm12-first-${RUN_ID}`,
    });
    expect("withdrawal" in first).toBe(true);

    // Stale client still believes available ≈ 600
    const staleAttempt = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 200,
      ...BANK,
      idempotencyKey: `mm12-stale-${RUN_ID}`,
    });
    expect("error" in staleAttempt).toBe(true);
    if ("error" in staleAttempt) expect(staleAttempt.error).toBe("INSUFFICIENT_BALANCE");

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 0,
      closing: closing.balance,
    });
    expect(closing.reserved).toBe(500);
    expect(closing.available).toBe(100);

    reportCase(12, "stale balance", {
      PRECONDITION: `wallet=${opening.balance}; after reserve available=100; client assumes 600`,
      ACTION: "withdraw 200 against stale available view",
      EXPECTED: "INSUFFICIENT_BALANCE; reserved stays 500; drift=0",
      ACTUAL: `error=${"error" in staleAttempt ? staleAttempt.error : "none"} reserved=${closing.reserved}`,
      "WALLET EFFECT": `balance ${closing.balance}; reserved ${closing.reserved}`,
      "LEDGER EFFECT": "none",
      "JOURNAL EFFECT": "none",
      IDEMPOTENCY: "new key rejected on balance — no row",
      CONCURRENCY: "serial stale-read simulation",
      "FINAL STATE": `available=${closing.available}; MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 13 — duplicate completion (booking.complete twice → one earning)", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `MM13-${RUN_ID}`,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 30 * 60_000),
        scheduledDate: new Date(),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.SUCCESS,
        paymentMethod: "razorpay",
      },
    });

    const a = await bookingService.complete(ctx.providerId, booking.id, 28.62, 77.37, "mm13", {
      skipSideEffects: true,
    });
    const b = await bookingService.complete(ctx.providerId, booking.id, 28.62, 77.37, "mm13-retry", {
      skipSideEffects: true,
    });

    expect(a.newlyCompleted).toBe(true);
    expect(b.newlyCompleted).toBe(false);

    const earnings = await prisma.earning.findMany({ where: { bookingId: booking.id } });
    expect(earnings.length).toBe(1);

    const journals = await prisma.journalEntry.count({
      where: { idempotencyKey: `provider_earning:${booking.id}` },
    });
    expect(journals).toBe(1);

    const closing = await walletSnap(ctx.providerId);
    const credit = round2(earnings[0]!.netEarning);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: credit,
      debits: 0,
      closing: closing.balance,
    });

    reportCase(13, "duplicate completion", {
      PRECONDITION: `IN_PROGRESS booking ${booking.id}; wallet=${opening.balance}`,
      ACTION: "bookingService.complete ×2",
      EXPECTED: "first newlyCompleted; second replay; 1 earning + 1 journal; drift=0",
      ACTUAL: `newly=[${a.newlyCompleted},${b.newlyCompleted}] earnings=${earnings.length} journals=${journals}`,
      "WALLET EFFECT": `${opening.balance}→${closing.balance} (+${credit})`,
      "LEDGER EFFECT": "provider_earning posted once",
      "JOURNAL EFFECT": `count=${journals}`,
      IDEMPOTENCY: "PASS — COMPLETED short-circuit + earning unique(bookingId)",
      CONCURRENCY: "n/a (serial duplicate)",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 14 — duplicate payout (process+complete races)", async () => {
    if (skipIfNoDb()) return;
    await resetProviderWallet(ctx.providerId, 900);
    const opening = await walletSnap(ctx.providerId);

    const created = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 120,
      ...BANK,
      idempotencyKey: `mm14-${RUN_ID}`,
    });
    expect("withdrawal" in created).toBe(true);
    if (!("withdrawal" in created)) return;

    await earningsService.approveWithdrawal(created.withdrawal.id, ctx.financeAdmin.id);

    const [pA, pB] = await Promise.all([
      earningsService.processProviderPayout(created.withdrawal.id, ctx.financeAdmin.id),
      earningsService.processProviderPayout(created.withdrawal.id, ctx.financeAdmin.id),
    ]);
    const processWinners = [pA, pB].filter((p) => !p.blocked).length;
    expect(processWinners).toBe(1);

    const [cA, cB] = await Promise.all([
      earningsService.completeProviderPayout(created.withdrawal.id),
      earningsService.completeProviderPayout(created.withdrawal.id),
    ]);
    expect(cA.status).toBe(WithdrawalStatus.COMPLETED);
    expect(cB.status).toBe(WithdrawalStatus.COMPLETED);

    const journals = await prisma.journalEntry.count({
      where: { idempotencyKey: `provider_payout:${created.withdrawal.id}` },
    });
    expect(journals).toBe(1);

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 120,
      closing: closing.balance,
    });

    reportCase(14, "duplicate payout", {
      PRECONDITION: `APPROVED withdrawal ${created.withdrawal.id}; wallet=${opening.balance}`,
      ACTION: "concurrent processProviderPayout ×2 then complete ×2",
      EXPECTED: "1 process winner; 1 payout journal; wallet −120 once",
      ACTUAL: `processWinners=${processWinners} journals=${journals} balance=${closing.balance}`,
      "WALLET EFFECT": `${opening.balance}→${closing.balance}`,
      "LEDGER EFFECT": "provider_payout once",
      "JOURNAL EFFECT": `count=${journals}`,
      IDEMPOTENCY: "PASS — FOR UPDATE + journal key",
      CONCURRENCY: "PASS — only one gateway/process winner",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 15 — duplicate incentive", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);

    const rule = await prisma.partnerIncentiveRule.create({
      data: {
        code: `MM_${RUN_ID}_INC`,
        name: "MM Incentive",
        period: "DAILY",
        metric: "completed_jobs",
        threshold: 1,
        bonusAmount: 175,
        isActive: true,
      },
    });

    await prisma.booking.create({
      data: {
        bookingNumber: `MM15-${RUN_ID}`,
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
        paymentStatus: PaymentStatus.SUCCESS,
        paymentMethod: "razorpay",
      },
    });

    const periodKey = incentivePeriodKey("DAILY");
    const ruleRef = {
      id: rule.id,
      code: rule.code,
      name: rule.name,
      bonusAmount: rule.bonusAmount,
      period: rule.period,
    };

    const first = await partnerIncentivePayoutService.creditQualifiedRule(
      ctx.providerId,
      ruleRef,
      periodKey,
      1,
    );
    const second = await partnerIncentivePayoutService.creditQualifiedRule(
      ctx.providerId,
      ruleRef,
      periodKey,
      1,
    );
    const parallel = await Promise.all([
      partnerIncentivePayoutService.creditQualifiedRule(ctx.providerId, ruleRef, periodKey, 1),
      partnerIncentivePayoutService.creditQualifiedRule(ctx.providerId, ruleRef, periodKey, 1),
      partnerIncentivePayoutService.creditQualifiedRule(ctx.providerId, ruleRef, periodKey, 1),
    ]);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(parallel.every((r) => r.created === false)).toBe(true);

    const payouts = await prisma.partnerIncentivePayout.findMany({
      where: { providerId: ctx.providerId, ruleId: rule.id },
    });
    expect(payouts.length).toBe(1);

    /**
     * Period keys moved from the UTC date to the business day (Asia/Kolkata). Inside the 5.5 h where
     * the two disagree, the SAME bonus must not be credited a second time under the new key — the
     * credit path reads the legacy key too. Proven here with an instant in that window.
     */
    const inWindow = new Date("2026-09-12T20:00:00.000Z"); // 01:30 IST on the 13th — a past day, so these keys are unique to this check
    const businessKey = incentivePeriodKey("DAILY", inWindow);
    const legacyKey = legacyUtcPeriodKey("DAILY", inWindow);
    expect(businessKey).not.toBe(legacyKey);
    await prisma.partnerIncentivePayout.create({
      // Dated BEFORE the cutover: only such a row carries a legacy-scheme key.
      data: {
        providerId: ctx.providerId, ruleId: rule.id, amount: rule.bonusAmount, periodKey: legacyKey,
        status: "CREDITED", createdAt: new Date(LEGACY_PERIOD_KEY_CUTOVER.getTime() - 86_400_000),
      },
    });
    const walletBeforeLegacy = await walletSnap(ctx.providerId);
    const afterKeyChange = await partnerIncentivePayoutService.creditQualifiedRule(ctx.providerId, ruleRef, businessKey, 1, inWindow);
    expect(afterKeyChange.created).toBe(false);
    expect((await walletSnap(ctx.providerId)).balance).toBe(walletBeforeLegacy.balance);
    expect(
      await prisma.partnerIncentivePayout.count({ where: { providerId: ctx.providerId, ruleId: rule.id, periodKey: businessKey } }),
    ).toBe(0);
    await prisma.partnerIncentivePayout.deleteMany({ where: { providerId: ctx.providerId, ruleId: rule.id, periodKey: legacyKey } });

    /**
     * …and the guard must not block a LEGITIMATE payout. One business day's key equals the NEXT
     * day's legacy key, so a payout written after the cutover under that key is an ordinary payout,
     * not a legacy-scheme row, and must not suppress the following day's credit.
     *
     * Written twice before this held. The first version read `new Date()`, which made it run only
     * between 18:30 and 24:00 UTC — it first executed on 2026-09-21 and failed, because it asked to
     * credit TODAY's business key, which this case had already credited at the top. It also deleted
     * its payout rows while their journal entries stayed behind. The fixed instant below runs in
     * every timezone at every hour, and the credit it performs is real money, so it is counted in
     * the invariant at the end of the case rather than deleted.
     */
    const priorDayKey = legacyUtcPeriodKey("DAILY", inWindow); // the business day before `inWindow`
    const postCutoverRow = await prisma.partnerIncentivePayout.create({
      data: { providerId: ctx.providerId, ruleId: rule.id, amount: rule.bonusAmount, periodKey: priorDayKey, status: "CREDITED" },
    });
    expect(postCutoverRow.createdAt.getTime()).toBeGreaterThan(LEGACY_PERIOD_KEY_CUTOVER.getTime());
    const nextDayCredit = await partnerIncentivePayoutService.creditQualifiedRule(
      ctx.providerId, ruleRef, businessKey, 1, inWindow,
    );
    expect(nextDayCredit.created).toBe(true); // a post-cutover row under the previous day's key blocks nothing

    const journals = await prisma.journalEntry.count({
      where: {
        type: JournalEntryType.PARTNER_INCENTIVE,
        referenceId: payouts[0]!.id,
      },
    });
    expect(journals).toBe(1);

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      // The daily bonus once, plus the cutover-bound credit proven legitimate above.
      credits: 350,
      debits: 0,
      closing: closing.balance,
    });

    reportCase(15, "duplicate incentive", {
      PRECONDITION: `rule ${rule.code}; periodKey=${periodKey}; wallet=${opening.balance}`,
      ACTION: "creditQualifiedRule ×2 + concurrent credit/evaluate duplicates",
      EXPECTED: "1 payout CREDITED per period; 1 journal; +175 once; drift=0",
      ACTUAL: `payouts=${payouts.length} journals=${journals} first.created=${first.created} nextDay.created=${nextDayCredit.created}`,
      "WALLET EFFECT": `${opening.balance}→${closing.balance}`,
      "LEDGER EFFECT": "PARTNER_INCENTIVE once per period (today + the cutover-bound day)",
      "JOURNAL EFFECT": `count=${journals}`,
      IDEMPOTENCY: "PASS — period/rule unique payout",
      CONCURRENCY: "PASS — concurrent credit still 1 row",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 16 — duplicate referral reward", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);

    const code = await partnerReferralService.ensureCode(ctx.providerId);
    const referral = await prisma.partnerReferral.create({
      data: {
        referrerProviderId: ctx.providerId,
        referredProviderId,
        referralCode: code.code,
        status: "REGISTERED",
        registeredAt: new Date(),
      },
    });

    await partnerReferralService.syncFromCanonical(referredProviderId);
    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: {
          bookingNumber: `MM16-${RUN_ID}-${i}`,
          userId: ctx.customerA.id,
          providerId: referredProviderId,
          serviceId: ctx.serviceId,
          addressId: ctx.addressAId,
          status: BookingStatus.COMPLETED,
          completedAt: new Date(),
          scheduledDate: new Date(),
          baseAmount: 500,
          finalAmount: 500,
          totalAmount: 500,
          paymentStatus: PaymentStatus.SUCCESS,
        },
      });
      await partnerReferralService.onJobCompleted(referredProviderId, `MM16-${RUN_ID}-${i}`);
    }

    const current = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referral.id } });
    expect(["QUALIFIED", "REWARD_RELEASED"]).toContain(current.status);

    const [a, b, c] = await Promise.all([
      partnerReferralService.creditReward(referral.id, { actorId: "system", reason: "mm16-a" }),
      partnerReferralService.creditReward(referral.id, { actorId: "system", reason: "mm16-b" }),
      partnerReferralService.creditReward(referral.id, { actorId: "system", reason: "mm16-c" }),
    ]);
    const created = [a, b, c].filter((r) => r.created).length;
    expect(created).toBeLessThanOrEqual(1);

    const retry = await partnerReferralService.creditReward(referral.id, {
      actorId: "system",
      reason: "mm16-retry",
    });
    expect(retry.created).toBe(false);

    const rewards = await prisma.partnerReferralReward.findMany({ where: { referralId: referral.id } });
    expect(rewards.length).toBe(1);
    expect(rewards[0]!.amount).toBe(PARTNER_REFERRAL_REWARD_RUPEES);

    const journals = await prisma.journalEntry.count({
      where: {
        type: JournalEntryType.PARTNER_REFERRAL_REWARD,
        referenceId: rewards[0]!.id,
      },
    });
    expect(journals).toBe(1);

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: PARTNER_REFERRAL_REWARD_RUPEES,
      debits: 0,
      closing: closing.balance,
    });

    reportCase(16, "duplicate referral reward", {
      PRECONDITION: `referral ${referral.id} qualified; wallet=${opening.balance}`,
      ACTION: "concurrent creditReward ×3 + serial retry",
      EXPECTED: "≤1 created; 1 reward; 1 journal; +500 once",
      ACTUAL: `created=${created} rewards=${rewards.length} journals=${journals}`,
      "WALLET EFFECT": `${opening.balance}→${closing.balance}`,
      "LEDGER EFFECT": "PARTNER_REFERRAL_REWARD once",
      "JOURNAL EFFECT": `count=${journals}`,
      IDEMPOTENCY: "PASS — referralId unique reward",
      CONCURRENCY: "PASS",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 17 — replay (journal + withdrawal event replay)", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);
    const paymentId = `mm17-pay-${RUN_ID}`;
    const amount = 250;

    const j1 = await financialLedgerService.recordBookingPayment(paymentId, amount);
    const j2 = await financialLedgerService.recordBookingPayment(paymentId, amount);
    expect(j1.id).toBe(j2.id);

    const journalCount = await prisma.journalEntry.count({
      where: { idempotencyKey: `booking_payment:${paymentId}` },
    });
    expect(journalCount).toBe(1);

    const key = `mm17-wd-${RUN_ID}`;
    await resetProviderWallet(ctx.providerId, opening.balance);
    const snap = await walletSnap(ctx.providerId);
    const w1 = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 80,
      ...BANK,
      idempotencyKey: key,
    });
    // Simulated network replay of the same withdrawal request
    const w2 = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 80,
      ...BANK,
      idempotencyKey: key,
    });
    expect("withdrawal" in w1 && "withdrawal" in w2).toBe(true);
    if ("withdrawal" in w1 && "withdrawal" in w2) {
      expect(w1.withdrawal.id).toBe(w2.withdrawal.id);
    }

    const after = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: snap.balance,
      credits: 0,
      debits: 0,
      closing: after.balance,
    });
    expect(after.reserved).toBe(80);

    reportCase(17, "replay", {
      PRECONDITION: `paymentId=${paymentId}; withdrawal key=${key}`,
      ACTION: "recordBookingPayment ×2; reserveAndCreateWithdrawal replay ×2",
      EXPECTED: "same journal id; same withdrawal id; reserved once; drift=0",
      ACTUAL: `journalCount=${journalCount} reserved=${after.reserved}`,
      "WALLET EFFECT": `balance unchanged ${after.balance}; reserved=${after.reserved}`,
      "LEDGER EFFECT": "booking_payment journal idempotent",
      "JOURNAL EFFECT": `single entry ${j1.id}`,
      IDEMPOTENCY: "PASS — replay returns existing",
      CONCURRENCY: "n/a",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 18 — duplicate journal (idempotency key collision)", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);
    const withdrawalId = `mm18-wd-${RUN_ID}`;
    const amount = 333;

    const input = financialLedgerService.journalForProviderPayout(withdrawalId, amount);
    const a = await financialLedgerService.recordJournal(input);
    const b = await financialLedgerService.recordJournal(input);
    const c = await financialLedgerService.recordJournal(input);

    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);

    const count = await prisma.journalEntry.count({
      where: { idempotencyKey: input.idempotencyKey },
    });
    expect(count).toBe(1);

    const lines = await prisma.ledgerEntry.findMany({ where: { journalId: a.id } });
    const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debits).toBe(credits);
    expect(debits).toBe(amount);

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 0,
      closing: closing.balance,
    });

    reportCase(18, "duplicate journal", {
      PRECONDITION: `idempotencyKey=${input.idempotencyKey}`,
      ACTION: "recordJournal ×3 with identical payout journal input",
      EXPECTED: "1 journal row; balanced lines; wallet untouched; drift=0",
      ACTUAL: `count=${count} journalId=${a.id} debit=${debits} credit=${credits}`,
      "WALLET EFFECT": "none",
      "LEDGER EFFECT": "single balanced provider_payout journal",
      "JOURNAL EFFECT": `count=${count}`,
      IDEMPOTENCY: "PASS",
      CONCURRENCY: "n/a",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });

  test("CASE 19 — ownership tampering (wrong provider / stolen idempotency)", async () => {
    if (skipIfNoDb()) return;
    const openingOwner = await walletSnap(ctx.providerId);
    const openingOther = await walletSnap(otherProviderId);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `MM19-${RUN_ID}`,
        userId: ctx.customerA.id,
        providerId: ctx.providerId,
        serviceId: ctx.serviceId,
        addressId: ctx.addressAId,
        status: BookingStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 20 * 60_000),
        scheduledDate: new Date(),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
        paymentStatus: PaymentStatus.SUCCESS,
        paymentMethod: "razorpay",
      },
    });

    let completeError = "";
    try {
      await bookingService.complete(otherProviderId, booking.id, 28.62, 77.37, "tamper", {
        skipSideEffects: true,
      });
    } catch (err) {
      completeError = err instanceof Error ? err.message : String(err);
    }
    expect(completeError).toBe("FORBIDDEN");

    const ownerKey = `mm19-owner-${RUN_ID}`;
    const ownerWd = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 50,
      ...BANK,
      idempotencyKey: ownerKey,
    });
    expect("withdrawal" in ownerWd).toBe(true);

    // Other provider tries to reuse / steal the owner's idempotency key (walletId tamper class)
    const stolen = await providerWalletReservationService.reserveAndCreateWithdrawal(otherProviderId, {
      amount: 50,
      ...BANK,
      idempotencyKey: ownerKey,
    });
    expect("error" in stolen).toBe(true);
    if ("error" in stolen) {
      expect(["INSUFFICIENT_BALANCE", "PROVIDER_NOT_FOUND", "INVALID_AMOUNT"]).toContain(stolen.error);
    }
    const otherWdCount = await prisma.withdrawal.count({
      where: { providerId: otherProviderId, idempotencyKey: ownerKey },
    });
    expect(otherWdCount).toBe(0);

    const earnings = await prisma.earning.count({ where: { bookingId: booking.id } });
    expect(earnings).toBe(0);

    const closingOwner = await walletSnap(ctx.providerId);
    const closingOther = await walletSnap(otherProviderId);
    assertMoneyInvariant({
      opening: openingOwner.balance,
      credits: 0,
      debits: 0,
      closing: closingOwner.balance,
    });
    assertMoneyInvariant({
      opening: openingOther.balance,
      credits: 0,
      debits: 0,
      closing: closingOther.balance,
    });

    reportCase(19, "ownership tampering", {
      PRECONDITION: `booking owned by ${ctx.providerId}; attacker ${otherProviderId}`,
      ACTION: "complete as wrong provider; reuse foreign idempotencyKey on withdraw",
      EXPECTED: "FORBIDDEN on complete; no earning; no cross-provider wallet debit",
      ACTUAL: `completeError=${completeError} earnings=${earnings} stolen=${"error" in stolen ? stolen.error : "withdrawal"}`,
      "WALLET EFFECT": `owner ${openingOwner.balance}→${closingOwner.balance}; other ${openingOther.balance}→${closingOther.balance}`,
      "LEDGER EFFECT": "none for tampered complete",
      "JOURNAL EFFECT": "none",
      IDEMPOTENCY: "foreign key not returned as success to attacker",
      CONCURRENCY: "n/a",
      "FINAL STATE": "MONEY DRIFT=0 on both wallets; ownership intact",
    });
  });

  test("CASE 20 — invalid financial transition", async () => {
    if (skipIfNoDb()) return;
    const opening = await walletSnap(ctx.providerId);

    expect(isBookingTransitionAllowed(BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS)).toBe(false);
    expect(isBookingTransitionAllowed(BookingStatus.PENDING, BookingStatus.COMPLETED)).toBe(false);
    expect(() => assertReferralTransition("ACTIVE", "QUALIFIED")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertReferralTransition("REWARD_RELEASED", "QUALIFIED")).toThrow(/INVALID_TRANSITION/);

    const zero = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 0,
      ...BANK,
      idempotencyKey: `mm20-zero-${RUN_ID}`,
    });
    expect("error" in zero).toBe(true);
    if ("error" in zero) expect(zero.error).toBe("INVALID_AMOUNT");

    const over = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 999_999,
      ...BANK,
      idempotencyKey: `mm20-over-${RUN_ID}`,
    });
    expect("error" in over).toBe(true);

    const created = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
      amount: 40,
      ...BANK,
      idempotencyKey: `mm20-ok-${RUN_ID}`,
    });
    expect("withdrawal" in created).toBe(true);
    if (!("withdrawal" in created)) return;

    let processErr = "";
    try {
      // REQUESTED → PROCESSING is invalid; must be APPROVED first
      await earningsService.processProviderPayout(created.withdrawal.id, ctx.financeAdmin.id);
    } catch (err) {
      processErr = err instanceof Error ? err.message : String(err);
    }
    expect(processErr).toMatch(/cannot be processed|status/i);

    const status = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: created.withdrawal.id },
      select: { status: true },
    });
    expect(status.status).toBe(WithdrawalStatus.REQUESTED);

    const closing = await walletSnap(ctx.providerId);
    const inv = assertMoneyInvariant({
      opening: opening.balance,
      credits: 0,
      debits: 0,
      closing: closing.balance,
    });

    reportCase(20, "invalid financial transition", {
      PRECONDITION: `wallet=${opening.balance}; REQUESTED withdrawal ${created.withdrawal.id}`,
      ACTION: "illegal booking/referral hops; zero/over amount; process while REQUESTED",
      EXPECTED: "all rejected; withdrawal stays REQUESTED; drift=0",
      ACTUAL: `processErr=${processErr}; status=${status.status}`,
      "WALLET EFFECT": `balance ${closing.balance}; reserved=${closing.reserved}`,
      "LEDGER EFFECT": "none",
      "JOURNAL EFFECT": "none",
      IDEMPOTENCY: "n/a",
      CONCURRENCY: "n/a",
      "FINAL STATE": `MONEY DRIFT=${inv.drift}`,
    });
  });
});
