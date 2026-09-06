import { describe, expect, test } from "bun:test";
import {
  CAREER_PRIORITY_BOOST,
  computeCareerProgress,
  eligibleCareerLevel,
  resolveCareerLevel,
  careerPriorityBoost,
  type CareerFacts,
} from "../lib/partner-career-policy";

function facts(over: Partial<CareerFacts> = {}): CareerFacts {
  return {
    completedJobs: 12,
    rating: 4.2,
    completionRate: 92,
    onTimeRate: 90,
    certifications: 0,
    academyCompleted: 0,
    complianceRestricted: false,
    lifecycleState: "ACTIVE",
    ...over,
  };
}

describe("partner.career.v1", () => {
  test("thresholds reuse trusted / expert / super_star badge gates", () => {
    expect(eligibleCareerLevel(facts({ completedJobs: 9, rating: 5, completionRate: 100 }))).toBe("STARTER");
    expect(eligibleCareerLevel(facts())).toBe("PROFESSIONAL");
    expect(
      eligibleCareerLevel(
        facts({ completedJobs: 30, rating: 4.5, completionRate: 95, academyCompleted: 1 }),
      ),
    ).toBe("EXPERT");
    expect(
      eligibleCareerLevel(
        facts({
          completedJobs: 50,
          rating: 4.8,
          completionRate: 98,
          onTimeRate: 95,
          certifications: 1,
        }),
      ),
    ).toBe("ELITE");
  });

  test("never automatically demotes", () => {
    const r = resolveCareerLevel("EXPERT", facts({ completedJobs: 5, rating: 3, completionRate: 50 }));
    expect(r.nextStored).toBe("EXPERT");
    expect(r.promoted).toBe(false);
    expect(r.demoted).toBe(false);
  });

  test("promotes when eligible exceeds current", () => {
    const r = resolveCareerLevel(
      "STARTER",
      facts({ completedJobs: 12, rating: 4.2, completionRate: 92 }),
    );
    expect(r.nextStored).toBe("PROFESSIONAL");
    expect(r.promoted).toBe(true);
  });

  test("benefits are backend-gated: boost is 0 when not ACTIVE", () => {
    expect(careerPriorityBoost("ELITE", { lifecycleState: "ACTIVE", complianceRestricted: false })).toBe(
      CAREER_PRIORITY_BOOST.ELITE,
    );
    expect(careerPriorityBoost("ELITE", { lifecycleState: "SUSPENDED", complianceRestricted: false })).toBe(0);
    expect(careerPriorityBoost("ELITE", { lifecycleState: "ACTIVE", complianceRestricted: true })).toBe(0);
  });

  test("progress remaining requirements are real deltas", () => {
    const p = computeCareerProgress("PROFESSIONAL", facts({ completedJobs: 18, rating: 4.4, completionRate: 94 }));
    expect(p.nextLevel).toBe("EXPERT");
    expect(p.remainingRequirements.some((r) => r.id === "jobs")).toBe(true);
    expect(p.remainingRequirements.find((r) => r.id === "jobs")?.target).toBe(30);
  });
});
