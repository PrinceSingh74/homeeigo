/**
 * Section 07 — partner referral invite → qualify → one reward → ledger.
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { BookingStatus, JournalEntryType, PaymentStatus, UserRole } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  fixturePhone,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerReferralService } from "../services/partner-referral.service";
import { partnerReferralAbuseService } from "../services/partner-referral-abuse.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { PARTNER_REFERRAL_REWARD_RUPEES } from "../lib/partner-referral-policy";
import { assertReferralTransition } from "../lib/partner-referral-fsm";

const RUN_ID = `s07-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let referredProviderId = "";
let referredUserId = "";
let referralId = "";

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  await financialLedgerService.ensureAccountsSeeded();
  ctx = await seedAdversarialFixtures(RUN_ID);

  const referredUser = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`s07-ref-${RUN_ID}@adv.test`),
      email: `s07-ref-${RUN_ID}@adv.test`,
      phoneNumber: fixturePhone(RUN_ID, "referred"),
      firstName: "Referred",
      lastName: "Partner",
      password: ctx.customerA.password,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  referredUserId = referredUser.id;
  const referred = await prisma.provider.create({
    data: {
      userId: referredUser.id,
      serviceCategories: ["cleaning"],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      lifecycleState: "ACTIVE",
      isActive: true,
      city: "Noida",
    },
  });
  referredProviderId = referred.id;
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  try {
    if (referredProviderId) {
      await prisma.booking.deleteMany({ where: { providerId: referredProviderId } });
    }
    await prisma.partnerReferralReward.deleteMany({
      where: { OR: [{ referrerProviderId: ctx.providerId }, { referrerProviderId: referredProviderId }] },
    });
    await prisma.partnerReferral.deleteMany({
      where: { OR: [{ referrerProviderId: ctx.providerId }, { referredProviderId }] },
    });
    await prisma.partnerReferralCode.deleteMany({
      where: { providerId: { in: [ctx.providerId, referredProviderId].filter(Boolean) } },
    });
    await prisma.partnerLead.deleteMany({
      where: { phone: { contains: fixturePhone(RUN_ID, "invitee").slice(-10) } },
    });
    if (referredUserId) {
      await prisma.provider.deleteMany({ where: { id: referredProviderId } });
      await prisma.user.deleteMany({ where: { id: referredUserId } });
    }
  } catch (err) {
    console.warn("section07 cleanup:", err instanceof Error ? err.message : err);
  }
  await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

describe.serial("Section 07 partner referral engine", () => {
  test("invalid QUALIFIED skip is rejected", () => {
    expect(() => assertReferralTransition("ACTIVE", "QUALIFIED")).toThrow(/INVALID_TRANSITION/);
  });

  test("invite creates lead + INVITED referral with a hard-to-guess code", async () => {
    if (skipIfNoDb()) return;
    const invited = await partnerReferralService.invite({
      referrerProviderId: ctx.providerId,
      name: "Invited Partner",
      phone: fixturePhone(RUN_ID, "invitee"),
      city: "Noida",
    });
    expect(invited.status).toBe("INVITED");
    expect(invited.code.startsWith("HP")).toBe(true);
    expect(invited.shareUrl).toContain("/register?ref=");
    referralId = invited.referralId;
  });

  test("self-referral by same phone is rejected", async () => {
    if (skipIfNoDb()) return;
    await expect(
      partnerReferralService.invite({
        referrerProviderId: ctx.providerId,
        name: "Self",
        phone: fixturePhone(RUN_ID, "vendor"),
      }),
    ).rejects.toThrow(/yourself|DUPLICATE|CONFLICT/i);
  });

  test("bind + canonical sync + 3 successful jobs qualifies once and credits wallet/ledger once", async () => {
    if (skipIfNoDb()) return;

    const code = await partnerReferralService.ensureCode(ctx.providerId);
    const row = await prisma.partnerReferral.create({
      data: {
        referrerProviderId: ctx.providerId,
        referredProviderId,
        referralCode: code.code,
        status: "REGISTERED",
        registeredAt: new Date(),
      },
    });
    referralId = row.id;

    await partnerReferralService.syncFromCanonical(referredProviderId);
    let current = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
    expect(["ACTIVE", "FIRST_JOB", "TRAINING", "VERIFIED"]).toContain(current.status);

    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: {
          bookingNumber: `S07-${RUN_ID}-${i}`,
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
      await partnerReferralService.onJobCompleted(referredProviderId, `S07-${RUN_ID}-${i}`);
    }

    current = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
    expect(current.successfulJobs).toBe(3);
    expect(["QUALIFIED", "REWARD_RELEASED"]).toContain(current.status);

    const [a, b] = await Promise.all([
      partnerReferralService.creditReward(referralId, { actorId: "system", reason: "concurrent-a" }),
      partnerReferralService.creditReward(referralId, { actorId: "system", reason: "concurrent-b" }),
    ]);
    const created = [a, b].filter((r) => r.created).length;
    expect(created).toBeLessThanOrEqual(1);

    const rewards = await prisma.partnerReferralReward.findMany({ where: { referralId } });
    expect(rewards.length).toBe(1);
    expect(rewards[0]!.status).toBe("CREDITED");
    expect(rewards[0]!.amount).toBe(PARTNER_REFERRAL_REWARD_RUPEES);

    const journals = await prisma.journalEntry.findMany({
      where: { type: JournalEntryType.PARTNER_REFERRAL_REWARD, referenceId: rewards[0]!.id },
    });
    expect(journals.length).toBe(1);

    const third = await partnerReferralService.creditReward(referralId, { actorId: "system", reason: "retry" });
    expect(third.created).toBe(false);

    const final = await prisma.partnerReferral.findUniqueOrThrow({ where: { id: referralId } });
    expect(final.status).toBe("REWARD_RELEASED");
  });

  test("duplicate bank is refused at persistence; weak IP is signal-only", async () => {
    if (skipIfNoDb()) return;
    const hash = `s07-bank-${RUN_ID}`;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { bankAccountNumberHash: hash },
    });

    /**
     * CASE A — one bank account belongs to one partner.
     *
     * `bankAccountNumberHash` is `@unique`. A second provider cannot hold the same hash, so
     * `inspectPair` never sees two live rows to flag as BANK_REUSE through the product path.
     * Duplicate payout accounts are rejected here, at persistence, not reviewed after the fact.
     */
    let duplicateError: { code?: string } | null = null;
    try {
      await prisma.provider.update({
        where: { id: referredProviderId },
        data: { bankAccountNumberHash: hash },
      });
    } catch (err) {
      duplicateError = err as { code?: string };
    }
    expect(duplicateError).not.toBeNull();
    expect(duplicateError?.code).toBe("P2002");

    const findings = await partnerReferralAbuseService.inspectPair({
      referrerProviderId: ctx.providerId,
      refereeProviderId: referredProviderId,
    });
    expect(findings.some((f) => f.kind === "BANK_REUSE")).toBe(false);

    const held = partnerReferralAbuseService.decision([
      { kind: "BANK_REUSE", severity: 85, evidenceKey: "b", note: "bank", strong: true },
    ]);
    expect(held.blockReward).toBe(true);

    const weak = partnerReferralAbuseService.decision([
      { kind: "SUSPICIOUS_IP", severity: 40, evidenceKey: "ip", note: "household", strong: false },
    ]);
    expect(weak.review).toBe("NONE");
    expect(weak.blockReward).toBe(false);
  });
});
