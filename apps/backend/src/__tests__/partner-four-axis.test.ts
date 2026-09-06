/**
 * Pure four-axis lock. No DB. Proves the machines stay separate and that
 * shared English words are homonyms, not a shared enum.
 */
import { describe, expect, test } from "bun:test";
import {
  AVAILABILITY_STATES,
  DISPATCH_LIFECYCLE_WHERE,
  FINANCE_STATES,
  FOUR_AXIS_HOMONYMS,
  FOUR_AXIS_TOPOLOGY,
  JOB_STATES,
  LIFECYCLE_STATES,
  PARTNER_AXIS,
  assertBelongsToAxis,
  assertNotCrossAxisWrite,
  homonymAxes,
  isHomonym,
} from "../lib/partner-four-axis";
import { canTransitionLifecycle } from "../lib/partner-lifecycle-fsm";
import { deriveOperationalStatus, toCanonicalAvailability } from "../lib/partner-availability-fsm";
import { deriveJobState } from "../lib/partner-job-fsm";
import { deriveFinanceState } from "../lib/partner-finance-fsm";

describe("Partner OS four-axis lock", () => {
  test("topology is lifecycle → (availability | job) → finance", () => {
    expect([...FOUR_AXIS_TOPOLOGY]).toEqual([
      "PARTNER.lifecycle",
      "PARTNER.lifecycle -> AVAILABILITY",
      "PARTNER.lifecycle -> JOB",
      "AVAILABILITY + JOB -> FINANCE",
    ]);
  });

  test("locked vocabularies match the modernization", () => {
    expect([...LIFECYCLE_STATES]).toEqual([
      "APPLIED",
      "VERIFIED",
      "TRAINING",
      "ACTIVE",
      "PAUSED",
      "UNDER_REVIEW",
      "SUSPENDED",
      "REACTIVATED",
    ]);
    expect([...AVAILABILITY_STATES]).toEqual([
      "OFFLINE",
      "AVAILABLE",
      "OFFERED",
      "ACCEPTING",
      "EN_ROUTE",
      "ON_JOB",
      "PAUSED",
    ]);
    expect([...JOB_STATES]).toEqual([
      "OFFERED",
      "ACCEPTED",
      "EN_ROUTE",
      "ARRIVED",
      "STARTED",
      "IN_PROGRESS",
      "COMPLETED",
    ]);
    expect([...FINANCE_STATES]).toEqual([
      "EARNING_POSTED",
      "PENDING",
      "AVAILABLE",
      "WITHDRAWAL_REQUESTED",
      "PROCESSING",
      "PAID",
    ]);
  });

  test("homonyms are namespaced by axis and never a single shared state", () => {
    expect(isHomonym("PAUSED")).toBe(true);
    expect(homonymAxes("PAUSED")).toEqual([PARTNER_AXIS.LIFECYCLE, PARTNER_AXIS.AVAILABILITY]);
    expect(homonymAxes("OFFERED")).toEqual([PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.JOB]);
    expect(homonymAxes("EN_ROUTE")).toEqual([PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.JOB]);
    expect(homonymAxes("AVAILABLE")).toEqual([PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.FINANCE]);
    expect(FOUR_AXIS_HOMONYMS.PAUSED).not.toContain(PARTNER_AXIS.JOB);
    expect(FOUR_AXIS_HOMONYMS.AVAILABLE).not.toContain(PARTNER_AXIS.LIFECYCLE);
  });

  test("SUSPENDED is lifecycle-only; COMPLETED is job-only; PAID is finance-only", () => {
    expect(() => assertBelongsToAxis(PARTNER_AXIS.AVAILABILITY, "SUSPENDED")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.JOB, "SUSPENDED")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.FINANCE, "COMPLETED")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.JOB, "EARNING_POSTED")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.LIFECYCLE, "AVAILABLE")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.AVAILABILITY, "PAID")).toThrow(/AXIS_MIX/);
    assertBelongsToAxis(PARTNER_AXIS.LIFECYCLE, "SUSPENDED");
    assertBelongsToAxis(PARTNER_AXIS.JOB, "COMPLETED");
    assertBelongsToAxis(PARTNER_AXIS.FINANCE, "PAID");
  });

  test("a mutation on one axis cannot write another axis", () => {
    expect(() => assertNotCrossAxisWrite(PARTNER_AXIS.LIFECYCLE, PARTNER_AXIS.JOB)).toThrow(/AXIS_MIX/);
    expect(() => assertNotCrossAxisWrite(PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.FINANCE)).toThrow(/AXIS_MIX/);
    expect(() => assertNotCrossAxisWrite(PARTNER_AXIS.JOB, PARTNER_AXIS.LIFECYCLE)).toThrow(/AXIS_MIX/);
    assertNotCrossAxisWrite(PARTNER_AXIS.FINANCE, PARTNER_AXIS.FINANCE);
  });

  test("deriving one axis never returns another axis's exclusive tokens", () => {
    expect(canTransitionLifecycle("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionLifecycle("ACTIVE", "AVAILABLE")).toBe(false);
    expect(canTransitionLifecycle("ACTIVE", "COMPLETED")).toBe(false);

    const availability = toCanonicalAvailability(
      deriveOperationalStatus({
        isOnline: true,
        pausedAt: null,
        hasInProgress: true,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
      }),
    );
    expect(availability).toBe("ON_JOB");
    expect((LIFECYCLE_STATES as readonly string[]).includes(availability)).toBe(false);
    expect((FINANCE_STATES as readonly string[]).includes(availability)).toBe(false);

    const job = deriveJobState({ status: "COMPLETED" });
    expect(job).toBe("COMPLETED");
    expect((FINANCE_STATES as readonly string[]).includes(job)).toBe(false);
    expect(job).not.toBe("EARNING_POSTED");

    const finance = deriveFinanceState({
      earningExists: true,
      settlementStatus: "CREDITED",
      availableBalance: 500,
      reservedBalance: 0,
    });
    expect(finance).toBe("AVAILABLE");
    expect((AVAILABILITY_STATES as readonly string[]).includes(finance!)).toBe(true);
    expect((JOB_STATES as readonly string[]).includes(finance!)).toBe(false);
    expect((LIFECYCLE_STATES as readonly string[]).includes(finance!)).toBe(false);
  });

  test("dispatch eligibility is lifecycle ACTIVE only — not APPLIED+approved", () => {
    expect(DISPATCH_LIFECYCLE_WHERE).toEqual({ lifecycleState: "ACTIVE" });
    expect(canTransitionLifecycle("APPLIED", "KYC_PENDING")).toBe(false);
    expect(canTransitionLifecycle("TRAINING", "APPROVED")).toBe(false);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.AVAILABILITY, "ACCEPTING_JOB")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.JOB, "EARNINGS_POSTED")).toThrow(/AXIS_MIX/);
    expect(() => assertBelongsToAxis(PARTNER_AXIS.AVAILABILITY, "SUSPENDED")).toThrow(/AXIS_MIX/);
  });

  test("homonym tokens are not comparable across axes", () => {
    const partnerPaused = { axis: PARTNER_AXIS.LIFECYCLE, state: "PAUSED" as const };
    const availabilityPaused = { axis: PARTNER_AXIS.AVAILABILITY, state: "PAUSED" as const };
    const availabilityOffered = { axis: PARTNER_AXIS.AVAILABILITY, state: "OFFERED" as const };
    const jobOffered = { axis: PARTNER_AXIS.JOB, state: "OFFERED" as const };
    const availabilityAvailable = { axis: PARTNER_AXIS.AVAILABILITY, state: "AVAILABLE" as const };
    const moneyAvailable = { axis: PARTNER_AXIS.FINANCE, state: "AVAILABLE" as const };
    expect(partnerPaused.axis === availabilityPaused.axis).toBe(false);
    expect(availabilityOffered.axis === jobOffered.axis).toBe(false);
    expect(availabilityAvailable.axis === moneyAvailable.axis).toBe(false);
    expect(partnerPaused.state === availabilityPaused.state).toBe(true);
  });
});
