import { describe, expect, test } from "bun:test";
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
  canonicalizeLifecycle,
  getAllowedLifecycleTransitions,
  isDispatchEligibleLifecycle,
  adminActionTarget,
  LIFECYCLE_ONBOARDING_PATH,
} from "../lib/partner-lifecycle-fsm";
import { LIFECYCLE_STATES } from "../lib/partner-four-axis";

describe("partner lifecycle FSM", () => {
  test("happy path Applied → Verified → Training → Active", () => {
    const path = [
      ["APPLIED", "VERIFIED"],
      ["VERIFIED", "TRAINING"],
      ["TRAINING", "ACTIVE"],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransitionLifecycle(from, to)).toBe(true);
    }
    expect(LIFECYCLE_ONBOARDING_PATH).toEqual(["APPLIED", "VERIFIED", "TRAINING", "ACTIVE"]);
  });

  test("canonical vocab is the locked eight states", () => {
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
    expect(canonicalizeLifecycle("KYC_PENDING")).toBe("APPLIED");
    expect(canonicalizeLifecycle("VERIFICATION")).toBe("VERIFIED");
    expect(canonicalizeLifecycle("APPROVED")).toBe("ACTIVE");
  });

  test("Active can pause or enter review; not skip to suspended", () => {
    expect(getAllowedLifecycleTransitions("ACTIVE")).toEqual(expect.arrayContaining(["PAUSED", "UNDER_REVIEW"]));
    expect(getAllowedLifecycleTransitions("ACTIVE")).toHaveLength(2);
    expect(canTransitionLifecycle("ACTIVE", "SUSPENDED")).toBe(false);
  });

  test("invalid transitions throw INVALID_TRANSITION", () => {
    expect(() => assertLifecycleTransition("APPLIED", "ACTIVE")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertLifecycleTransition("SUSPENDED", "ACTIVE")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertLifecycleTransition("TRAINING", "SUSPENDED")).toThrow(/INVALID_TRANSITION/);
  });

  test("legacy aliases and foreign-axis tokens are rejected as write targets", () => {
    expect(canTransitionLifecycle("APPLIED", "KYC_PENDING")).toBe(false);
    expect(canTransitionLifecycle("APPLIED", "VERIFICATION")).toBe(false);
    expect(canTransitionLifecycle("TRAINING", "APPROVED")).toBe(false);
    expect(canTransitionLifecycle("APPLIED", "COMPLETED")).toBe(false);
    expect(canTransitionLifecycle("APPLIED", "AVAILABLE")).toBe(false);
    expect(canTransitionLifecycle("APPLIED", "EARNING_POSTED")).toBe(false);
    expect(canTransitionLifecycle("KYC_PENDING", "VERIFIED")).toBe(true);
    expect(() => assertLifecycleTransition("APPLIED", "KYC_PENDING")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertLifecycleTransition("ACTIVE", "COMPLETED")).toThrow(/INVALID_TRANSITION/);
  });

  test("only ACTIVE is dispatch-eligible — availability remains a separate FSM", () => {
    expect(isDispatchEligibleLifecycle("ACTIVE")).toBe(true);
    expect(isDispatchEligibleLifecycle("PAUSED")).toBe(false);
    expect(isDispatchEligibleLifecycle("UNDER_REVIEW")).toBe(false);
    expect(isDispatchEligibleLifecycle("SUSPENDED")).toBe(false);
    expect(isDispatchEligibleLifecycle("VERIFIED")).toBe(false);
    expect(isDispatchEligibleLifecycle("REACTIVATED")).toBe(false);
    expect(isDispatchEligibleLifecycle("APPROVED")).toBe(true);
  });

  test("admin approve walks Applied → Verified → Training → Active", () => {
    expect(adminActionTarget("approve", "APPLIED")).toBe("VERIFIED");
    expect(adminActionTarget("approve", "VERIFIED")).toBe("TRAINING");
    expect(adminActionTarget("approve", "TRAINING")).toBe("ACTIVE");
  });

  test("reactivate is SUSPENDED → REACTIVATED, then REACTIVATED → ACTIVE", () => {
    expect(canTransitionLifecycle("SUSPENDED", "REACTIVATED")).toBe(true);
    expect(adminActionTarget("reactivate", "SUSPENDED")).toBe("REACTIVATED");
    expect(adminActionTarget("reactivate", "REACTIVATED")).toBe("ACTIVE");
    expect(canTransitionLifecycle("REACTIVATED", "ACTIVE")).toBe(true);
  });
});
