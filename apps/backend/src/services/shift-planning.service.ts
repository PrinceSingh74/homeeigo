import { partnerIntelligenceService } from "./partner-intelligence.service";
import { zoneRecommendationService } from "./zone-recommendation.service";
import { earningsCoachService, type TimeWindow } from "./earnings-coach.service";
import { partnerOperationsService } from "./partner-operations.service";
import { parseHmToMinutes } from "../lib/partner-ops-clock";
import type { Freshness } from "./partner-intelligence.types";

/**
 * Smart Shift Planning — advisory only.
 *
 * Answers "when should I work, and where should I start" from signals that already exist. It
 * computes nothing new: context comes from `partner-intelligence`, zones from
 * `zone-recommendation`, windows and feasibility from `earnings-coach`, and availability from
 * `partner-operations`.
 *
 *
 * THIS SERVICE NEVER WRITES
 * -------------------------
 * It imports no availability mutator, opens no transaction, and calls nothing that changes partner
 * state. A recommendation that could flip a partner online is not a recommendation. A structural
 * test asserts the absence of any write dependency, because "we didn't mean to" is not a control.
 *
 *
 * WHY WINDOWS COME FROM HISTORY, NOT FROM THE DEMAND MODEL
 * --------------------------------------------------------
 * The obvious design would pick the hour with the highest predicted demand. Measured against the
 * live model, that is not possible honestly:
 *
 *   - the forecast horizon starts 68 days IN THE PAST (2026-06-20 against a 2026-08-27 clock),
 *     because the ARIMA model forecasts forward from its last training row and has not been
 *     retrained — mapping those hours onto "today" would present a June forecast as today's plan;
 *   - the hourly predictions are flat: min 2.02, max 2.03, a spread of 0.010 across 24 hours,
 *     so there is no peak in the data to find;
 *   - the confidence interval fans from 1.63 to 10.92 over the horizon, i.e. by the end the
 *     interval is several times the prediction itself;
 *   - every point is `zone_id: "unzoned"`, so it cannot inform per-zone timing either.
 *
 * Choosing a "best hour" from a 0.01 spread would be inventing a peak. So demand is reported with
 * an explicit staleness state and excluded from window selection, and windows come from the
 * partner's own history through the earnings coach — where they are already gated behind a
 * measured concentration test. When that history is thin, the answer is INSUFFICIENT_HISTORY.
 */

/** Bump when a threshold, conflict rule or output field changes. */
export const SHIFT_RULES_VERSION = "shift.rules.v1";

/**
 * A demand forecast older than this is not describing today.
 *
 * One day, because the model produces hourly points: once the horizon has fully elapsed the points
 * describe hours that have already happened. This is a reporting threshold, not a filter — the
 * forecast is still returned, labelled, so a caller can see why it was not used for timing.
 */
// Re-exported for existing importers; the single definition now lives in lib/ (leaf) so that
// geo-intelligence can use it without importing this service (that was an import cycle).
import { DEMAND_STALE_AFTER_HOURS, isDemandForecastStale } from "../lib/demand-forecast-freshness";
export { DEMAND_STALE_AFTER_HOURS, isDemandForecastStale };

/** Travel beyond this is called out as a trade-off rather than silently absorbed into a score. */
const FAR_TRAVEL_KM = 15;

export type ShiftState = "OK" | "INSUFFICIENT_DATA" | "PROVIDER_NOT_FOUND";

export type ConflictCode =
  | "HIGH_OPPORTUNITY_FAR_TRAVEL"
  | "STALE_LOCATION_LIMITS_TRAVEL"
  | "NO_LOCATION_LIMITS_TRAVEL"
  | "ACTIVE_JOB_IN_PROGRESS"
  | "WEATHER_UNAVAILABLE"
  | "SEVERE_WEATHER"
  | "DEMAND_FORECAST_STALE"
  | "DEMAND_UNAVAILABLE"
  | "ROUTE_UNAVAILABLE"
  | "OUTSIDE_WORKING_HOURS"
  | "PARTNER_OFFLINE";

export type ShiftConflict = {
  code: ConflictCode;
  /** What the partner should weigh — a trade-off stated, never a decision made for them. */
  detail: string;
  severity: "INFO" | "CAUTION";
};

