/**
 * W2-D3 — UNKNOWN stays UNKNOWN in provider ranking.
 *
 * Every case the brief named, plus the one property that makes the fix safe to ship: a provider
 * with REAL history ranks exactly as it did before, because with every signal known and the default
 * weights the new normalisation equals the old additive sum.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_SIGNAL_WEIGHTS,
  MIN_COMPLETION_SAMPLE,
  MIN_RATING_SAMPLE,
  MIN_RESPONSE_SAMPLE,
  compareRankedProviders,
  completionPoints,
  distancePoints,
  normalisedMatchScore,
  ratingPoints,
  responsePoints,
  unknownSignals,
  type SignalScores,
} from "../lib/matching-signals";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const lots = { terminalJobs: 50, recentJobs: 50 };
const none = { terminalJobs: 0, recentJobs: 0 };

describe("zero or thin history is UNKNOWN, never a value", () => {
  test("a provider with zero reviews has no rating signal — not 15, not 30", () => {
    expect(ratingPoints(0, 0)).toBeNull();
    // A stored 5.0 over no reviews is the precise thing the old default rewarded.
    expect(ratingPoints(5.0, 0)).toBeNull();
  });

  test("below the minimum sample the rating is unknown; at it, it is measured", () => {
    expect(ratingPoints(4.9, MIN_RATING_SAMPLE - 1)).toBeNull();
    expect(ratingPoints(4.9, MIN_RATING_SAMPLE)).toBe(30);
  });

  test("zero completed jobs is not 100% — and not 0% either", () => {
    // completionRate defaults to 0 in the schema; with no jobs that 0 means nothing.
    expect(completionPoints(0, none)).toBeNull();
    expect(completionPoints(100, none)).toBeNull();
  });

  test("no recent bookings is not a perfect response rate", () => {
    // rating.service used to WRITE responseRate = 100 for this exact case.
    expect(responsePoints(100, 0, none)).toBeNull();
  });

  test("the evidence thresholds are what the module says they are", () => {
    expect(completionPoints(99, { terminalJobs: MIN_COMPLETION_SAMPLE - 1, recentJobs: 0 })).toBeNull();
    expect(completionPoints(99, { terminalJobs: MIN_COMPLETION_SAMPLE, recentJobs: 0 })).toBe(10);
    expect(responsePoints(99, 1, { terminalJobs: 0, recentJobs: MIN_RESPONSE_SAMPLE - 1 })).toBeNull();
    expect(responsePoints(99, 1, { terminalJobs: 0, recentJobs: MIN_RESPONSE_SAMPLE })).toBe(15);
  });
});

describe("measured history is scored honestly, including when it is bad", () => {
  test("a genuinely low rating over real reviews scores low", () => {
    expect(ratingPoints(2.5, 40)).toBe(10);
  });

  test("a genuinely low completion rate over real jobs scores low — not unknown", () => {
    // The opposite failure: hiding a bad record behind "insufficient history".
    expect(completionPoints(40, lots)).toBe(1);
  });

  test("a slow responder over real jobs is penalised by the multiplier", () => {
    expect(responsePoints(96, 40, lots)).toBeCloseTo(15 * 0.4);
  });
});

describe("unknown position means no distance and no ETA", () => {
  test("missing coordinates produce no distance score — not an invented 15 km", () => {
    expect(distancePoints(null, 50)).toBeNull();
    expect(distancePoints(Number.NaN, 50)).toBeNull();
  });

  test("a real distance is scored", () => {
    expect(distancePoints(0, 50)).toBe(25);
    expect(distancePoints(25, 50)).toBe(12.5);
    expect(distancePoints(80, 50)).toBe(0);
  });

  test("the match object carries null distance and null eta together", () => {
    const source = read("src/services/matching.service.ts");
    expect(source).toContain("distance: distance == null ? null : round1(distance),");
    expect(source).toContain("eta: distance == null ? null : etaMinutes(distance),");
  });
});

describe("unknown neither helps nor hurts", () => {
  const known = (over: Partial<SignalScores> = {}): SignalScores => ({
    rating: 30,
    distance: 25,
    availability: 20,
    response: 15,
    completion: 10,
    ...over,
  });

  test("with every signal known, the score EQUALS the old additive sum — real history ranks as before", () => {
    const cases: SignalScores[] = [
      known(),
      known({ rating: 10, distance: 5, availability: 10, response: 3, completion: 1 }),
      known({ rating: 24, distance: 17.3, availability: 20, response: 9, completion: 6 }),
    ];
    for (const c of cases) {
      const additive = (c.rating ?? 0) + (c.distance ?? 0) + (c.availability ?? 0) + (c.response ?? 0) + (c.completion ?? 0);
      expect(normalisedMatchScore(c, DEFAULT_SIGNAL_WEIGHTS)).toBeCloseTo(additive, 9);
    }
  });

  test("an unknown signal is excluded, not zeroed — perfect known signals still score 100", () => {
    const s = known({ rating: null, response: null, completion: null });
    expect(normalisedMatchScore(s)).toBeCloseTo(100, 9);
  });

  test("an unknown signal does not inflate a mediocre record either", () => {
    const mediocre = known({ rating: null, distance: 12.5, availability: 10, response: null, completion: null });
    expect(normalisedMatchScore(mediocre)).toBeCloseTo(50, 9);
  });

  test("the old fabricated 15/30 would have lifted a no-review provider; now it cannot", () => {
    // Same provider, same real distance/availability. The old path added 15 invented rating points.
    const observed = known({ rating: null, distance: 10, availability: 10, response: null, completion: null });
    const withFabrication = known({ rating: 15, distance: 10, availability: 10, response: null, completion: null });
    expect(normalisedMatchScore(observed)).not.toBeCloseTo(normalisedMatchScore(withFabrication), 3);
  });

  test("unknownSignals names exactly what was excluded", () => {
    expect(unknownSignals(known({ rating: null, completion: null }))).toEqual(["rating", "completion"]);
    expect(unknownSignals(known())).toEqual([]);
  });
});

describe("ranking is deterministic and never leans on stored fabricated values", () => {
  test("higher score first", () => {
    const out = [
      { providerId: "a", totalScore: 50, unknownSignals: [] },
      { providerId: "b", totalScore: 80, unknownSignals: [] },
    ].sort(compareRankedProviders);
    expect(out.map((p) => p.providerId)).toEqual(["b", "a"]);
  });

  test("on an exact tie, more KNOWN signals wins — evidence preferred, none invented", () => {
    const out = [
      { providerId: "new", totalScore: 70, unknownSignals: ["rating", "completion"] },
      { providerId: "vet", totalScore: 70, unknownSignals: [] },
    ].sort(compareRankedProviders);
    expect(out.map((p) => p.providerId)).toEqual(["vet", "new"]);
  });

  test("a full tie falls back to provider id, so the same inputs give the same order", () => {
    const rows = [
      { providerId: "z9", totalScore: 60, unknownSignals: [] },
      { providerId: "a1", totalScore: 60, unknownSignals: [] },
      { providerId: "m5", totalScore: 60, unknownSignals: [] },
    ];
    const once = [...rows].sort(compareRankedProviders).map((p) => p.providerId);
    const twice = [...rows].reverse().sort(compareRankedProviders).map((p) => p.providerId);
    expect(once).toEqual(["a1", "m5", "z9"]);
    expect(twice).toEqual(once);
  });

  test("both matching sorts use the deterministic comparator", () => {
    const source = read("src/services/matching.service.ts");
    expect((source.match(/\.sort\(compareRankedProviders\)/g) ?? []).length).toBe(2);
    expect(source.includes("b.totalScore - a.totalScore")).toBe(false);
  });
});

describe("the fabrications are gone from the source", () => {
  test("no invented 15 km anywhere in matching", () => {
    const source = read("src/services/matching.service.ts");
    expect(source.includes(": 15;")).toBe(false);
    expect(source.includes("distanceKmValue = 15")).toBe(false);
  });

  test("no flat default rating for thin history", () => {
    const source = read("src/services/matching.service.ts");
    expect(source.includes("if (totalReviews < 5) return 15;")).toBe(false);
  });

  test("the premium boost reads the rating only when the rating is trusted", () => {
    expect(read("src/services/matching.service.ts")).toContain("if (ratingScore != null) {");
  });

  test("rating.service no longer writes a 100% response rate without evidence", () => {
    const source = read("src/services/rating.service.ts");
    expect(source.includes(": 100;")).toBe(false);
    expect(source).toContain("...(responseRate != null ? { responseRate } : {}),");
    expect(source).toContain("...(completionRate != null ? { completionRate } : {}),");
  });

  test("evidence is counted in ONE grouped query per call, not per provider", () => {
    const source = read("src/services/matching.service.ts");
    expect(source).toContain("private async loadEvidenceMap(providerIds: string[])");
    // D4 aliased the table (it now joins customer and partner users for the population check).
    expect(source).toContain("WHERE b.provider_id = ANY(${providerIds})");
    expect(source).toContain("GROUP BY b.provider_id");
  });
});
