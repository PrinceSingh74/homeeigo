import prisma from "../lib/prisma";
import { partnerIntelligenceService } from "./partner-intelligence.service";
import type { PartnerIntelligenceContext, ZoneCandidate } from "./partner-intelligence.types";

/**
 * Zone Recommendations — deterministic ranking over the canonical context.
 *
 * `partner-intelligence.service` gathers facts and deliberately does not rank. This service ranks
 * them and nothing else: it adds no new platform signal, and every number it emits is traceable to
 * a signal that was already collected, or to this partner's own booking history.
 *
 * No LLM is involved. The score is arithmetic over bounded inputs, and every component is returned
 * as a reason so an explanation can cite evidence instead of inventing it.
 *
 *
 * WHY THIS DOES NOT REUSE `zoneScoring().compositeScore` AS THE ONLY RANKER
 * ------------------------------------------------------------------------
 * Platform composite is now opportunity-weighted (unmet demand first). That fixed the
 * empty-zone inversion for geo-intel UIs. This service still ranks with partner-specific
 * signals (travel, history, surge) that the platform snapshot does not have.
 *
 *
 * WHY THESE DIMENSIONS
 * --------------------
 * Chosen from the observed distribution across live zones rather than from a template:
 *
 *   activeBookings   0..24     real variance      → primary opportunity signal
 *   predictedSurge   1..3      real variance      → deterministic scarcity, already weather-aware
 *   demandDeltaPct   -100..+2300  real variance   → direction of travel, heavily bounded
 *   supply           0..3      low variance       → competition, small weight
 *   distanceKm       partner-specific             → travel cost, only when location is usable
 *   partner history  partner-specific             → personalisation, only above a sample floor
 *
 * `demandScore` and `earningScore` were measured to hold only TWO distinct values (0 or 100) on
 * current data — they are `x / max * 100` over a 24h window, so sparse days collapse them to a
 * binary. They are carried as evidence, never weighted, because a binary dressed as a percentage
 * would make the ranking look precise while adding no information.
 *
 * Weather is NOT a separate dimension: `predictedSurge` already includes `weatherSurge`. Adding it
 * again would double-count the same fact.
 */

/** Bump when a weight, bound or dimension changes. Stamped on every recommendation. */
export const ZONE_RULES_VERSION = "zone.rules.v1";

/**
 * Minimum completed jobs in a zone before this partner's history there is allowed to move the
 * ranking. Below it the dimension reports INSUFFICIENT_HISTORY and is dropped from the weighting —
 * one good job in a zone is not evidence that the zone suits this partner.
 */
export const MIN_ZONE_HISTORY_JOBS = 3;

/** Days of partner history considered for personalisation. */
const HISTORY_WINDOW_DAYS = 90;

/**
 * Dimension weights. They do NOT have to sum over every zone: whatever is unavailable for a given
 * zone is dropped and the remainder is renormalised, so a missing signal reduces confidence instead
 * of silently scoring zero.
 */
const WEIGHTS = {
  UNMET_DEMAND: 0.35,
  SURGE: 0.25,
  DEMAND_TREND: 0.15,
  TRAVEL: 0.15,
  PARTNER_HISTORY: 0.07,
  COMPETITION: 0.03,
} as const;

type DimensionCode = keyof typeof WEIGHTS;

export type ReasonState = "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY";

export type ZoneReason = {
  code: DimensionCode;
  state: ReasonState;
  /** The raw observed input, e.g. 24 active bookings. `null` when unavailable. */
  value: number | null;
  /** This dimension's 0-100 contribution before weighting. `null` when it did not contribute. */
  subScore: number | null;
  weight: number;
  source: string | null;
  observedAt: string | null;
  /** Why it could not contribute. Absent when it did. */
  reasonCode?: string;
};