export type ShiftReason = {
  code: "WINDOWS" | "ZONES" | "AVAILABILITY" | "WEATHER" | "DEMAND" | "LOCATION" | "ACTIVE_JOBS";
  state: "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY" | "STALE";
  value: string | number | null;
  detail: string;
  source: string | null;
  observedAt: string | null;
  /** The context's own freshness vocabulary — reused, never re-declared narrower. */
  freshness: Freshness;
  reasonCode?: string;
};

export type ShiftPlan = {
  state: ShiftState;
  rulesVersion: string;
  contextRulesVersion: string;
  zoneRulesVersion: string;
  coachRulesVersion: string;
  generatedAt: string;

  /** Suggested boundaries, in the partner's declared working hours. Null when unevidenced. */
  recommendedStart: string | null;
  recommendedEnd: string | null;

  /** Hours the partner has historically worked most densely. Empty when history is too thin. */
  recommendedWindows: TimeWindow[];

  /** Where to start and move to, straight from the zone ranker. */
  priorityZones: Array<{ zoneId: string; name: string; score: number; rank: number; distanceKm: number | null }>;

  travelConsiderations: {
    locationState: "LIVE" | "STALE" | "UNAVAILABLE";
    farthestPriorityZoneKm: number | null;
    routeAvailable: boolean;
  };

  /** Trade-offs stated openly rather than folded into a score. */
  conflicts: ShiftConflict[];

  /** Share of planning inputs that were usable, 0-1. */
  coverage: number;
  confidence: number;
  reasons: ShiftReason[];
  degraded: string[];
  reasonCode?: string;
};

