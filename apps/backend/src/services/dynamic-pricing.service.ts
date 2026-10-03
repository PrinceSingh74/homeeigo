/**
 * HOMIGO Dynamic Pricing Engine (Phase-4 Track 2).
 *
 * The intelligence layer ON TOP of the checkout-authoritative `booking-pricing.service`
 * (which owns base/package/addons/discounts/tax). This engine computes the live, signal-driven
 * pricing multipliers + a revenue-optimal price + expected conversion/revenue + surge forecast +
 * A/B experiment assignment. It does NOT mutate checkout pricing — it recommends.
 *
 * All multipliers derive from REAL signals already verified in production:
 *   distance/time/traffic ← Google Maps (mapsService.eta)
 *   weather               ← weatherService
 *   demand + scarcity     ← geoIntelligenceService (surge + provider-density), nearest zone
 *   event                 ← ops-set PRICING_EVENT_MULTIPLIER (no fabricated event data)
 *
 * Every result carries confidence + freshness (consistent with the geo-intel envelope).
 */
import { analyticsWhere } from "../lib/analytics-scope";
import prisma from "../lib/prisma";
import { mapsService } from "./maps.service";
import { weatherService } from "./weather.service";
import { geoIntelligenceService, DEMAND_FORECAST_UNAVAILABLE } from "./geo-intelligence.service";
import { cacheService } from "./cache.service";
import { distanceKm } from "../lib/geo";
import { incCounter, observeHist } from "../lib/metrics";
import { createHash } from "node:crypto";

const RATE_PER_KM = Number(process.env.PRICING_RATE_PER_KM ?? 8); // ₹/km distance fare
const RATE_PER_MIN = Number(process.env.PRICING_RATE_PER_MIN ?? 1.5); // ₹/min time fare
const ELASTICITY = Number(process.env.PRICING_ELASTICITY ?? 1.2); // conversion price-elasticity
const EVENT_MULTIPLIER = Number(process.env.PRICING_EVENT_MULTIPLIER ?? 1); // ops override during known events
const FREE_FLOW_KMH = 26; // urban free-flow baseline for the traffic multiplier
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type PriceQuoteInput = { baseFare: number; from: { lat: number; lng: number }; to: { lat: number; lng: number } };

export type PriceBreakdown = {
  baseFare: number; distanceFare: number; timeFare: number; subtotal: number;
  multipliers: { traffic: number; weather: number; demand: number; scarcity: number; event: number; combined: number };
  recommendedPrice: number;
  optimal: { multiplier: number; price: number; expectedConversion: number; expectedRevenue: number };
  expectedConversionAtRecommended: number;
  context: { distanceKm: number; durationMin: number; withTraffic: boolean; weatherCondition?: string; zone?: string };
};
export type PriceResult = { data: PriceBreakdown; confidence: number; freshness: string; source: string; generatedAt: string };

let _baseConv = { v: 0.5, at: 0 };
/** Realized booking conversion (completed ÷ created, last 7d) — the demand-curve anchor. */
async function baseConversion(): Promise<number> {
  if (Date.now() - _baseConv.at < 300_000) return _baseConv.v;
  const since = new Date(Date.now() - 7 * 86400_000);
  // Scoped so this reports the real business. It does NOT change any price.
  //
  // An earlier revision of this comment claimed certification traffic "moves the multiplier for
  // everyone". That was wrong, and it was wrong twice over:
  //
  //   - `revenueOptimal` takes an argmax of `subtotal · m · base · e^(−e·(m−1))`, in which `base`
  //     is a constant factor across every candidate m, so it cannot change which m wins. It scales
  //     `expectedConversion` and `expectedRevenue`, which are reported, not charged. (There WAS one
  //     channel by which it leaked into the price — the optimizer compared an exact revenue against
  //     a rounded running best — and that is fixed and pinned in
  //     `__tests__/dynamic-pricing-population.test.ts`.)
  //
  //   - nothing customer-facing reads this service. Its only caller is `routes/pricing.ts`, booking
  //     creation and checkout never touch it, and `/api/pricing/*` has no consumer in any of the
  //     three web apps or either mobile app.
  //
  // (An earlier revision said 14.6% of bookings were fixture rows; that figure came from a provenance
  // rule since withdrawn — the corroborated share is under 1%.) So the effect on the *reported*
  // conversion today is small; the scope keeps it correct as declared fixture traffic accumulates.
  // Either way it is a reporting-accuracy concern, not a money one.
  const [created, completed] = await Promise.all([
    prisma.booking.count({ where: { createdAt: { gte: since }, ...analyticsWhere() } }),
    prisma.booking.count({ where: { createdAt: { gte: since }, status: "COMPLETED", ...analyticsWhere() } }),
  ]);
  _baseConv = { v: created > 0 ? clamp(completed / created, 0.05, 0.95) : 0.5, at: Date.now() };
  return _baseConv.v;
}

