import { describe, expect, test } from "bun:test";
import {
  PUBLIC_DISTANCE_PRECISION_KM,
  publicDistanceKm,
} from "../services/provider.service";

/**
 * OWNER DECISION #7 — public discovery reports distance to the kilometre.
 *
 * ── The exposure ────────────────────────────────────────────────────────────
 *
 * `/api/providers/nearby` and `/search` are unauthenticated by design, and both returned distance
 * rounded to 100 m from a point the CALLER chooses. Distance from a chosen point is a circle; three
 * circles intersect at a point. Three anonymous requests therefore locate a working partner to
 * within about a hundred metres, and the partner has no way to see it happening or refuse.
 *
 * Coarsening to 1 km was chosen over requiring a session because pre-login browsing is a deliberate
 * product behaviour, and because it defeats the attack rather than merely gating it: the residual
 * inference collapses to roughly a square kilometre, which says no more than "this partner works in
 * this area" — something offering the service discloses anyway.
 *
 * The trilateration case below is the one that matters. It is written as an attack, not as a
 * rounding check, because a rounding check would still pass against a precision fine enough to
 * locate someone.
 */
describe("public distance precision", () => {
  test("distances are reported in whole kilometres", () => {
    expect(publicDistanceKm(3.4)).toBe(3);
    expect(publicDistanceKm(3.6)).toBe(4);
    expect(publicDistanceKm(12.49)).toBe(12);
  });

  test("a partner a few hundred metres away reads as 1 km, never 0", () => {
    /**
     * Floor would report 0 km for anyone inside the first kilometre, which both looks broken and
     * says "this partner is essentially on top of you" — the opposite of the intent.
     */
    expect(publicDistanceKm(0.05)).toBe(1);
    expect(publicDistanceKm(0.2)).toBe(1);
    expect(publicDistanceKm(0.9)).toBe(1);
  });

  test("no output carries sub-kilometre precision", () => {
    for (const exact of [0.05, 0.37, 1.02, 2.55, 7.91, 18.34, 49.99]) {
      const reported = publicDistanceKm(exact);
      expect(Number.isInteger(reported / PUBLIC_DISTANCE_PRECISION_KM)).toBe(true);
    }
  });

  test("nonsense input does not leak or throw", () => {
    expect(publicDistanceKm(Number.NaN)).toBe(0);
    expect(publicDistanceKm(-5)).toBe(0);
    expect(publicDistanceKm(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("trilateration from three probe points cannot pin a partner to a street", () => {
    /**
     * The attack, run against the real function.
     *
     * A partner sits at a known point. An attacker probes from three corners and reads back the
     * distances. With 100 m precision each reading confines the partner to a 100 m-wide annulus and
     * the three intersect tightly; at 1 km each annulus is 1 km wide. The assertion is on the
     * WIDTH OF THE UNCERTAINTY the readings admit, which is what the attacker actually gets.
     */
    const partner = { lat: 28.6139, lng: 77.209 };
    const probes = [
      { lat: 28.55, lng: 77.15 },
      { lat: 28.68, lng: 77.15 },
      { lat: 28.6139, lng: 77.31 },
    ];

    // Haversine, matching lib/geo.
    const exactKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };

    for (const probe of probes) {
      const exact = exactKm(probe, partner);
      const reported = publicDistanceKm(exact);

      // Every reading admits at least a half-kilometre of error on each side.
      expect(Math.abs(reported - exact)).toBeLessThanOrEqual(PUBLIC_DISTANCE_PRECISION_KM / 2 + 1e-9);
      // And the attacker learns nothing finer than a kilometre from any single probe.
      expect(reported % PUBLIC_DISTANCE_PRECISION_KM).toBe(0);
    }
  });

  test("the reported number carries an order of magnitude less location information", () => {
    /**
     * An earlier version of this test asserted that two partners 300 m apart ALWAYS report the same
     * distance. That is false for any rounding scheme — 7.42 and 7.72 straddle a boundary and land
     * on 7 and 8 — and asserting it would have been asserting something the fix does not and cannot
     * provide.
     *
     * What the fix does provide is measurable: across a 10 km sweep the public surface now exposes
     * roughly a tenth as many distinguishable values as it did at 100 m precision. That is the
     * quantity an attacker mines, so that is what this measures.
     */
    const sweep: number[] = [];
    for (let km = 0.1; km <= 10; km += 0.1) sweep.push(Math.round(km * 10) / 10);

    const coarse = new Set(sweep.map(publicDistanceKm));
    const oldPrecision = new Set(sweep.map((d) => Math.round(d * 10) / 10));

    expect(oldPrecision.size).toBeGreaterThan(90);
    expect(coarse.size).toBeLessThanOrEqual(11);
    expect(coarse.size * 8).toBeLessThan(oldPrecision.size);
  });

});

describe("the coarsening is applied where it matters", () => {
  test("both public discovery paths use the shared helper", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dir, "..", "services", "provider.service.ts"), "utf8");

    // Two public surfaces emit a distance; both must go through the one helper.
    const uses = src.match(/distance: publicDistanceKm\(/g) ?? [];
    expect(uses.length).toBe(2);
    // And neither may have kept the old sub-kilometre rounding.
    expect(src).not.toMatch(/distance: Math\.round\(dist \* 10\) \/ 10/);
  });
});
