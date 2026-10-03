import prisma from "../lib/prisma";
import { CREDITED_EARNING_WHERE } from "../lib/earning-settlement";
import { partnerIntelligenceService } from "./partner-intelligence.service";
import { zoneRecommendationService, type ZoneRecommendation } from "./zone-recommendation.service";

/**
 * Earnings Coach — deterministic opportunity planning against a target.
 *
 * Answers "how do I reach ₹3000 today?" with evidence, never with a promise. Nothing here computes
 * earnings: realised amounts come from the earnings ledger through the partner context, and zone
 * opportunity comes from `zone-recommendation.service`. This service only does arithmetic on those
 * facts and says how confident it is.
 *
 *
 * THREE KINDS OF NUMBER, NEVER MIXED
 * ----------------------------------
 *   REALISED     — money already earned. Net, from the earnings ledger. A fact.
 *   OPPORTUNITY  — what the partner's own history says a job is typically worth, applied to a gap.
 *                  An estimate with a stated error, not a forecast of what will happen.
 *   FEASIBILITY  — whether the required job count sits inside what this partner has actually done
 *                  on a day before. A comparison against their record, not a prediction.
 *
 * The output never contains a sentence like "you will earn ₹3000". It contains a gap, a job count
 * with a range, a feasibility band, and the evidence behind each.
 *
 *
 * NET, NOT GROSS
 * --------------
 * Every figure is NET — what the partner receives after commission. On live data gross and net are
 * ~19% apart (562 vs 458), so dividing a net gap by a gross per-job value would understate the jobs
 * required by roughly a fifth. `averageNetPerJob` exists for exactly this reason.
 */

/** Bump when a threshold, band or derived field changes. Stamped on every plan. */
export const EARNINGS_COACH_RULES_VERSION = "coach.rules.v1";

/**
 * Minimum completed jobs before this partner's own average job value may drive a plan.
 *
 * Derived, not picked. The estimate's relative standard error is `CV / sqrt(n)`. Measured across
 * live partners the coefficient of variation of net-per-job is ~0.34 (₹568 mean, ₹192 sd), so:
 *
 *     n = 3  →  relative SE ≈ 20%
 *     n = 6  →  relative SE ≈ 14%
 *
 * Three is the point where a standard deviation becomes computable at all and the error is still
 * quotable, so it is the floor for producing a plan — and it matches the sample floor already
 * established for zone history rather than introducing a second, different threshold.
 * Below it the answer is INSUFFICIENT_HISTORY, not a number with a wide error bar.
 */
export const MIN_JOBS_FOR_PLAN = 3;

/**
 * A peak hour is only called "your best window" when it stands out from the partner's own spread.
 *
 * Requires both: at least `MIN_JOBS_FOR_PLAN` jobs in that hour, AND at least twice the partner's
 * average jobs-per-active-hour. Measured against live partners this admits the one with 40 jobs in
 * a single hour (6.4× their 6.2 average) and correctly refuses the partner whose "peak" is 3 jobs
 * against a 1.75 average — that is noise, and presenting it as a pattern would be fabrication.
 */
const PEAK_HOUR_MULTIPLE = 2;

/** How far back partner history is read. Matches the window used elsewhere in this layer. */
const HISTORY_WINDOW_DAYS = 90;

export type CoachState = "OK" | "INSUFFICIENT_HISTORY" | "PROVIDER_NOT_FOUND" | "TARGET_ALREADY_MET";

export type Feasibility =
  /** The required job count is at or below what this partner does on a typical working day. */
  | "WITHIN_TYPICAL_DAY"
  /** Above typical, but at or below their best observed day. */
  | "REQUIRES_BEST_DAY"
  /** Above anything this partner has completed in a single day in the window. */
  | "ABOVE_OBSERVED_CAPACITY"
  /** Not enough day-level history to compare against. */
  | "UNKNOWN";