class ShiftPlanningService {
  /**
   * Build an advisory shift plan for ONE partner.
   *
   * `providerId` must already be resolved from the authenticated actor. Read-only throughout.
   */
  async plan(providerId: string, opts?: { targetAmount?: number }): Promise<ShiftPlan> {
    const generatedAt = new Date().toISOString();

    const context = await partnerIntelligenceService.getContext(providerId);
    if (!context) {
      return this.empty("PROVIDER_NOT_FOUND", generatedAt, ["PROVIDER_NOT_FOUND"]);
    }

    /**
     * The coach already derives peak hours from this partner's history behind a measured
     * concentration gate. Reusing it is the point — a second implementation would be a second
     * definition of "your best hour". A zero target is passed when the caller has no goal: only
     * `timeWindows` is read from that call.
     */
    const [zoneResult, coach, ops] = await Promise.all([
      zoneRecommendationService.recommend(providerId, { limit: 3 }),
      earningsCoachService.plan(providerId, Math.max(0, opts?.targetAmount ?? 0)),
      partnerOperationsService.snapshot(providerId).catch(() => null),
    ]);

    const reasons: ShiftReason[] = [];
    const conflicts: ShiftConflict[] = [];
    const degraded: string[] = [];

    // ---- LOCATION -------------------------------------------------------------------------
    const locState: "LIVE" | "STALE" | "UNAVAILABLE" =
      context.location.state === "OK"
        ? context.location.value!.freshnessState === "LIVE"
          ? "LIVE"
          : "STALE"
        : context.location.state === "STALE"
          ? "STALE"
          : "UNAVAILABLE";

    reasons.push({
      code: "LOCATION",
      state: context.location.state === "OK" ? "CONTRIBUTED" : context.location.state === "STALE" ? "STALE" : "UNAVAILABLE",
      value: context.location.state === "OK" ? context.location.value!.freshnessState : null,
      detail:
        context.location.state === "OK"
          ? `Position is ${context.location.value!.freshnessState.toLowerCase()} (${context.location.value!.ageSeconds}s old)`
          : "No usable position, so travel distance cannot be judged",
      source: context.location.source,
      observedAt: context.location.observedAt,
      freshness: context.location.freshness,
      ...(context.location.state !== "OK" ? { reasonCode: context.location.reasonCode ?? "NO_LOCATION" } : {}),
    });

    if (locState === "STALE") {
      conflicts.push({
        code: "STALE_LOCATION_LIMITS_TRAVEL",
        detail: "Your last position is old, so travel times to the zones below may not reflect where you are now.",
        severity: "CAUTION",
      });
      degraded.push("LOCATION_STALE");
    } else if (locState === "UNAVAILABLE") {
      conflicts.push({
        code: "NO_LOCATION_LIMITS_TRAVEL",
        detail: "Without a live position, zones are ranked on opportunity only — travel is not considered.",
        severity: "CAUTION",
      });
      degraded.push("LOCATION_UNAVAILABLE");
    }

    // ---- WINDOWS (partner history; never the stale demand model) ---------------------------
    const recommendedWindows = coach.timeWindows;
    reasons.push({
      code: "WINDOWS",
      state: recommendedWindows.length > 0 ? "CONTRIBUTED" : "INSUFFICIENT_HISTORY",
      value: recommendedWindows.length > 0 ? `${recommendedWindows[0].hourOfDay}:00` : null,
      detail:
        recommendedWindows.length > 0
          ? `Your busiest hour historically: ${recommendedWindows[0].jobsInWindow} jobs, ${recommendedWindows[0].concentration}x your average hour`
          : "Your history is not concentrated enough in any hour to recommend a window",
      source: "db:bookings",
      observedAt: null,
      freshness: "HISTORICAL",
      ...(recommendedWindows.length === 0 ? { reasonCode: "NO_HOUR_CONCENTRATION" } : {}),
    });
    if (recommendedWindows.length === 0) degraded.push("NO_TIME_WINDOWS");

    // ---- DEMAND (reported, deliberately not used for timing) -------------------------------
    const demandStale = this.isDemandStale(context.demand.observedAt, context.demand.value);
    if (context.demand.state !== "OK") {
      reasons.push({
        code: "DEMAND",
        state: "UNAVAILABLE",
        value: null,
        detail: "Demand model did not answer",
        source: context.demand.source,
        observedAt: context.demand.observedAt,
        freshness: "UNKNOWN",
        reasonCode: context.demand.reasonCode ?? "DEMAND_UNAVAILABLE",
      });
      conflicts.push({
        code: "DEMAND_UNAVAILABLE",
        detail: "Demand forecasting is unavailable, so timing is based on your own history only.",
        severity: "INFO",
      });
      degraded.push("DEMAND_UNAVAILABLE");
    } else if (demandStale) {
      reasons.push({
        code: "DEMAND",
        state: "STALE",
        value: context.demand.value?.totalPredicted ?? null,
        detail:
          "The demand model's horizon has already elapsed, so it describes past hours and is not used for timing",
        source: context.demand.source,
        observedAt: context.demand.observedAt,
        freshness: "FORECAST",
        reasonCode: "DEMAND_FORECAST_STALE",
      });
      conflicts.push({
        code: "DEMAND_FORECAST_STALE",
        detail:
          "Platform demand forecasting is out of date, so these windows come from your own history rather than predicted demand.",
        severity: "INFO",
      });
      degraded.push("DEMAND_FORECAST_STALE");
    } else {
      reasons.push({
        code: "DEMAND",
        state: "CONTRIBUTED",
        value: context.demand.value?.totalPredicted ?? null,
        detail: "Predicted platform demand over the forecast horizon",
        source: context.demand.source,
        observedAt: context.demand.observedAt,
        freshness: "FORECAST",
      });
    }

    // ---- ZONES ------------------------------------------------------------------------------
    const priorityZones =
      zoneResult.state === "OK"
        ? zoneResult.recommendations.map((z) => ({
            zoneId: z.zoneId,
            name: z.name,
            score: z.score,
            rank: z.rank,
            distanceKm: z.evidence.distanceKm,
          }))
        : [];
    if (zoneResult.state !== "OK") degraded.push(zoneResult.reasonCode ?? "ZONES_UNAVAILABLE");

    reasons.push({
      code: "ZONES",
      state: priorityZones.length > 0 ? "CONTRIBUTED" : "UNAVAILABLE",
      value: priorityZones.length > 0 ? priorityZones[0].name : null,
      detail:
        priorityZones.length > 0
          ? `Start in ${priorityZones[0].name}, scored ${priorityZones[0].score}/100`
          : "Zone opportunity could not be ranked",
      source: "zone.rules.v1",
      observedAt: zoneResult.generatedAt,
      freshness: "NEAR_REAL_TIME",
      ...(priorityZones.length === 0 ? { reasonCode: zoneResult.reasonCode ?? "ZONES_UNAVAILABLE" } : {}),
    });

    // A strong zone that is far away is a trade-off the partner should see, not a hidden penalty.
    const distances = priorityZones.map((z) => z.distanceKm).filter((d): d is number => d !== null);
    const farthest = distances.length > 0 ? Math.max(...distances) : null;
    const topZone = priorityZones[0];
    if (topZone && topZone.distanceKm !== null && topZone.distanceKm > FAR_TRAVEL_KM) {
      conflicts.push({
        code: "HIGH_OPPORTUNITY_FAR_TRAVEL",
        detail: `${topZone.name} scores highest but is ${topZone.distanceKm} km away — the travel may outweigh the difference.`,
        severity: "CAUTION",
      });
    }

    // ---- WEATHER ----------------------------------------------------------------------------
    if (context.weather.state === "OK" && context.weather.value) {
      const w = context.weather.value;
      reasons.push({
        code: "WEATHER",
        state: "CONTRIBUTED",
        value: w.condition,
        detail: `Current conditions: ${w.condition ?? "unknown"}${w.severity ? ` (${w.severity})` : ""}`,
        source: context.weather.source,
        observedAt: context.weather.observedAt,
        freshness: context.weather.freshness,
      });
      // The weather service's own severity drives this — no second weather judgement here.
      if (w.severity && !["clear", "mild"].includes(String(w.severity).toLowerCase())) {
        conflicts.push({
          code: "SEVERE_WEATHER",
          detail: `Conditions are ${w.severity}. Travel may take longer, and surge already reflects this.`,
          severity: "CAUTION",
        });
      }
    } else {
      reasons.push({
        code: "WEATHER",
        state: "UNAVAILABLE",
        value: null,
        detail: "Weather could not be read, so its effect on travel is not accounted for",
        source: context.weather.source,
        observedAt: context.weather.observedAt,
        freshness: "UNKNOWN",
        reasonCode: context.weather.reasonCode ?? "WEATHER_UNAVAILABLE",
      });
      conflicts.push({
        code: "WEATHER_UNAVAILABLE",
        detail: "Weather is unavailable, so conditions are not factored into this plan.",
        severity: "INFO",
      });
      degraded.push("WEATHER_UNAVAILABLE");
    }

    // ---- ACTIVE JOBS ------------------------------------------------------------------------
    const activeCount = context.jobs.state === "OK" ? (context.jobs.value?.activeCount ?? 0) : 0;
    reasons.push({
      code: "ACTIVE_JOBS",
      state: context.jobs.state === "OK" ? "CONTRIBUTED" : "UNAVAILABLE",
      value: context.jobs.state === "OK" ? activeCount : null,
      detail:
        context.jobs.state === "OK"
          ? `${activeCount} job(s) currently in progress or assigned`
          : "Current jobs could not be read",
      source: context.jobs.source,
      observedAt: context.jobs.observedAt,
      freshness: "REAL_TIME",
      ...(context.jobs.state !== "OK" ? { reasonCode: "JOBS_UNAVAILABLE" } : {}),
    });
    if (activeCount > 0) {
      conflicts.push({
        code: "ACTIVE_JOB_IN_PROGRESS",
        detail: `You already have ${activeCount} active job(s); finish those before moving zones.`,
        severity: "INFO",
      });
    }

    // ---- AVAILABILITY: the plan lives inside declared working hours -------------------------
    const startMin = parseHmToMinutes(ops?.workingHoursStart ?? null);
    const endMin = parseHmToMinutes(ops?.workingHoursEnd ?? null);
    const hasHours = startMin !== null && endMin !== null;

    reasons.push({
      code: "AVAILABILITY",
      state: ops ? "CONTRIBUTED" : "UNAVAILABLE",
      value: hasHours ? `${ops!.workingHoursStart}-${ops!.workingHoursEnd}` : null,
      detail: ops
        ? hasHours
          ? `Your declared working hours are ${ops.workingHoursStart}-${ops.workingHoursEnd}`
          : "No working hours declared, so windows are not bounded by a shift"
        : "Availability could not be read",
      source: "db:provider",
      observedAt: null,
      freshness: "STATIC",
      ...(ops ? {} : { reasonCode: "OPS_UNAVAILABLE" }),
    });

    if (ops && ops.isOnline === false) {
      conflicts.push({
        code: "PARTNER_OFFLINE",
        detail: "You are currently offline. This plan is advisory — going online remains your choice.",
        severity: "INFO",
      });
    }

    /**
     * Start and end are chosen from the partner's own busiest hours, then clamped into their
     * declared working hours. Nothing is invented: with no windows there is no recommended start,
     * and a window falling entirely outside declared hours is reported as a conflict rather than
     * silently moved.
     */
    let recommendedStart: string | null = null;
    let recommendedEnd: string | null = null;
    if (recommendedWindows.length > 0) {
      const hours = recommendedWindows.map((w) => w.hourOfDay).sort((a, b) => a - b);
      let firstHour = hours[0];
      let lastHour = hours[hours.length - 1] + 1;

      if (hasHours) {
        const shiftStartHour = Math.floor(startMin! / 60);
        const shiftEndHour = Math.ceil(endMin! / 60);

        /**
         * Any window the declared hours exclude is REPORTED, not silently dropped.
         *
         * Caught by real observation: a partner whose strongest hour was 05:00 (40 jobs, 6.4x
         * their average) had it clamped away by a 09:00-18:00 declaration, and the plan said
         * nothing — the best evidence disappeared into a range boundary. The earlier rule only
         * fired when EVERY window was outside, which is the rarer and less interesting case.
         */
        const excluded = hours.filter((h) => h < shiftStartHour || h >= shiftEndHour);
        if (excluded.length > 0) {
          const list = excluded.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ");
          conflicts.push({
            code: "OUTSIDE_WORKING_HOURS",
            detail:
              excluded.length === hours.length
                ? `All of your busiest hours (${list}) sit outside your declared ${ops!.workingHoursStart}-${ops!.workingHoursEnd} window.`
                : `Your history is strongest at ${list}, which your declared ${ops!.workingHoursStart}-${ops!.workingHoursEnd} window excludes.`,
            severity: "CAUTION",
          });
        }

        if (excluded.length < hours.length) {
          firstHour = Math.max(firstHour, shiftStartHour);
          lastHour = Math.min(lastHour, shiftEndHour);
        }
      }
      recommendedStart = `${String(firstHour).padStart(2, "0")}:00`;
      recommendedEnd = `${String(lastHour).padStart(2, "0")}:00`;
    }

    // ---- COVERAGE + CONFIDENCE --------------------------------------------------------------
    const contributed = reasons.filter((r) => r.state === "CONTRIBUTED").length;
    const coverage = Math.round((contributed / reasons.length) * 100) / 100;
    const upstream = [zoneResult.state === "OK" ? (zoneResult.recommendations[0]?.confidence ?? null) : null].filter(
      (c): c is number => typeof c === "number",
    );
    const confidence = Math.round(coverage * (upstream.length ? Math.min(...upstream) : 1) * 100) / 100;

    // With neither a window nor a zone there is nothing to recommend — say so rather than
    // returning an empty-but-confident-looking plan.
    const state: ShiftState =
      recommendedWindows.length === 0 && priorityZones.length === 0 ? "INSUFFICIENT_DATA" : "OK";

    return {
      state,
      rulesVersion: SHIFT_RULES_VERSION,
      contextRulesVersion: context.versions.rulesVersion,
      zoneRulesVersion: zoneResult.rulesVersion,
      coachRulesVersion: coach.rulesVersion,
      generatedAt,
      recommendedStart,
      recommendedEnd,
      recommendedWindows,
      priorityZones,
      travelConsiderations: {
        locationState: locState,
        farthestPriorityZoneKm: farthest,
        // Route enrichment needs a usable position; without one it is unavailable, not "zero".
        routeAvailable: locState === "LIVE",
      },
      conflicts,
      coverage,
      confidence,
      reasons,
      degraded: [...new Set(degraded)],
      ...(state === "INSUFFICIENT_DATA" ? { reasonCode: "NO_WINDOWS_OR_ZONES" } : {}),
    };
  }

  /**
   * Has the forecast horizon already elapsed?
   *
   * Measured on the live model, the horizon starts 68 days in the past because the ARIMA model
   * forecasts forward from its last training row. A forecast describing hours that have already
   * happened must not be presented as today's timing.
   */
  /** Delegates to the exported rule. Kept as a method so this service's call sites are unchanged. */
  private isDemandStale(observedAt: string | null, value: { points?: unknown[] } | null): boolean {
    return isDemandForecastStale(observedAt, value);
  }

  private empty(state: ShiftState, generatedAt: string, degraded: string[]): ShiftPlan {
    return {
      state,
      rulesVersion: SHIFT_RULES_VERSION,
      contextRulesVersion: "",
      zoneRulesVersion: "",
      coachRulesVersion: "",
      generatedAt,
      recommendedStart: null,
      recommendedEnd: null,
      recommendedWindows: [],
      priorityZones: [],
      travelConsiderations: { locationState: "UNAVAILABLE", farthestPriorityZoneKm: null, routeAvailable: false },
      conflicts: [],
      coverage: 0,
      confidence: 0,
      reasons: [],
      degraded,
      reasonCode: degraded[0],
    };
  }
}

export const shiftPlanningService = new ShiftPlanningService();