/** conversion(m) = base · e^(-elasticity·(m−1)) — falls as the price multiplier rises. */
export const conversionAt = (base: number, m: number, elasticity: number) =>
  clamp(base * Math.exp(-elasticity * (m - 1)), 0, 1);

export type OptimalPrice = { multiplier: number; price: number; expectedConversion: number; expectedRevenue: number };

/**
 * Revenue-optimal multiplier: argmax over m ∈ [1, ceiling] of price(m) · conversion(m).
 *
 * Extracted so the question "does the realized-conversion anchor move the recommended price?" can be
 * answered by measurement instead of by reading. It does not — and that matters, because a previous
 * pass claimed it did.
 *
 * revenue(m) = subtotal · m · clamp(base · e^(−e·(m−1)), 0, 1)
 *
 * `base` is clamped to [0.05, 0.95] by its caller and e^(−e·(m−1)) ≤ 1 for m ≥ 1, so the inner
 * clamp can never bind and `base` factors out as a constant across every m. The argmax is therefore
 * independent of `base`: contaminating realized conversion scales `expectedConversion` and
 * `expectedRevenue` — the two *reported* figures — and leaves `multiplier` and `price` untouched.
 */
export function revenueOptimal(subtotal: number, base: number, ceiling: number, elasticity: number): OptimalPrice {
  let bestMultiplier = 1;
  let bestConv = base;
  // Compared unrounded, and rounded only on the way out.
  //
  // The original loop stored `Math.round(rev)` as the running best and then compared the next
  // candidate's exact `rev` against it. Rounding is a fixed ±0.5 perturbation, so it is
  // proportionally larger when revenues are small — which made the winner in a near-flat region of
  // the curve depend on the absolute scale of the revenue, and therefore on `base`. Measured: the
  // same inputs at base 0.1 and base 0.9 chose multipliers 1.25 and 1.30, a 4% price difference
  // decided entirely by rounding.
  //
  // That is the only channel through which the realized-conversion anchor could reach a price at
  // all; the algebra otherwise makes `base` factor out of the argmax completely.
  let bestRevenue = subtotal * base;
  for (let mm = 1; mm <= ceiling + 1e-9; mm += 0.05) {
    const conv = conversionAt(base, mm, elasticity);
    const rev = subtotal * mm * conv;
    if (rev > bestRevenue) {
      bestRevenue = rev;
      bestMultiplier = mm;
      bestConv = conv;
    }
  }
  return {
    multiplier: Math.round(bestMultiplier * 100) / 100,
    price: Math.round(subtotal * bestMultiplier),
    expectedConversion: Math.round(bestConv * 1000) / 1000,
    expectedRevenue: Math.round(bestRevenue),
  };
}

export class DynamicPricingService {
  /** Resolve the nearest operating zone's surge + scarcity signals for a point. */
  private async zoneSignals(pt: { lat: number; lng: number }): Promise<{ weather: number; demand: number; scarcity: number; zone?: string }> {
    const [surge, density] = await Promise.all([geoIntelligenceService.surgePrediction(), geoIntelligenceService.providerDensity()]);
    const dens = (density.data as Array<{ zoneId: string; name: string; centerLat: number; centerLng: number; areaKm2: number; densityPerKm2: number }>);
    let nearest: (typeof dens)[number] | undefined; let bestD = Infinity;
    for (const z of dens) { const d = distanceKm(pt.lat, pt.lng, z.centerLat, z.centerLng); if (d < bestD) { bestD = d; nearest = z; } }
    if (!nearest) return { weather: 1, demand: 1, scarcity: 1 };
    const su = (surge.data as Array<{ zoneId: string; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null; supply: number; activeBookings: number }>).find((s) => s.zoneId === nearest!.zoneId);
    const weather = su?.weatherSurge ?? 1;
    // demand multiplier from active-demand/supply pressure (already in predictedSurge; isolate demand part).
    const demand = clamp(1 + Math.max(0, (su?.demandDeltaPct ?? 0)) / 100 * 0.4, 1, 1.8);
    // scarcity: sparse provider density ⇒ higher multiplier (median ~0.5/km²).
    const scarcity = clamp(1 + (0.5 - Math.min(nearest.densityPerKm2, 0.5)) * 0.6, 1, 1.5);
    return { weather, demand, scarcity, zone: nearest.name };
  }

