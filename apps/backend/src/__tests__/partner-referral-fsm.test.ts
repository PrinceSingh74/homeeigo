import { describe, expect, test } from "bun:test";
import {
  assertReferralTransition,
  canTransitionReferral,
  getAllowedReferralTransitions,
  nextReferralHop,
} from "../lib/partner-referral-fsm";
import {
  evaluateQualificationGates,
  PARTNER_REFERRAL_REWARD_RUPEES,
  QUALIFYING_JOB_TARGET,
} from "../lib/partner-referral-policy";
import { generatePartnerReferralCode, isPartnerReferralCodeShape } from "../lib/partner-referral-code";
import { JournalEntryType } from "@prisma/client";
import { financialLedgerService } from "../services/financial-ledger.service";
import { partnerReferralAbuseService } from "../services/partner-referral-abuse.service";

describe("Section 07 partner referral FSM", () => {
  test("happy path Invited → … → Reward released", () => {
    const path = [
      ["INVITED", "REGISTERED"],
      ["REGISTERED", "VERIFIED"],
      ["VERIFIED", "TRAINING"],
      ["TRAINING", "ACTIVE"],
      ["ACTIVE", "FIRST_JOB"],
      ["FIRST_JOB", "QUALIFIED"],
      ["QUALIFIED", "REWARD_RELEASED"],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransitionReferral(from, to)).toBe(true);
    }
  });

  test("frontend-set QUALIFIED from ACTIVE is illegal", () => {
    expect(canTransitionReferral("ACTIVE", "QUALIFIED")).toBe(false);
    expect(() => assertReferralTransition("INVITED", "QUALIFIED")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertReferralTransition("FIRST_JOB", "REWARD_RELEASED")).toThrow(/INVALID_TRANSITION/);
  });

  test("REWARD_RELEASED is terminal", () => {
    expect(getAllowedReferralTransitions("REWARD_RELEASED")).toEqual([]);
    expect(nextReferralHop("QUALIFIED")).toBe("REWARD_RELEASED");
  });
});

describe("Section 07 qualification policy", () => {
  test("all gates required", () => {
    const fail = evaluateQualificationGates({
      referredLifecycleActive: true,
      successfulJobs: 2,
      hasMajorComplaint: false,
      hasAuthoritativeFraudFlag: false,
      reviewBlocked: false,
      selfReferral: false,
    });
    expect(fail.eligible).toBe(false);
    expect(fail.jobs).toBe(2);
    expect(QUALIFYING_JOB_TARGET).toBe(3);

    const pass = evaluateQualificationGates({
      referredLifecycleActive: true,
      successfulJobs: 3,
      hasMajorComplaint: false,
      hasAuthoritativeFraudFlag: false,
      reviewBlocked: false,
      selfReferral: false,
    });
    expect(pass.eligible).toBe(true);
  });

  test("major complaint or fraud flag or self-referral blocks", () => {
    expect(
      evaluateQualificationGates({
        referredLifecycleActive: true,
        successfulJobs: 3,
        hasMajorComplaint: true,
        hasAuthoritativeFraudFlag: false,
        reviewBlocked: false,
        selfReferral: false,
      }).blocked,
    ).toBe(true);
    expect(
      evaluateQualificationGates({
        referredLifecycleActive: true,
        successfulJobs: 3,
        hasMajorComplaint: false,
        hasAuthoritativeFraudFlag: true,
        reviewBlocked: false,
        selfReferral: false,
      }).blocked,
    ).toBe(true);
    expect(
      evaluateQualificationGates({
        referredLifecycleActive: true,
        successfulJobs: 3,
        hasMajorComplaint: false,
        hasAuthoritativeFraudFlag: false,
        reviewBlocked: false,
        selfReferral: true,
      }).blocked,
    ).toBe(true);
  });
});

describe("Section 07 referral codes", () => {
  test("codes are unique-shaped and not sequential", () => {
    const a = generatePartnerReferralCode();
    const b = generatePartnerReferralCode();
    expect(isPartnerReferralCodeShape(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("HP")).toBe(true);
  });
});

describe("Section 07 finance journal", () => {
  test("partner referral reward journal balances", () => {
    expect(JournalEntryType.PARTNER_REFERRAL_REWARD).toBe("PARTNER_REFERRAL_REWARD");
    const journal = financialLedgerService.journalForPartnerReferralReward({
      rewardId: "rwd_1",
      referralId: "ref_1",
      providerId: "prov_1",
      amount: PARTNER_REFERRAL_REWARD_RUPEES,
    });
    const d = journal.lines.reduce((s, l) => s + l.debit, 0);
    const c = journal.lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(c);
    expect(d).toBe(PARTNER_REFERRAL_REWARD_RUPEES);
    expect(journal.idempotencyKey).toBe("partner_referral_reward:ref_1");
  });
});

describe("Section 07 anti-abuse decision", () => {
  test("self-referral and cycles block reward", () => {
    expect(
      partnerReferralAbuseService.decision([
        { kind: "SELF_REFERRAL", severity: 100, evidenceKey: "u", note: "self", strong: true },
      ]).review,
    ).toBe("BLOCKED");
    expect(
      partnerReferralAbuseService.decision([
        { kind: "CYCLE_ABUSE", severity: 80, evidenceKey: "c", note: "cycle", strong: true },
      ]).blockReward,
    ).toBe(true);
  });

  test("phone/bank/identity reuse opens review and holds reward", () => {
    const d = partnerReferralAbuseService.decision([
      { kind: "BANK_REUSE", severity: 85, evidenceKey: "b", note: "bank", strong: true },
    ]);
    expect(d.review).toBe("OPEN");
    expect(d.blockReward).toBe(true);
  });

  test("weak IP or burst is a signal only — no auto punishment", () => {
    const d = partnerReferralAbuseService.decision([
      { kind: "SUSPICIOUS_IP", severity: 40, evidenceKey: "ip", note: "household", strong: false },
      { kind: "PATTERN_ABUSE", severity: 45, evidenceKey: "burst", note: "8 in 24h", strong: false },
    ]);
    expect(d.review).toBe("NONE");
    expect(d.blockReward).toBe(false);
  });
});
