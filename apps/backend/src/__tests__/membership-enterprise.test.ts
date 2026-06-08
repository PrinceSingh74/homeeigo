import { describe, expect, test } from "bun:test";
import { resolveTierPriorityScore, TIER_PRIORITY_SCORE } from "../lib/membership-tiers";

describe("Membership enterprise — tier priority scores", () => {
  test("platinum highest priority", () => {
    expect(resolveTierPriorityScore("platinum")).toBe(100);
    expect(resolveTierPriorityScore("PLATINUM")).toBe(100);
  });

  test("gold and silver ordered correctly", () => {
    expect(resolveTierPriorityScore("gold")).toBe(80);
    expect(resolveTierPriorityScore("silver")).toBe(60);
    expect(resolveTierPriorityScore(null)).toBe(TIER_PRIORITY_SCORE.free);
  });

  test("premium ranks above free", () => {
    expect(resolveTierPriorityScore("gold")).toBeGreaterThan(resolveTierPriorityScore("free"));
  });
});