export type ZoneRecommendation = {
  zoneId: string;
  name: string;
  city: string | null;
  rank: number;
  /** 0-100, weighted mean over the dimensions that were actually available. */
  score: number;
  /** Share of total dimension weight that was available, 0-1. */
  coverage: number;
  confidence: number;
  reasons: ZoneReason[];
  evidence: {
    activeBookings: number | null;
    supply: number | null;
    predictedSurge: number | null;
    weatherSurge: number | null;
    demandDeltaPct: number | null;
    distanceKm: number | null;
    partnerJobsInZone: number;
    partnerEarningsInZone: number;
    /** Platform ops score — carried for traceability, deliberately NOT part of the ranking. */
    platformScore: number | null;
    platformDemandScore: number | null;
    platformEarningScore: number | null;
  };
};

export type ZoneRecommendationResult = {
  state: "OK" | "UNAVAILABLE";
  recommendations: ZoneRecommendation[];
  /** Signals that were missing for the whole request, so a caller can say what was not considered. */
  degraded: string[];
  rulesVersion: string;
  contextRulesVersion: string;
  generatedAt: string;
  reasonCode?: string;
};

/** Clamp to 0-100. */
const pct = (n: number) => Math.max(0, Math.min(100, n));

/** Haversine — same formula as the context layer's, used only for history-to-zone assignment. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

type ZoneHistory = { jobs: number; earnings: number };

class ZoneRecommendationService {
  /**
   * Rank zones for ONE partner.
   *
   * `providerId` must already be resolved from the authenticated actor by the caller. This service
   * never reads an identity from a request, and every partner-scoped query below is filtered by the
   * id it was given.
   */
  async recommend(
    providerId: string,
    opts?: { limit?: number },
  ): Promise<ZoneRecommendationResult> {
    const generatedAt = new Date().toISOString();
    const context = await partnerIntelligenceService.getContext(providerId);

    if (!context) {
      return {
        state: "UNAVAILABLE",
        recommendations: [],
        degraded: ["PROVIDER_NOT_FOUND"],
        rulesVersion: ZONE_RULES_VERSION,
        contextRulesVersion: "",
        generatedAt,
        reasonCode: "PROVIDER_NOT_FOUND",
      };
    }

    const base = {
      rulesVersion: ZONE_RULES_VERSION,
      contextRulesVersion: context.versions.rulesVersion,
      generatedAt,
    };

    if (context.zoneCandidates.state !== "OK" || !context.zoneCandidates.value?.length) {
      // No candidates is not a zero-scored list — there is nothing to rank.
      return {
        state: "UNAVAILABLE",
        recommendations: [],
        degraded: [context.zoneCandidates.reasonCode ?? "NO_ZONE_CANDIDATES"],
        reasonCode: context.zoneCandidates.reasonCode ?? "NO_ZONE_CANDIDATES",
        ...base,
      };
    }

    const candidates = context.zoneCandidates.value;
    const history = await this.loadZoneHistory(providerId, candidates);

    const degraded: string[] = [];
    if (context.location.state !== "OK") degraded.push(`LOCATION_${context.location.reasonCode ?? context.location.state}`);
    if (context.surge.state !== "OK") degraded.push("SURGE_UNAVAILABLE");
    if (context.demand.state !== "OK") degraded.push("DEMAND_UNAVAILABLE");
    if (context.weather.state !== "OK") degraded.push("WEATHER_UNAVAILABLE");

    const surgeById = new Map(
      (context.surge.value ?? []).map((s) => [
        s.zoneId,
        s as unknown as { predictedSurge?: number; weatherSurge?: number; activeBookings?: number; demandDeltaPct?: number | null },
      ]),
    );

    const scored = candidates.map((z) =>
      this.scoreZone(z, surgeById.get(z.zoneId) ?? null, history.get(z.zoneId) ?? { jobs: 0, earnings: 0 }, context),
    );

    /**
     * Deterministic ordering. Score first, then zone id — never insertion order, so the same inputs
     * always produce byte-identical output and ties resolve the same way on every call.
     */
    scored.sort((a, b) => (b.score - a.score) || a.zoneId.localeCompare(b.zoneId));

    const limit = Math.max(1, Math.min(50, opts?.limit ?? 10));
    const recommendations = scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

    return { state: "OK", recommendations, degraded, ...base };
  }

  /**
   * This partner's completed work per zone, in ONE query plus an in-memory assignment.
   *
   * Deliberately fetched here rather than in the context layer: it is zone-scoped personalisation
   * that only the ranker needs, and it depends on which candidates exist. Keeping it here leaves
   * the Item-1 contract untouched.
   *
   * Bookings carry no zone id, so each is assigned to the nearest candidate centre. That is an
   * approximation and is treated as one: it only ever feeds a small-weight dimension that is
   * additionally gated behind a sample-size floor.
   */
  private async loadZoneHistory(
    providerId: string,
    candidates: ZoneCandidate[],
  ): Promise<Map<string, ZoneHistory>> {
    const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.booking.findMany({
      where: { providerId, status: "COMPLETED", createdAt: { gte: since } },
      select: { totalAmount: true, address: { select: { latitude: true, longitude: true } } },
    });

    const centres = candidates.filter((c) => c.centerLat !== 0 || c.centerLng !== 0);
    const map = new Map<string, ZoneHistory>();

    for (const row of rows) {
      if (!row.address) continue;
      let best: { id: string; d: number } | null = null;
      for (const c of centres) {
        const d = distanceKm(row.address.latitude, row.address.longitude, c.centerLat, c.centerLng);
        if (!best || d < best.d) best = { id: c.zoneId, d };
      }
      if (!best) continue;
      const cur = map.get(best.id) ?? { jobs: 0, earnings: 0 };
      cur.jobs += 1;
      cur.earnings += row.totalAmount ?? 0;
      map.set(best.id, cur);
    }
    return map;
  }

  private scoreZone(
    z: ZoneCandidate,
    surge: { predictedSurge?: number; weatherSurge?: number; activeBookings?: number; demandDeltaPct?: number | null } | null,
    hist: ZoneHistory,
    ctx: PartnerIntelligenceContext,
  ): Omit<ZoneRecommendation, "rank"> {
    const reasons: ZoneReason[] = [];
    const surgeSource = ctx.surge.source;
    const surgeAt = ctx.surge.observedAt;

    const add = (
      code: DimensionCode,
      state: ReasonState,
      value: number | null,
      subScore: number | null,
      source: string | null,
      observedAt: string | null,
      reasonCode?: string,
    ) => {
      reasons.push({ code, state, value, subScore, weight: WEIGHTS[code], source, observedAt, ...(reasonCode ? { reasonCode } : {}) });
    };

    // 1. UNMET DEMAND — bookings waiting per available partner. The partner-facing inverse of
    //    the platform's service-health metric.
    const active = surge?.activeBookings ?? null;
    if (active === null) {
      add("UNMET_DEMAND", "UNAVAILABLE", null, null, surgeSource, surgeAt, "NO_ACTIVE_BOOKING_SIGNAL");
    } else {
      const perPartner = active / Math.max(1, z.supply ?? 1);
      // 4+ waiting jobs per available partner is treated as saturated opportunity.
      add("UNMET_DEMAND", "CONTRIBUTED", active, pct((perPartner / 4) * 100), surgeSource, surgeAt);
    }

    // 2. SURGE — deterministic, bounded 1..3 by the surge service, already weather-adjusted.
    const s = surge?.predictedSurge ?? z.predictedSurge ?? null;
    if (s === null) add("SURGE", "UNAVAILABLE", null, null, surgeSource, surgeAt, "NO_SURGE_SIGNAL");
    else add("SURGE", "CONTRIBUTED", s, pct(((s - 1) / 2) * 100), surgeSource, surgeAt);

    // 3. DEMAND TREND — direction of travel, bounded hard because the observed range reaches
    //    +2300%, which would otherwise dominate every other dimension.
    const delta = surge?.demandDeltaPct ?? null;
    if (delta === null) {
      add("DEMAND_TREND", "UNAVAILABLE", null, null, surgeSource, surgeAt, "NO_DEMAND_DELTA");
    } else {
      // -100% → 0, 0% → 50, +100% or more → 100.
      add("DEMAND_TREND", "CONTRIBUTED", delta, pct(50 + delta / 2), surgeSource, surgeAt);
    }

    // 4. TRAVEL — only when the partner's location is usable. A stale fix produces no travel
    //    score at all; assuming zero travel would rank distant zones as if they were next door.
    if (z.distanceKm === null) {
      add("TRAVEL", "UNAVAILABLE", null, null, ctx.location.source, ctx.location.observedAt,
        ctx.location.reasonCode ?? "NO_USABLE_LOCATION");
    } else {
      // 0km → 100, 25km or more → 0.
      add("TRAVEL", "CONTRIBUTED", z.distanceKm, pct(100 - (z.distanceKm / 25) * 100), ctx.location.source, ctx.location.observedAt);
    }

    // 5. PARTNER HISTORY — gated behind a sample floor so a single job cannot personalise a rank.
    if (hist.jobs < MIN_ZONE_HISTORY_JOBS) {
      add("PARTNER_HISTORY", "INSUFFICIENT_HISTORY", hist.jobs, null, "db:bookings", null,
        `NEEDS_${MIN_ZONE_HISTORY_JOBS}_JOBS`);
    } else {
      const perJob = hist.earnings / hist.jobs;
      const avg = ctx.earnings.state === "OK" ? (ctx.earnings.value?.averagePerJob ?? 0) : 0;
      // Relative to this partner's own average job value; 2x their average scores full marks.
      const rel = avg > 0 ? perJob / avg : 1;
      add("PARTNER_HISTORY", "CONTRIBUTED", Math.round(perJob), pct((rel / 2) * 100), "db:bookings", null);
    }

    // 6. COMPETITION — fewer partners already there is better. Small weight: the observed spread
    //    is only 0..3, so it separates little.
    if (z.supply === null) {
      add("COMPETITION", "UNAVAILABLE", null, null, ctx.supply.source, ctx.supply.observedAt, "NO_SUPPLY_SIGNAL");
    } else {
      add("COMPETITION", "CONTRIBUTED", z.supply, pct(100 - Math.min(z.supply, 5) * 20), ctx.supply.source, ctx.supply.observedAt);
    }

    /**
     * Weighted mean over CONTRIBUTED dimensions only, renormalised by the weight actually present.
     * A missing signal therefore lowers `coverage` and `confidence` instead of dragging the score
     * toward zero — the difference between "this zone is poor" and "we could not tell".
     */
    const contributing = reasons.filter((r) => r.state === "CONTRIBUTED" && r.subScore !== null);
    const availableWeight = contributing.reduce((sum, r) => sum + r.weight, 0);
    const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const score =
      availableWeight > 0
        ? Math.round(contributing.reduce((sum, r) => sum + r.subScore! * r.weight, 0) / availableWeight)
        : 0;
    const coverage = Math.round((availableWeight / totalWeight) * 100) / 100;

    // Confidence is capped by the weakest upstream producer that actually contributed.
    const upstream = [ctx.surge.confidence, ctx.supply.confidence].filter((c): c is number => typeof c === "number");
    const confidence = Math.round(coverage * (upstream.length ? Math.min(...upstream) : 1) * 100) / 100;

    return {
      zoneId: z.zoneId,
      name: z.name,
      city: z.city,
      score,
      coverage,
      confidence,
      reasons,
      evidence: {
        activeBookings: active,
        supply: z.supply,
        predictedSurge: s,
        weatherSurge: surge?.weatherSurge ?? null,
        demandDeltaPct: delta,
        distanceKm: z.distanceKm,
        partnerJobsInZone: hist.jobs,
        partnerEarningsInZone: Math.round(hist.earnings),
        platformScore: z.platformScore,
        platformDemandScore: z.demandScore,
        platformEarningScore: z.earningScore,
      },
    };
  }
}

export const zoneRecommendationService = new ZoneRecommendationService();