  async quote(input: PriceQuoteInput): Promise<PriceResult> {
    const t0 = Date.now();
    incCounter("pricing_quote_total");
    const key = `pricing:quote:${input.baseFare}:${input.from.lat.toFixed(3)},${input.from.lng.toFixed(3)}:${input.to.lat.toFixed(3)},${input.to.lng.toFixed(3)}`;
    try {
      return await cacheService.getOrFetch(key, 60, async () => {
        const [eta, snap, signals, base] = await Promise.all([
          mapsService.eta(input.from, input.to),
          weatherService.getByCoords(input.to.lat, input.to.lng).catch(() => null),
          this.zoneSignals(input.to),
          baseConversion(),
        ]);
        const distKm = eta.distanceKm;
        const durMin = eta.etaMinutes;
        const freeFlowMin = (distKm / FREE_FLOW_KMH) * 60;
        const traffic = clamp(freeFlowMin > 0 ? durMin / freeFlowMin : 1, 1, 1.6);

        const distanceFare = Math.round(distKm * RATE_PER_KM);
        const timeFare = Math.round(durMin * RATE_PER_MIN);
        const subtotal = input.baseFare + distanceFare + timeFare;

        const m = {
          traffic: Math.round(traffic * 100) / 100,
          weather: Math.round(signals.weather * 100) / 100,
          demand: Math.round(signals.demand * 100) / 100,
          scarcity: Math.round(signals.scarcity * 100) / 100,
          event: EVENT_MULTIPLIER,
          combined: 0,
        };
        m.combined = Math.round(clamp(m.traffic * m.weather * m.demand * m.scarcity * m.event, 1, 3) * 100) / 100;

        // Scarce supply makes demand price-INELASTIC (that's why surge works): scale the
        // elasticity down as demand×scarcity rises, so the optimizer charges surge only when
        // the market actually bears it.
        const effElasticity = clamp(ELASTICITY / Math.max(1, m.demand * m.scarcity), 0.3, ELASTICITY);

        // Revenue-optimal multiplier: argmax over m∈[1, signal] of price(m)·conversion(m).
        // We never recommend more than the raw demand signal justifies.
        const best = revenueOptimal(subtotal, base, m.combined, effElasticity);

        // The engine RECOMMENDS the revenue-optimal price (surge tempered by elasticity).
        const data: PriceBreakdown = {
          baseFare: input.baseFare, distanceFare, timeFare, subtotal,
          multipliers: m, recommendedPrice: best.price,
          optimal: best,
          expectedConversionAtRecommended: best.expectedConversion,
          context: { distanceKm: distKm, durationMin: durMin, withTraffic: eta.withTraffic, weatherCondition: snap?.description, zone: signals.zone },
        };
        return {
          data,
          confidence: eta.source === "google" ? 0.9 : 0.65,
          freshness: new Date().toISOString(),
          source: "maps+weather+geo-intel+computed",
          generatedAt: new Date().toISOString(),
        };
      }, 5);
    } finally {
      observeHist("pricing_quote_latency_seconds", (Date.now() - t0) / 1000);
    }
  }

  /** Surge forecast: current vs predicted multiplier for a point, with confidence + duration. */
  async surgeForecast(pt: { lat: number; lng: number }): Promise<{ data: { current: number; predicted: number; trend: "rising" | "falling" | "stable" | "unknown"; expectedDurationMin: number; zone?: string; trendBasis: "demand-forecast" | "UNAVAILABLE_STALE_FORECAST" | typeof DEMAND_FORECAST_UNAVAILABLE }; confidence: number; freshness: string; source: string }> {
    // The forecast is read through the non-throwing path: a warehouse outage used to reject this
    // Promise.all and 500 the whole answer, including the live multiplier that does not depend on it (X-85).
    const [signals, demand] = await Promise.all([this.zoneSignals(pt), geoIntelligenceService.demandForecastSafe(6)]);
    const sourceUnavailable = !demand.available;
    const current = Math.round(clamp(signals.weather * signals.demand * signals.scarcity, 1, 3) * 100) / 100;
    const demandData = demand.data as { points?: Array<{ predicted: number }>; stale?: boolean } | null;
    const pts = demandData?.points ?? [];

    /**
     * A slope taken across an expired forecast window is a direction about the wrong days.
     *
     * The warehouse model projects forward from the end of its training data, so when that window has
     * already closed these points describe past hours. Reading a gradient across them and reporting
     * it as "surge is rising" would be inventing a trend — so when the forecast is stale the trend is
     * reported as unknown and `predicted` stays at the current multiplier rather than being nudged by
     * a number that means nothing.
     *
     * `current` is unaffected: it comes from live zone signals, not from the forecast.
     */
    const forecastUsable = !sourceUnavailable && !demandData?.stale && pts.length >= 2;
    const slope = forecastUsable
      ? (pts[Math.min(2, pts.length - 1)]!.predicted - pts[0]!.predicted) / Math.max(pts[0]!.predicted, 1)
      : 0;
    const predicted = Math.round(clamp(current * (1 + slope * 0.5), 1, 3) * 100) / 100;
    const trend: "rising" | "falling" | "stable" | "unknown" = !forecastUsable
      ? "unknown"
      : predicted > current * 1.05 ? "rising" : predicted < current * 0.95 ? "falling" : "stable";
    return {
      data: {
        current, predicted, trend,
        expectedDurationMin: trend === "rising" ? 60 : 30,
        zone: signals.zone,
        /** Stated so a caller can tell "no change expected" apart from "we cannot say". */
        // "Stale" and "unavailable" are different causes; a caller must not be told the wrong one.
        trendBasis: forecastUsable ? "demand-forecast" : sourceUnavailable ? DEMAND_FORECAST_UNAVAILABLE : "UNAVAILABLE_STALE_FORECAST",
      },
      confidence: forecastUsable ? (demand.confidence ?? 0.6) * 0.9 : 0,
      freshness: new Date().toISOString(),
      source: forecastUsable ? "geo-intel:surge+demand-forecast" : sourceUnavailable ? "geo-intel:surge (demand forecast unavailable)" : "geo-intel:surge (demand forecast stale)",
    };
  }