export type CoachReason = {
  code:
    | "REALISED_TODAY"
    | "AVG_NET_PER_JOB"
    | "JOBS_NEEDED"
    | "THROUGHPUT"
    | "TIME_WINDOW"
    | "ZONES"
    | "DEMAND";
  state: "CONTRIBUTED" | "UNAVAILABLE" | "INSUFFICIENT_HISTORY";
  value: number | string | null;
  detail: string;
  source: string | null;
  observedAt: string | null;
  reasonCode?: string;
};

export type TimeWindow = {
  hourOfDay: number;
  jobsInWindow: number;
  /** How many times the partner's own average jobs-per-active-hour this represents. */
  concentration: number;
  /** PARTNER when derived from this partner's history; PLATFORM when it is a general pattern. */
  basis: "PARTNER" | "PLATFORM";
};

export type EarningsPlan = {
  state: CoachState;
  rulesVersion: string;
  contextRulesVersion: string;
  generatedAt: string;

  /** Money already earned. Net, from the ledger. Facts, not estimates. */
  realized: {
    today: number;
    trailing7d: number;
    trailing30d: number;
    currency: "INR";
  } | null;

  /** The ask and what remains of it. */
  target: {
    amount: number;
    remainingGap: number;
    alreadyMet: boolean;
  } | null;

  /**
   * What the partner's own history suggests the gap costs in jobs. An estimate with an explicit
   * range — never a statement about what will happen.
   */
  opportunity: {
    averageNetPerJob: number;
    /** Standard error of that average, from this partner's own spread. */
    standardError: number;
    estimatedJobsNeeded: number;
    /** [optimistic, cautious] — derived from the standard error, not invented. */
    jobsNeededRange: [number, number];
    sampleSize: number;
    confidence: number;
  } | null;

  feasibility: {
    band: Feasibility;
    typicalJobsPerActiveDay: number | null;
    bestObservedDay: number | null;
  };

  /** Where the work is, from the Item-2 ranker. Empty when unavailable — never invented. */
  recommendedZones: Array<Pick<ZoneRecommendation, "zoneId" | "name" | "score" | "rank">>;

  /** When this partner has historically worked, if their history supports the claim. */
  timeWindows: TimeWindow[];

  reasons: CoachReason[];
  /** Signals that were missing, so a caller can say what was not considered. */
  degraded: string[];
  reasonCode?: string;
};

type HistoryStats = {
  jobs: number;
  meanNet: number;
  sdNet: number;
  typicalPerActiveDay: number | null;
  bestDay: number | null;
  peakHours: TimeWindow[];
};

