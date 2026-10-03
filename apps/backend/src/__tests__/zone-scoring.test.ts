import { describe, expect, test } from "bun:test";
import { opportunityScore, scoreZone, skillGapRecommendation } from "../lib/zone-scoring";

describe("zoneScoring compositeScore opportunity ranking", () => {
  test("high demand / low supply ranks above low demand / high supply", () => {
    const maxRev = 1000;
    const maxDem = 18;
    const opportunity = scoreZone({
      demand24h: 18,
      supply: 11,
      revenue24h: 800,
      activeBookings: 18,
      maxRev,
      maxDem,
    });
    const empty = scoreZone({
      demand24h: 3,
      supply: 15,
      revenue24h: 100,
      activeBookings: 0,
      maxRev,
      maxDem,
    });
    expect(opportunity.gap).toBe(7);
    expect(empty.gap).toBe(-12);
    expect(opportunity.interpretation).toBe("DEMAND_EXCEEDS_SUPPLY");
    expect(empty.interpretation).toBe("OVERSUPPLIED");
    expect(opportunity.compositeScore).toBeGreaterThan(empty.compositeScore);
    expect(opportunity.opportunityScore).toBeGreaterThan(empty.opportunityScore);
  });

  test("idle empty zone does not outrank a starved demand zone", () => {
    const starved = scoreZone({
      demand24h: 18,
      supply: 11,
      revenue24h: 0,
      activeBookings: 18,
      maxRev: 1,
      maxDem: 18,
    });
    const idle = scoreZone({
      demand24h: 0,
      supply: 0,
      revenue24h: 0,
      activeBookings: 0,
      maxRev: 1,
      maxDem: 18,
    });
    expect(idle.serviceHealth).toBe(50);
    expect(starved.compositeScore).toBeGreaterThan(idle.compositeScore);
  });

  test("opportunityScore is higher when demand exceeds supply", () => {
    expect(opportunityScore(18, 11)).toBeGreaterThan(opportunityScore(3, 15));
  });

  test("skill-gap recruitment is withheld without category evidence", () => {
    const rec = skillGapRecommendation("Sector 57", 7, [{ skill: "electrician", demand: 1, supply: 0, gap: 1 }]);
    expect(rec).toContain("not recommended");
    expect(rec).not.toContain("Acquire 7 electrician");
  });

  test("skill-gap recruitment uses evidenced category demand", () => {
    const rec = skillGapRecommendation("Sector 57", 7, [{ skill: "electrician", demand: 8, supply: 1, gap: 7 }]);
    expect(rec).toBe("Acquire 7 electrician in Sector 57");
  });
});
