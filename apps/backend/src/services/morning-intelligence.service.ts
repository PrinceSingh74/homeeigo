import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  resolveRecipientTimeZone,
  windowDateFor,
} from "../notifications/governance/timezone";
import { partnerIntelligenceService } from "./partner-intelligence.service";
import {
  shiftPlanningService,
  SHIFT_RULES_VERSION,
  isDemandForecastStale,
} from "./shift-planning.service";
import { earningsCoachService, EARNINGS_COACH_RULES_VERSION } from "./earnings-coach.service";
import { performanceNudgesService, NUDGE_RULES_VERSION } from "./performance-nudges.service";
import { ZONE_RULES_VERSION } from "./zone-recommendation.service";
import { signalMissing } from "./partner-intelligence.types";
import type { Signal } from "./partner-intelligence.types";
import {
  MORNING_ELIGIBILITY_REASON,
  MORNING_INTELLIGENCE_RULES_VERSION,
} from "./morning-intelligence.types";
import type {
  MorningBrief,
  MorningEarnings,
  MorningEligibility,
  MorningEligibilityReason,
  MorningPerformance,
  MorningZone,
} from "./morning-intelligence.types";

/**
 * Morning Intelligence — the brief, assembled from the services that already own each question.
 *
 * ── What this service is not ───────────────────────────────────────────────────
 *
 * It is not an intelligence engine. It computes no demand, ranks no zones, estimates no earnings and
 * derives no performance metric. Items 1 through 5 each own one of those questions and have their
 * own rules version, their own gating and their own tests; this composes their answers and adds a
 * date, an eligibility check and a coverage figure. Every number in the output can be traced to the
 * service that produced it, which is the property that makes the brief auditable at all.
 *
 * ── Reads only ─────────────────────────────────────────────────────────────────
 *
 * Nothing here writes. No booking, no assignment, no availability, no notification, no workflow
 * instance, no scheduled job. A brief is an opinion about the day, and an opinion that quietly
 * changed the partner's schedule while forming itself would be indistinguishable from a bug. The
 * absence of writes is structural — this module imports no mutating service — rather than a promise.
 */

/**
 * The partner-eligibility composite, taken verbatim from `matching.service.ts`.
 *
 * Deliberately the same six clauses the dispatcher already uses to decide whether a partner may be
 * offered work. Inventing a seventh — "and has been active in the last 14 days", say — would be
 * writing business policy in a briefing service, and the platform would then hold two different
 * answers to "is this a working partner". If the morning brief should reach a narrower set than
 * dispatch does, that is a business decision, and it belongs in the same place the schedule does.
 */
type EligibilityRow = {
  isActive: boolean;
  isApproved: boolean;
  isBanned: boolean;
  complianceRestricted: boolean;
  pausedAt: Date | null;
  user: { isBanned: boolean } | null;
};

function evaluateEligibility(row: EligibilityRow | null): MorningEligibility {
  if (!row) {
    return {
      eligible: false,
      reason: MORNING_ELIGIBILITY_REASON.PROVIDER_NOT_FOUND,
      failedClauses: [MORNING_ELIGIBILITY_REASON.PROVIDER_NOT_FOUND],
    };
  }

  /**
   * Every failing clause is collected, not just the first.
   *
   * A partner who is both paused and compliance-restricted has two different problems with two
   * different owners, and reporting only the one that happened to be checked first sends an operator
   * to fix half of it.
   */
  const failed: MorningEligibilityReason[] = [];
  if (!row.isActive) failed.push(MORNING_ELIGIBILITY_REASON.NOT_ACTIVE);
  if (!row.isApproved) failed.push(MORNING_ELIGIBILITY_REASON.NOT_APPROVED);
  if (row.isBanned) failed.push(MORNING_ELIGIBILITY_REASON.BANNED);
  if (row.user?.isBanned) failed.push(MORNING_ELIGIBILITY_REASON.USER_BANNED);
  if (row.complianceRestricted) failed.push(MORNING_ELIGIBILITY_REASON.COMPLIANCE_RESTRICTED);
  if (row.pausedAt !== null) failed.push(MORNING_ELIGIBILITY_REASON.PAUSED);

  return failed.length === 0
    ? { eligible: true, reason: MORNING_ELIGIBILITY_REASON.ELIGIBLE, failedClauses: [] }
    : { eligible: false, reason: failed[0]!, failedClauses: failed };
}

