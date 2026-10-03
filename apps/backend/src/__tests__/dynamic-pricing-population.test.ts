/**
 * Does contaminated realized-conversion data change the price a customer is quoted?
 *
 * Pass 4 said yes, and scoped `baseConversion()` to the business population on that basis, writing
 * into the source that certification runs "push the price for real customers". **That claim was
 * wrong**, and this file is how it was settled.
 *
 * Two independent reasons it cannot be true:
 *
 *   1. `revenue(m) = subtotal · m · clamp(base · e^(−e·(m−1)), 0, 1)`. `base` is clamped to
 *      [0.05, 0.95] by its caller, and e^(−e·(m−1)) ≤ 1 for m ≥ 1, so the inner clamp can never
 *      bind and `base` factors out as a constant across every candidate m. The argmax — the
 *      recommended multiplier and price — is therefore independent of `base`. Contamination moves
 *      `expectedConversion` and `expectedRevenue`, which are reported figures, and nothing else.
 *
 *   2. `dynamicPricingService` has exactly one caller, `routes/pricing.ts`, and nothing in booking
 *      creation or checkout reads it. `/api/pricing/*` has no frontend consumer in any of the three
 *      web apps or either mobile app — only audit scripts call it.
 *
 * The scoping change stands, because a reported conversion rate should describe the real business.
 * Its severity does not: this is a reporting-accuracy fix, not a customer-money fix.
 *
 * Pure functions only. No database, no network.
 */
import { describe, expect, it } from "bun:test";
import { conversionAt, revenueOptimal } from "../services/dynamic-pricing.service";

/** The clamp `baseConversion()` applies before the value reaches the optimizer. */
const BASE_MIN = 0.05;
const BASE_MAX = 0.95;

describe("dynamic pricing — is the quote sensitive to the conversion anchor?", () => {
  it("returns the same multiplier and price for every admissible base", () => {
    const subtotal = 1200;
    const ceiling = 2.4;
    const elasticity = 1.2;

    const results = [BASE_MIN, 0.2, 0.35, 0.5, 0.72, BASE_MAX].map((base) => ({
      base,
      ...revenueOptimal(subtotal, base, ceiling, elasticity),
    }));

    const multipliers = new Set(results.map((r) => r.multiplier));
    const prices = new Set(results.map((r) => r.price));
    expect(multipliers.size).toBe(1);
    expect(prices.size).toBe(1);

    // And the reported figures DO move, which is what the scoping fix is actually about.
    expect(new Set(results.map((r) => r.expectedConversion)).size).toBe(results.length);
  });

  it("holds across the whole multiplier ceiling range, not one lucky ceiling", () => {
    // A single ceiling could coincide. Sweep the range the signal stack can produce (clamped to
    // [1, 3] in `quote`) and assert invariance at every step.
    for (let ceiling = 1; ceiling <= 3.0001; ceiling += 0.1) {
      const low = revenueOptimal(1000, BASE_MIN, ceiling, 1.2);
      const high = revenueOptimal(1000, BASE_MAX, ceiling, 1.2);
      expect(high.multiplier).toBe(low.multiplier);
      expect(high.price).toBe(low.price);
    }
  });

  it("holds across the elasticity range the caller can produce", () => {
    // `effElasticity` is clamped to [0.3, ELASTICITY] where ELASTICITY defaults to 1.2.
    for (const elasticity of [0.3, 0.5, 0.8, 1.0, 1.2]) {
      const a = revenueOptimal(900, 0.1, 2.0, elasticity);
      const b = revenueOptimal(900, 0.9, 2.0, elasticity);
      expect(b.multiplier).toBe(a.multiplier);
      expect(b.price).toBe(a.price);
    }
  });

  it("never lets the conversion clamp bind, which is what makes base factor out", () => {
    // The invariance above depends on `clamp(base · e^(−e·(m−1)), 0, 1)` never hitting its ceiling.
    // If a future change raised the base clamp above 1, base would stop factoring out and the
    // price WOULD become sensitive to contaminated data. This is the assumption, asserted.
    for (const base of [BASE_MIN, 0.5, BASE_MAX]) {
      for (let m = 1; m <= 3.0001; m += 0.1) {
        expect(conversionAt(base, m, 1.2)).toBeLessThan(1);
      }
    }
  });

  it("still responds to the demand signal itself", () => {
    // Invariance to `base` must not be confused with the optimizer being inert. A higher ceiling
    // has to be able to produce a higher recommended multiplier, or the engine does nothing.
    const tight = revenueOptimal(1000, 0.5, 1.0, 1.2);
    const loose = revenueOptimal(1000, 0.5, 2.5, 0.3);
    expect(loose.multiplier).toBeGreaterThan(tight.multiplier);
    expect(loose.price).toBeGreaterThan(tight.price);
  });
});