  /**
   * Deterministic A/B price-experiment assignment — sticky per customer, and now governed.
   *
   * ── §87, the stop switch ──────────────────────────────────────────────────────
   *
   * This used to assign unconditionally. There was no way to turn it off: the registry row in
   * `platform_experiments` was never consulted, so setting an experiment to `paused` or deleting
   * it entirely changed nothing — every caller kept being bucketed and every exposure kept being
   * counted. A control with no off switch is not a control. The status is now read on every
   * assignment, and anything other than `running` returns control for everybody and records no
   * exposure, so a stopped experiment stops producing data as well as stopping acting.
   *
   * Bucketing itself is unchanged: sha256 over `experiment:customerId`, so the same customer
   * lands in the same arm across restarts without storing an assignment table.
   *
   * ── What is deliberately NOT fixed here ───────────────────────────────────────
   *
   * `priceMultiplier` returns 1.0 for both arms. That is not an oversight introduced here — the
   * previous line read `variant === "treatment" ? 1.0 : 1.0` under a comment claiming the arms
   * differed. They do not, and so the experiment cannot measure anything: any gap between the
   * arms is noise. Making the treatment arm actually move prices would be inventing pricing
   * policy, which is a business decision and not one to smuggle in behind a governance fix. The
   * state is surfaced honestly instead — `differentiated: false` says the arms are identical —
   * and choosing what treatment should do is recorded as a human decision.
   */
  async assignExperiment(
    customerId: string,
    experiment = "surge_v1",
  ): Promise<{
    variant: "control" | "treatment";
    priceMultiplier: number;
    active: boolean;
    differentiated: boolean;
    reason: string;
  }> {
    const registered = await prisma.platformExperiment
      .findUnique({ where: { key: experiment }, select: { status: true } })
      .catch(() => null);

    // Unregistered or not running: everyone gets control, and nothing is counted. An experiment
    // that was never registered has no owner and no stop switch, so it is treated as stopped
    // rather than as running-by-default.
    if (registered?.status !== "running") {
      incCounter("pricing_experiment_suppressed_total", {
        experiment,
        reason: registered ? registered.status : "unregistered",
      });
      return {
        variant: "control",
        priceMultiplier: 1.0,
        active: false,
        differentiated: false,
        reason: registered
          ? `Experiment ${experiment} is ${registered.status}, not running`
          : `Experiment ${experiment} is not registered in platform_experiments`,
      };
    }

    const bucket = parseInt(createHash("sha256").update(`${experiment}:${customerId}`).digest("hex").slice(0, 8), 16) % 100;
    const variant = bucket < 50 ? "control" : "treatment";
    incCounter("pricing_experiment_exposure_total", { experiment, variant });
    return {
      variant,
      // Both arms, identically. See the note above: the treatment behaviour is undecided.
      priceMultiplier: 1.0,
      active: true,
      differentiated: false,
      reason: "Assigned; arms are not yet differentiated, so no effect is measurable",
    };
  }
  recordConversion(experiment: string, variant: "control" | "treatment", revenue: number): void {
    incCounter("pricing_experiment_conversion_total", { experiment, variant });
    observeHist("pricing_experiment_revenue", revenue, { experiment, variant });
  }
}

export const dynamicPricingService = new DynamicPricingService();
