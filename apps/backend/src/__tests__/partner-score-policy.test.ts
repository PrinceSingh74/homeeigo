import { describe, expect, test } from "bun:test";
import {
  SCORE_POLICY_VERSION,
  SCORE_WEIGHTS,
  computePartnerScore,
  explainScoreChange,
  snapshotKey,
  type ScoreFacts,
} from "../lib/partner-score-policy";

function facts(over: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    rating: 4.9,
    ratingCount: 20,
    highStarCount: 19,
    completedJobs: 40,
    totalBookings: 42,
    partnerCancellations: 1,
    acceptedAssignments: 38,
    totalAssignments: 40,
    onTimeArrivals: 36,
    arrivalsWithTracking: 38,
    documentsTotal: 3,
    documentsVerified: 3,
    kycVerified: true,
    complianceRestricted: false,
    reviewStatus: "CLEARED",
    ...over,
  };
}

describe("partner.score.v1", () => {
  test("weights sum to 1.00 (redistribution of existing compositeScore)", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1);
  });

  test("excellent partner scores in the 90s with EXCELLENT band", () => {
    const s = computePartnerScore(facts());
    expect(s.policyVersion).toBe(SCORE_POLICY_VERSION);
    expect(s.overallScore).toBeGreaterThanOrEqual(90);
    expect(s.band).toBe("EXCELLENT");
    expect(s.components.quality).toBe(98);
    expect(s.components.safety).toBe(100);
  });

  test("insufficient ratings do not score quality as 0", () => {
    const s = computePartnerScore(facts({ rating: 0, ratingCount: 0, highStarCount: 0, completedJobs: 40, totalBookings: 42 }));
    expect(s.components.quality).toBeNull();
    expect(s.components.customerSatisfaction).toBeNull();
    expect(s.components.quality).not.toBe(0);
  });

  test("overall is INSUFFICIENT_DATA when fewer than 4 components score", () => {
    const s = computePartnerScore(
      facts({
        ratingCount: 0,
        highStarCount: 0,
        totalBookings: 0,
        completedJobs: 0,
        totalAssignments: 0,
        acceptedAssignments: 0,
        arrivalsWithTracking: 0,
        onTimeArrivals: 0,
        documentsTotal: 0,
        kycVerified: false,
      }),
    );
    expect(s.overallScore).toBeNull();
    expect(s.band).toBe("INSUFFICIENT_DATA");
  });

  test("compliance restriction is a scored penalty, not a missing-data zero", () => {
    const s = computePartnerScore(facts({ complianceRestricted: true }));
    expect(s.components.compliance).toBe(25);
  });

  test("REVIEW risk status does not punish safety", () => {
    const s = computePartnerScore(facts({ reviewStatus: "REVIEW" }));
    expect(s.components.safety).toBe(100);
  });

  test("approved SUSPEND lowers safety using status only", () => {
    const s = computePartnerScore(facts({ reviewStatus: "SUSPEND" }));
    expect(s.components.safety).toBe(20);
  });

  test("explanation maps component drops to evidence counts", () => {
    const prev = computePartnerScore(facts({ rating: 4.9, highStarCount: 19 }));
    const next = computePartnerScore(facts({ rating: 4.2, ratingCount: 22, highStarCount: 16 }));
    const reasons = explainScoreChange(prev, next, { lowRatings: 2, lateArrivals: 1, partnerCancellations: 0 });
    const quality = reasons.find((r) => r.component === "quality");
    expect(quality?.detail).toContain("low rating");
    expect(quality?.evidenceCount).toBe(2);
  });

  test("snapshot keys are stable for identical scores", () => {
    const a = computePartnerScore(facts());
    const b = computePartnerScore(facts());
    expect(snapshotKey("p1", a)).toBe(snapshotKey("p1", b));
    expect(snapshotKey("p1", a)).not.toBe(snapshotKey("p2", b));
  });
});