class EarningsCoachService {
  /**
   * Build a plan for ONE partner against a target amount.
   *
   * `providerId` must already be resolved from the authenticated actor by the caller. This service
   * reads only — it opens no transaction and writes nothing, so it can never move money.
   */
  async plan(providerId: string, targetAmount: number): Promise<EarningsPlan> {
    const generatedAt = new Date().toISOString();
    const target = Math.max(0, Math.round(targetAmount));

    const context = await partnerIntelligenceService.getContext(providerId);
    if (!context) {
      return this.empty("PROVIDER_NOT_FOUND", generatedAt, "", ["PROVIDER_NOT_FOUND"]);
    }

    const base = { rulesVersion: EARNINGS_COACH_RULES_VERSION, contextRulesVersion: context.versions.rulesVersion };
    const degraded: string[] = [];
    const reasons: CoachReason[] = [];

    // ---- REALISED (facts) -----------------------------------------------------------------
    if (context.earnings.state !== "OK" || !context.earnings.value) {
      // No earnings history at all: there is nothing to base a per-job estimate on, and inventing
      // a platform average would present someone else's history as this partner's.
      return {
        ...this.empty("INSUFFICIENT_HISTORY", generatedAt, context.versions.rulesVersion, [
          context.earnings.reasonCode ?? "NO_EARNINGS_HISTORY",
        ]),
        ...base,
        reasonCode: context.earnings.reasonCode ?? "NO_EARNINGS_HISTORY",
      };
    }

    const e = context.earnings.value;
    const realized = {
      today: e.todayRealised,
      trailing7d: e.trailing7dRealised,
      trailing30d: e.trailing30dRealised,
      currency: "INR" as const,
    };
    reasons.push({
      code: "REALISED_TODAY",
      state: "CONTRIBUTED",
      value: realized.today,
      detail: "Net earnings already credited today",
      source: context.earnings.source,
      observedAt: context.earnings.observedAt,
    });

    const remainingGap = Math.max(0, target - realized.today);
    const alreadyMet = remainingGap === 0 && target > 0;

    // ---- OPPORTUNITY (estimate with a stated error) ---------------------------------------
    const stats = await this.loadHistory(providerId);

    if (stats.jobs < MIN_JOBS_FOR_PLAN) {
      reasons.push({
        code: "AVG_NET_PER_JOB",
        state: "INSUFFICIENT_HISTORY",
        value: stats.jobs,
        detail: `Needs at least ${MIN_JOBS_FOR_PLAN} completed jobs before a per-job estimate is quotable`,
        source: "db:earnings",
        observedAt: null,
        reasonCode: `NEEDS_${MIN_JOBS_FOR_PLAN}_JOBS`,
      });
      return {
        state: "INSUFFICIENT_HISTORY",
        ...base,
        generatedAt,
        realized,
        target: { amount: target, remainingGap, alreadyMet },
        opportunity: null,
        feasibility: { band: "UNKNOWN", typicalJobsPerActiveDay: null, bestObservedDay: null },
        recommendedZones: [],
        timeWindows: [],
        reasons,
        degraded: [...degraded, "INSUFFICIENT_JOB_HISTORY"],
        reasonCode: `NEEDS_${MIN_JOBS_FOR_PLAN}_JOBS`,
      };
    }

    // Standard error of this partner's own mean — the basis for the range, not a guess.
    const standardError = Math.round(stats.sdNet / Math.sqrt(stats.jobs));
    const meanNet = Math.round(stats.meanNet);
    const estimatedJobsNeeded = meanNet > 0 ? Math.ceil(remainingGap / meanNet) : 0;
    const optimistic = meanNet + standardError > 0 ? Math.ceil(remainingGap / (meanNet + standardError)) : 0;
    const cautious = meanNet - standardError > 0 ? Math.ceil(remainingGap / (meanNet - standardError)) : estimatedJobsNeeded;

    /**
     * Confidence falls as the estimate's relative error rises. `1 - relSE` is the share of the
     * estimate not explained by sampling error; clamped so it never reads as certainty.
     */
    const relSE = meanNet > 0 ? standardError / meanNet : 1;
    const confidence = Math.max(0.1, Math.min(0.95, Math.round((1 - relSE) * 100) / 100));

    reasons.push({
      code: "AVG_NET_PER_JOB",
      state: "CONTRIBUTED",
      value: meanNet,
      detail: `Your own net average across ${stats.jobs} completed jobs (±${standardError})`,
      source: "db:earnings",
      observedAt: context.earnings.observedAt,
    });
    reasons.push({
      code: "JOBS_NEEDED",
      state: "CONTRIBUTED",
      value: estimatedJobsNeeded,
      detail: `₹${remainingGap} remaining ÷ ₹${meanNet} typical net per job`,
      source: "derived",
      observedAt: generatedAt,
    });

    // ---- FEASIBILITY (comparison against their own record) ---------------------------------
    const band = this.feasibilityBand(estimatedJobsNeeded, stats);
    reasons.push({
      code: "THROUGHPUT",
      state: stats.bestDay === null ? "INSUFFICIENT_HISTORY" : "CONTRIBUTED",
      value: stats.bestDay,
      detail:
        stats.bestDay === null
          ? "No day-level history to compare against"
          : `You typically complete ${stats.typicalPerActiveDay} jobs on a working day; your best was ${stats.bestDay}`,
      source: "db:bookings",
      observedAt: null,
      ...(stats.bestDay === null ? { reasonCode: "NO_DAY_HISTORY" } : {}),
    });

    // ---- WHERE (reuse the Item-2 ranker; never a second ranking) ---------------------------
    const zoneResult = await zoneRecommendationService.recommend(providerId, { limit: 3 });
    const recommendedZones =
      zoneResult.state === "OK"
        ? zoneResult.recommendations.map((z) => ({ zoneId: z.zoneId, name: z.name, score: z.score, rank: z.rank }))
        : [];
    if (zoneResult.state !== "OK") degraded.push(zoneResult.reasonCode ?? "ZONES_UNAVAILABLE");
    degraded.push(...zoneResult.degraded);

    reasons.push({
      code: "ZONES",
      state: recommendedZones.length > 0 ? "CONTRIBUTED" : "UNAVAILABLE",
      value: recommendedZones.length > 0 ? recommendedZones[0].name : null,
      detail:
        recommendedZones.length > 0
          ? `Highest-opportunity zone right now, scored ${recommendedZones[0].score}/100`
          : "Zone opportunity could not be ranked",
      source: "zone.rules.v1",
      observedAt: zoneResult.generatedAt,
      ...(recommendedZones.length === 0 ? { reasonCode: zoneResult.reasonCode ?? "ZONES_UNAVAILABLE" } : {}),
    });

    // ---- WHEN (only if this partner's own history supports it) -----------------------------
    reasons.push({
      code: "TIME_WINDOW",
      state: stats.peakHours.length > 0 ? "CONTRIBUTED" : "INSUFFICIENT_HISTORY",
      value: stats.peakHours.length > 0 ? `${stats.peakHours[0].hourOfDay}:00` : null,
      detail:
        stats.peakHours.length > 0
          ? `You have completed ${stats.peakHours[0].jobsInWindow} jobs in this hour — ${stats.peakHours[0].concentration}× your average hour`
          : "Your history is not concentrated enough in any hour to call it a pattern",
      source: "db:bookings",
      observedAt: null,
      ...(stats.peakHours.length === 0 ? { reasonCode: "NO_HOUR_CONCENTRATION" } : {}),
    });

    // Demand carried as context, never as a promise of available work.
    reasons.push({
      code: "DEMAND",
      state: context.demand.state === "OK" ? "CONTRIBUTED" : "UNAVAILABLE",
      value: context.demand.state === "OK" ? (context.demand.value?.totalPredicted ?? null) : null,
      detail:
        context.demand.state === "OK"
          ? "Predicted platform demand over the forecast horizon"
          : "Demand model did not answer",
      source: context.demand.source,
      observedAt: context.demand.observedAt,
      ...(context.demand.state !== "OK" ? { reasonCode: context.demand.reasonCode ?? "DEMAND_UNAVAILABLE" } : {}),
    });
    if (context.demand.state !== "OK") degraded.push("DEMAND_UNAVAILABLE");

    return {
      state: alreadyMet ? "TARGET_ALREADY_MET" : "OK",
      ...base,
      generatedAt,
      realized,
      target: { amount: target, remainingGap, alreadyMet },
      opportunity: {
        averageNetPerJob: meanNet,
        standardError,
        estimatedJobsNeeded,
        jobsNeededRange: [Math.min(optimistic, cautious), Math.max(optimistic, cautious)],
        sampleSize: stats.jobs,
        confidence,
      },
      feasibility: {
        band,
        typicalJobsPerActiveDay: stats.typicalPerActiveDay,
        bestObservedDay: stats.bestDay,
      },
      recommendedZones,
      timeWindows: stats.peakHours,
      reasons,
      degraded: [...new Set(degraded)],
    };
  }