/** A signal counts toward coverage only when it is genuinely usable. STALE deliberately does not. */
function isUsable(signal: Signal<unknown>): boolean {
  return signal.state === "OK";
}

export const morningIntelligenceService = {
  /**
   * Assemble one partner's brief for their own local date.
   *
   * Eligibility is checked before any intelligence work, so an ineligible partner costs one indexed
   * lookup rather than four service calls. The brief is still returned — with `state: "INELIGIBLE"`
   * and the failing clauses — because "why did this partner get nothing today?" is a question an
   * operator will ask, and an empty result cannot answer it.
   */
  async assembleBrief(
    providerId: string,
    opts?: { now?: Date },
  ): Promise<MorningBrief> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();

    const row = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        isActive: true,
        isApproved: true,
        isBanned: true,
        complianceRestricted: true,
        pausedAt: true,
        user: { select: { isBanned: true } },
      },
    });

    const eligibility = evaluateEligibility(row);
    const tz = await resolveRecipientTimeZone("PARTNER", providerId);
    const localDate = windowDateFor(now, tz.timezone);

    const versions = {
      morningRulesVersion: MORNING_INTELLIGENCE_RULES_VERSION,
      contextRulesVersion: "",
      zoneRulesVersion: null as string | null,
      coachRulesVersion: null as string | null,
      shiftRulesVersion: null as string | null,
      nudgeRulesVersion: null as string | null,
      models: {} as Record<string, string | null>,
    };

    if (!eligibility.eligible) {
      return this.emptyBrief({
        state: row ? "INELIGIBLE" : "PROVIDER_NOT_FOUND",
        eligibility,
        localDate,
        timezone: tz.timezone,
        timezoneFallback: tz.source === "DEFAULT",
        generatedAt,
        versions,
        reasonCodes: eligibility.failedClauses,
      });
    }

    /**
     * The four owners, in parallel.
     *
     * `shiftPlanningService.plan` already composes the zone ranker and the coach internally, so the
     * zones and windows here are the same ones Item 4 would act on rather than a second ranking. The
     * coach is called separately for one reason: `realized` and `feasibility` are ledger facts the
     * shift plan does not surface, and re-deriving them here would be exactly the duplication this
     * service exists to avoid. A target of 0 is passed because no target exists in a morning brief —
     * Item 3 returns `opportunity: null` for it, which is the honest answer, not a missing one.
     */
    const [context, shift, coach, nudges] = await Promise.all([
      partnerIntelligenceService.getContext(providerId).catch((err) => {
        logger.warn("morning_brief_context_failed", { providerId, error: String(err).slice(0, 200) });
        return null;
      }),
      shiftPlanningService.plan(providerId).catch((err) => {
        logger.warn("morning_brief_shift_failed", { providerId, error: String(err).slice(0, 200) });
        return null;
      }),
      earningsCoachService.plan(providerId, 0).catch((err) => {
        logger.warn("morning_brief_coach_failed", { providerId, error: String(err).slice(0, 200) });
        return null;
      }),
      performanceNudgesService.compute(providerId).catch((err) => {
        logger.warn("morning_brief_nudges_failed", { providerId, error: String(err).slice(0, 200) });
        return null;
      }),
    ]);

    const reasonCodes: string[] = [];

    if (!context) {
      return this.emptyBrief({
        state: "PROVIDER_NOT_FOUND",
        eligibility,
        localDate,
        timezone: tz.timezone,
        timezoneFallback: tz.source === "DEFAULT",
        generatedAt,
        versions,
        reasonCodes: ["CONTEXT_UNAVAILABLE"],
      });
    }

    /**
     * Demand freshness is re-checked here, at read time, and the signal downgraded if it has aged.
     *
     * Item 1 builds the demand signal as OK whenever the model returns points; it does not ask
     * whether those points are still about the future. Item 4 asks that question separately and
     * refuses to time a shift on a stale forecast — which is correct, but it left the two views
     * disagreeing: a real observation on 2026-08-28 produced `demand.state = "OK"` alongside
     * `SHIFT_DEMAND_FORECAST_STALE` in the same brief. A consumer reading the signal would have
     * described a forecast whose horizon had already elapsed as this morning's demand.
     *
     * The value is kept, because a stale forecast is still a real measurement and STALE is defined
     * as "aged, value still provided". What changes is that it can no longer be mistaken for
     * current. The rule is imported rather than restated, so there is exactly one definition of
     * stale demand on the platform.
     */
    const demandWasStale =
      context.demand.state === "OK" &&
      isDemandForecastStale(context.demand.observedAt, context.demand.value, now.getTime());

    if (demandWasStale) {
      context.demand = {
        ...context.demand,
        state: "STALE",
        reasonCode: "DEMAND_FORECAST_STALE",
      };
    }

    versions.contextRulesVersion = context.versions.rulesVersion;
    versions.models = context.versions.models;
    versions.zoneRulesVersion = shift?.zoneRulesVersion ?? ZONE_RULES_VERSION;
    versions.coachRulesVersion = coach?.rulesVersion ?? EARNINGS_COACH_RULES_VERSION;
    versions.shiftRulesVersion = shift?.rulesVersion ?? SHIFT_RULES_VERSION;
    versions.nudgeRulesVersion = nudges?.rulesVersion ?? NUDGE_RULES_VERSION;

    /**
     * Missing and aged signals are named, not smoothed.
     *
     * A `STALE` demand forecast is the specific defect Item 4 found in the ARIMA foundation, and the
     * only safe treatment is to say so: the value is still carried (a reader may want it) but the
     * reason code travels with it so nothing downstream can describe a stale forecast as this
     * morning's demand.
     */
    for (const [name, signal] of Object.entries({
      location: context.location,
      demand: context.demand,
      supply: context.supply,
      surge: context.surge,
      weather: context.weather,
      jobs: context.jobs,
      earnings: context.earnings,
      performance: context.performance,
    }) as Array<[string, Signal<unknown>]>) {
      if (signal.state === "OK") continue;
      /**
       * A signal's own reason code wins over a generic one.
       *
       * `DEMAND_FORECAST_STALE` says the horizon elapsed; a synthesised `DEMAND_STALE` would say
       * only that something was old, discarding the part a reader can act on. The generic form is
       * the fallback for producers that state a condition without naming it.
       */
      if (signal.reasonCode) {
        reasonCodes.push(signal.reasonCode);
        continue;
      }
      const upper = name.toUpperCase();
      if (signal.state === "STALE") reasonCodes.push(`${upper}_STALE`);
      else if (signal.state === "MODEL_UNAVAILABLE") reasonCodes.push(`${upper}_MODEL_UNAVAILABLE`);
      else if (signal.state === "INSUFFICIENT_DATA") reasonCodes.push(`${upper}_INSUFFICIENT_DATA`);
      else reasonCodes.push(`${upper}_UNAVAILABLE`);
    }

    if (!shift) reasonCodes.push("SHIFT_PLAN_UNAVAILABLE");
    if (!coach) reasonCodes.push("EARNINGS_COACH_UNAVAILABLE");
    if (!nudges) reasonCodes.push("PERFORMANCE_NUDGES_UNAVAILABLE");
    for (const d of shift?.degraded ?? []) reasonCodes.push(`SHIFT_${d}`);
    for (const d of coach?.degraded ?? []) reasonCodes.push(`COACH_${d}`);

    const topZones: MorningZone[] = (shift?.priorityZones ?? []).map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      score: z.score,
      rank: z.rank,
      distanceKm: z.distanceKm,
    }));

    /**
     * Zones may not be described as "near you now" when the fix is not live.
     *
     * The distance is still reported, because it is a real measurement from a real (if older) fix;
     * what changes is that the reader is told the anchor is stale. Presentation layers key off this
     * code rather than re-deriving location age themselves.
     */
    if (topZones.length > 0 && context.location.state !== "OK") {
      reasonCodes.push("ZONES_NOT_ANCHORED_TO_LIVE_LOCATION");
    }

    const earnings: MorningEarnings = {
      realized: coach?.realized ?? null,
      opportunity: coach?.opportunity
        ? {
            averageNetPerJob: coach.opportunity.averageNetPerJob,
            standardError: coach.opportunity.standardError,
            sampleSize: coach.opportunity.sampleSize,
            confidence: coach.opportunity.confidence,
          }
        : null,
      feasibility: coach?.feasibility
        ? {
            band: coach.feasibility.band,
            typicalJobsPerActiveDay: coach.feasibility.typicalJobsPerActiveDay,
            bestObservedDay: coach.feasibility.bestObservedDay,
          }
        : null,
      degraded: coach?.degraded ?? [],
    };

    const performance: MorningPerformance = nudges
      ? {
          state: nudges.state,
          windowDays: nudges.windowDays,
          nudges: nudges.nudges,
          reasonCode: nudges.reasonCode,
        }
      : {
          state: "INSUFFICIENT_HISTORY",
          windowDays: 0,
          nudges: [],
          reasonCode: "PERFORMANCE_NUDGES_UNAVAILABLE",
        };

    /**
     * Coverage is measured over the eight context signals, and confidence follows from it.
     *
     * Confidence is not a separate judgement: a brief assembled from three usable signals out of
     * eight is less trustworthy than one assembled from eight, and inventing a number that did not
     * move with the inputs would make the field decorative.
     */
    const signals = [
      context.location, context.demand, context.supply, context.surge,
      context.weather, context.jobs, context.earnings, context.performance,
    ];
    const usable = signals.filter(isUsable).length;
    const coverage = signals.length === 0 ? 0 : usable / signals.length;

    const state: MorningBrief["state"] = reasonCodes.length === 0 ? "OK" : "PARTIAL";

    return {
      state,
      localDate,
      timezone: tz.timezone,
      timezoneFallback: tz.source === "DEFAULT",
      partner: context.partner,
      eligibility,
      location: context.location,
      demand: context.demand,
      supply: context.supply,
      surge: context.surge,
      weather: context.weather,
      jobs: context.jobs,
      earningsSignal: context.earnings,
      performanceSignal: context.performance,
      topZones,
      recommendedWindows: shift?.recommendedWindows ?? [],
      recommendedStart: shift?.recommendedStart ?? null,
      recommendedEnd: shift?.recommendedEnd ?? null,
      earnings,
      performance,
      coverage: Number(coverage.toFixed(4)),
      confidence: Number((coverage * (shift?.confidence ?? 1)).toFixed(4)),
      reasonCodes: [...new Set(reasonCodes)].sort(),
      generatedAt,
      versions,
    };
  },

  /** A brief that carries its refusal rather than an empty body pretending to be a quiet morning. */
  emptyBrief(args: {
    state: MorningBrief["state"];
    eligibility: MorningEligibility;
    localDate: string;
    timezone: string;
    timezoneFallback: boolean;
    generatedAt: string;
    versions: MorningBrief["versions"];
    reasonCodes: string[];
  }): MorningBrief {
    const missing = <T>() => signalMissing<T>("UNAVAILABLE", "BRIEF_NOT_ASSEMBLED");
    return {
      state: args.state,
      localDate: args.localDate,
      timezone: args.timezone,
      timezoneFallback: args.timezoneFallback,
      partner: null,
      eligibility: args.eligibility,
      location: missing(),
      demand: missing(),
      supply: missing(),
      surge: missing(),
      weather: missing(),
      jobs: missing(),
      earningsSignal: missing(),
      performanceSignal: missing(),
      topZones: [],
      recommendedWindows: [],
      recommendedStart: null,
      recommendedEnd: null,
      earnings: { realized: null, opportunity: null, feasibility: null, degraded: [] },
      performance: {
        state: "INSUFFICIENT_HISTORY",
        windowDays: 0,
        nudges: [],
        reasonCode: "BRIEF_NOT_ASSEMBLED",
      },
      coverage: 0,
      confidence: 0,
      reasonCodes: [...new Set(args.reasonCodes)].sort(),
      generatedAt: args.generatedAt,
      versions: args.versions,
    };
  },

  /**
   * The brief's logical identity: one per partner per local date per workflow version.
   *
   * Local date rather than UTC date, because a partner in a zone ahead of or behind UTC would
   * otherwise get two briefs on one of their days and none on another. Reused as the idempotency
   * key so "did we already brief this partner today?" has exactly one answer.
   */
  briefIdentity(providerId: string, localDate: string, workflowVersion: number): string {
    return `morning:${providerId}:${localDate}:v${workflowVersion}`;
  },
};