  /**
   * This partner's own history: net per job with its spread, day throughput, and hour concentration.
   *
   * Two queries, both partner-scoped, neither in a loop. Net figures come from the earnings ledger
   * (`netEarning`) rather than booking totals, because booking totals are gross.
   */
  private async loadHistory(providerId: string): Promise<HistoryStats> {
    const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);

    const [earnings, dayRows, hourRows] = await Promise.all([
      prisma.earning.findMany({
        where: { providerId, createdAt: { gte: since }, ...CREDITED_EARNING_WHERE },
        select: { netEarning: true },
      }),
      prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM bookings
         WHERE provider_id = $1 AND status = 'COMPLETED' AND created_at >= $2
         GROUP BY DATE(created_at)`,
        providerId,
        since,
      ),
      prisma.$queryRawUnsafe<Array<{ hr: number; n: number }>>(
        `SELECT EXTRACT(HOUR FROM scheduled_date)::int AS hr, COUNT(*)::int AS n FROM bookings
         WHERE provider_id = $1 AND status = 'COMPLETED' AND created_at >= $2
           AND scheduled_date IS NOT NULL
         GROUP BY hr ORDER BY n DESC`,
        providerId,
        since,
      ),
    ]);

    const nets = earnings.map((x) => x.netEarning);
    const jobs = nets.length;
    const meanNet = jobs > 0 ? nets.reduce((s, v) => s + v, 0) / jobs : 0;
    // Population standard deviation of this partner's own job values.
    const sdNet = jobs > 0 ? Math.sqrt(nets.reduce((s, v) => s + (v - meanNet) ** 2, 0) / jobs) : 0;

    const dayCounts = dayRows.map((r) => r.n);
    const typicalPerActiveDay =
      dayCounts.length > 0
        ? Math.round((dayCounts.reduce((s, v) => s + v, 0) / dayCounts.length) * 10) / 10
        : null;
    const bestDay = dayCounts.length > 0 ? Math.max(...dayCounts) : null;

    // An hour is a "window" only if it stands out from this partner's own spread — see
    // PEAK_HOUR_MULTIPLE. Without both tests a 3-job hour would be presented as a pattern.
    const totalHourJobs = hourRows.reduce((s, r) => s + r.n, 0);
    const avgPerActiveHour = hourRows.length > 0 ? totalHourJobs / hourRows.length : 0;
    const peakHours: TimeWindow[] = hourRows
      .filter((r) => r.n >= MIN_JOBS_FOR_PLAN && avgPerActiveHour > 0 && r.n >= avgPerActiveHour * PEAK_HOUR_MULTIPLE)
      .slice(0, 3)
      .map((r) => ({
        hourOfDay: r.hr,
        jobsInWindow: r.n,
        concentration: Math.round((r.n / avgPerActiveHour) * 10) / 10,
        basis: "PARTNER" as const,
      }));

    return { jobs, meanNet, sdNet, typicalPerActiveDay, bestDay, peakHours };
  }

  private feasibilityBand(jobsNeeded: number, stats: HistoryStats): Feasibility {
    if (stats.bestDay === null || stats.typicalPerActiveDay === null) return "UNKNOWN";
    if (jobsNeeded <= stats.typicalPerActiveDay) return "WITHIN_TYPICAL_DAY";
    if (jobsNeeded <= stats.bestDay) return "REQUIRES_BEST_DAY";
    return "ABOVE_OBSERVED_CAPACITY";
  }

  private empty(
    state: CoachState,
    generatedAt: string,
    contextRulesVersion: string,
    degraded: string[],
  ): EarningsPlan {
    return {
      state,
      rulesVersion: EARNINGS_COACH_RULES_VERSION,
      contextRulesVersion,
      generatedAt,
      realized: null,
      target: null,
      opportunity: null,
      feasibility: { band: "UNKNOWN", typicalJobsPerActiveDay: null, bestObservedDay: null },
      recommendedZones: [],
      timeWindows: [],
      reasons: [],
      degraded,
      reasonCode: degraded[0],
    };
  }
}

export const earningsCoachService = new EarningsCoachService();
