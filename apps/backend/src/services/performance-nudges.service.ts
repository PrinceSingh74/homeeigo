import prisma from "../lib/prisma";
import { AssignmentAttemptStatus, BookingStatus } from "@prisma/client";

/**
 * Performance Nudges — partner-self comparison over authoritative events.
 *
 *
 * WHY THIS DOES NOT READ THE STORED PROVIDER COUNTERS
 * ---------------------------------------------------
 * `Provider` carries `completionRate`, `cancellationRate`, `responseRate`, `avgResponseTime` and
 * `avgCompletionTime`. Measured against live data, only ONE of these is maintained:
 *
 *   - `acceptanceRate` is refreshed by the assignment engine over a 30-day window;
 *   - the others have NO writer anywhere in the codebase, and **160 of 173 providers carry 0** for
 *     all four rates, with a handful sitting at seeded 100s.
 *
 * Coaching a partner from a field nobody updates would mean telling them their completion rate is
 * 0% when they have completed a hundred jobs. Every metric here is therefore computed from the
 * events themselves.
 *
 *
 * DEFINITIONS ARE THE PLATFORM'S, NOT NEW ONES
 * --------------------------------------------
 * `acceptanceRate` reuses the assignment engine's own formula exactly — ACCEPTED over
 * ACCEPTED + REJECTED + TIMEOUT, on `dispatchedAt`. TIMEOUT counts in the denominator because the
 * engine counts it, and inventing a kinder denominator here would mean the number a partner is
 * coached on differs from the number dispatch actually uses.
 *
 * The 30-day window is likewise the platform's, taken from that same function rather than chosen.
 *
 * Completion and cancellation use only PARTNER-ATTRIBUTABLE outcomes: COMPLETED against
 * CANCELLED_BY_PROVIDER. `CANCELLED_BY_USER` is deliberately excluded from both — a partner must
 * never be nudged for a customer's decision.
 *
 *
 * WHY NO ARBITRARY SAMPLE MINIMUM
 * -------------------------------
 * A fixed floor ("at least 20 offers") is a guess. Instead a change is reported only when it
 * exceeds twice the standard error of the difference between the two periods, so the data decides
 * whether it is distinguishable from noise.
 *
 * Proportions are Agresti-Coull adjusted (add two successes and two failures) before that test.
 * Without it, 1/1 gives p=1.0 with zero standard error and ANY difference looks significant — the
 * exact "1 booking became a 100% trend" failure this capability must not have. With it, 1/1 versus
 * 0/1 yields 0.6 versus 0.4 against a threshold of 0.62, and correctly reports nothing.
 *
 * Measured coverage on live data: 29 partners have dispatch history; 15 have >= 10 attempts in both
 * windows and 12 have >= 30. The significance test lets those partners get nudges while the rest
 * correctly receive INSUFFICIENT_HISTORY, without a hard cutoff excluding anyone by fiat.
 */

/** Bump when a definition, window or significance rule changes. */
export const NUDGE_RULES_VERSION = "nudge.rules.v1";

/**
 * The platform's canonical performance window, taken from
 * `assignment-engine.refreshProviderAcceptanceRate` rather than invented. Current period is the
 * last 30 days; the baseline is the 30 days before that.
 */
const WINDOW_DAYS = 30;

/** Two standard errors ~ 95% confidence that a change is not noise. */
const SIGNIFICANCE_SIGMA = 2;

/** Agresti-Coull correction: add two successes and two failures before comparing proportions. */
const AC_ADJUST = 2;

export type NudgeSeverity = "INFO" | "OPPORTUNITY" | "IMPROVEMENT" | "WARNING";

export type MetricCode = "ACCEPTANCE_RATE" | "COMPLETION_RATE" | "PROVIDER_CANCELLATION_RATE" | "AVERAGE_RATING";

export type MetricState = "OK" | "INSUFFICIENT_HISTORY" | "NO_BASELINE";

export type MetricEvidence = {
  metric: MetricCode;
  state: MetricState;
  /** How the number is defined, so the partner and any reviewer see the same denominator. */
  definition: string;
  currentValue: number | null;
  baselineValue: number | null;
  currentSample: number;
  baselineSample: number;
  /** Raw movement the partner sees: current minus baseline, in the metric's own units. */
  change: number | null;
  /**
   * The SHRUNK difference the significance test actually used, on the same scale as
   * `significanceThreshold`.
   *
   * Published because otherwise the result is not recomputable from its own evidence: with 0-of-1
   * against 1-of-1 the raw `change` is 100 points while the threshold is 62, so a reader comparing
   * those two would conclude a trend exists when the service correctly reports none. The
   * Agresti-Coull adjustment shrinks that pair to 40% and 60%, a 20-point difference that does not
   * clear 62 — which is the whole reason a 1-of-1 sample proves nothing.
   */
  adjustedChange: number | null;
  /** Twice the standard error of the difference — the bar `adjustedChange` had to clear. */
  significanceThreshold: number | null;
  significant: boolean;
  period: { currentFrom: string; currentTo: string; baselineFrom: string; baselineTo: string };
  source: string;
  observedAt: string;
  confidence: number | null;
  reasonCode?: string;
};

export type Nudge = {
  metric: MetricCode;
  severity: NudgeSeverity;
  /**
   * Explanatory text. States WHAT changed and never WHY — no causal claim is made from
   * observational metrics, and no intent is attributed to the partner.
   */
  message: string;
  evidence: MetricEvidence;
};

export type NudgeResult = {
  state: "OK" | "INSUFFICIENT_HISTORY" | "PROVIDER_NOT_FOUND";
  rulesVersion: string;
  generatedAt: string;
  windowDays: number;
  nudges: Nudge[];
  /** Every metric considered, including those that produced no nudge and why. */
  metrics: MetricEvidence[];
  reasonCode?: string;
};

type Counts = { numerator: number; denominator: number };

class PerformanceNudgesService {
  /**
   * Compute nudges for ONE partner. Read-only: no transaction, no mutation, no notification.
   *
   * Notification orchestration is deliberately NOT here. A nudge existing is not a reason to send
   * anything — any future automated path must run event/schedule → eligibility → this computation
   * → notification governance → SHADOW, and never call a channel adapter from business logic.
   */
  async compute(providerId: string): Promise<NudgeResult> {
    const now = new Date();
    const generatedAt = now.toISOString();

    const provider = await prisma.provider.findUnique({ where: { id: providerId }, select: { id: true } });
    if (!provider) {
      return {
        state: "PROVIDER_NOT_FOUND",
        rulesVersion: NUDGE_RULES_VERSION,
        generatedAt,
        windowDays: WINDOW_DAYS,
        nudges: [],
        metrics: [],
        reasonCode: "PROVIDER_NOT_FOUND",
      };
    }

    const ms = WINDOW_DAYS * 86_400_000;
    const currentFrom = new Date(now.getTime() - ms);
    const baselineFrom = new Date(now.getTime() - 2 * ms);
    const period = {
      currentFrom: currentFrom.toISOString(),
      currentTo: generatedAt,
      baselineFrom: baselineFrom.toISOString(),
      baselineTo: currentFrom.toISOString(),
    };

    const [acceptance, bookings, ratings] = await Promise.all([
      this.acceptanceCounts(providerId, currentFrom, baselineFrom),
      this.bookingCounts(providerId, currentFrom, baselineFrom),
      this.ratingValues(providerId, currentFrom, baselineFrom),
    ]);

    const metrics: MetricEvidence[] = [
      this.proportionMetric(
        "ACCEPTANCE_RATE",
        "accepted offers / (accepted + rejected + timed-out offers), the assignment engine's own formula",
        acceptance.current,
        acceptance.baseline,
        period,
        "db:assignment_attempts",
        generatedAt,
      ),
      this.proportionMetric(
        "COMPLETION_RATE",
        "completed jobs / (completed + cancelled-by-partner). Customer cancellations are excluded.",
        bookings.completionCurrent,
        bookings.completionBaseline,
        period,
        "db:bookings",
        generatedAt,
      ),
      this.proportionMetric(
        "PROVIDER_CANCELLATION_RATE",
        "cancelled-by-partner / (completed + cancelled-by-partner). Customer cancellations are excluded.",
        bookings.cancelCurrent,
        bookings.cancelBaseline,
        period,
        "db:bookings",
        generatedAt,
      ),
      this.meanMetric(
        "AVERAGE_RATING",
        "mean star rating of ratings received in the period",
        ratings.current,
        ratings.baseline,
        period,
        "db:ratings",
        generatedAt,
      ),
    ];

    const nudges = metrics.filter((m) => m.state === "OK" && m.significant).map((m) => this.toNudge(m));

    return {
      state: metrics.some((m) => m.state === "OK") ? "OK" : "INSUFFICIENT_HISTORY",
      rulesVersion: NUDGE_RULES_VERSION,
      generatedAt,
      windowDays: WINDOW_DAYS,
      nudges,
      metrics,
      ...(metrics.every((m) => m.state !== "OK") ? { reasonCode: "NO_MEASURABLE_HISTORY" } : {}),
    };
  }

  // ---- authoritative event sources ----------------------------------------------------------

  /**
   * Acceptance, using the assignment engine's exact definition. SENT is excluded because the offer
   * is still open — counting a pending offer as a refusal would penalise a partner for time.
   */
  private async acceptanceCounts(providerId: string, currentFrom: Date, baselineFrom: Date) {
    const decided = [
      AssignmentAttemptStatus.ACCEPTED,
      AssignmentAttemptStatus.REJECTED,
      AssignmentAttemptStatus.TIMEOUT,
    ];
    const inWindow = async (from: Date, to?: Date) => {
      const r = await prisma.assignmentAttempt.groupBy({
        by: ["status"],
        where: {
          providerId,
          status: { in: decided },
          dispatchedAt: to ? { gte: from, lt: to } : { gte: from },
        },
        _count: { _all: true },
      });
      const get = (s: AssignmentAttemptStatus) => r.find((x) => x.status === s)?._count._all ?? 0;
      const accepted = get(AssignmentAttemptStatus.ACCEPTED);
      const total = accepted + get(AssignmentAttemptStatus.REJECTED) + get(AssignmentAttemptStatus.TIMEOUT);
      return { numerator: accepted, denominator: total };
    };
    const [current, baseline] = await Promise.all([inWindow(currentFrom), inWindow(baselineFrom, currentFrom)]);
    return { current, baseline };
  }

  /**
   * Completion and partner-cancellation over PARTNER-ATTRIBUTABLE outcomes only.
   *
   * The denominator is completed + cancelled-by-partner. `CANCELLED_BY_USER` appears in neither,
   * because a customer cancelling is not a fact about the partner's performance.
   */
  private async bookingCounts(providerId: string, currentFrom: Date, baselineFrom: Date) {
    const window = async (from: Date, to?: Date) => {
      const range = to ? { gte: from, lt: to } : { gte: from };
      const [completed, cancelledByProvider] = await Promise.all([
        prisma.booking.count({ where: { providerId, status: BookingStatus.COMPLETED, createdAt: range } }),
        prisma.booking.count({
          where: { providerId, status: BookingStatus.CANCELLED_BY_PROVIDER, createdAt: range },
        }),
      ]);
      const attributable = completed + cancelledByProvider;
      return {
        completion: { numerator: completed, denominator: attributable } as Counts,
        cancel: { numerator: cancelledByProvider, denominator: attributable } as Counts,
      };
    };
    const [cur, prev] = await Promise.all([window(currentFrom), window(baselineFrom, currentFrom)]);
    return {
      completionCurrent: cur.completion,
      completionBaseline: prev.completion,
      cancelCurrent: cur.cancel,
      cancelBaseline: prev.cancel,
    };
  }

  private async ratingValues(providerId: string, currentFrom: Date, baselineFrom: Date) {
    const rows = await prisma.rating.findMany({
      where: { providerId, createdAt: { gte: baselineFrom } },
      select: { stars: true, createdAt: true },
    });
    const current = rows.filter((r) => r.createdAt >= currentFrom).map((r) => r.stars);
    const baseline = rows.filter((r) => r.createdAt < currentFrom).map((r) => r.stars);
    return { current, baseline };
  }

  // ---- statistics ----------------------------------------------------------------------------

  /**
   * Compare two proportions with Agresti-Coull adjustment.
   *
   * The adjustment is what stops a 1-of-1 sample reading as a perfect, zero-variance 100%. Without
   * it the standard error collapses to zero and every difference clears the bar.
   */
  private proportionMetric(
    metric: MetricCode,
    definition: string,
    current: Counts,
    baseline: Counts,
    period: MetricEvidence["period"],
    source: string,
    observedAt: string,
  ): MetricEvidence {
    const base: Omit<MetricEvidence, "state" | "currentValue" | "baselineValue" | "change" | "adjustedChange" | "significanceThreshold" | "significant" | "confidence" | "reasonCode"> = {
      metric,
      definition,
      currentSample: current.denominator,
      baselineSample: baseline.denominator,
      period,
      source,
      observedAt,
    };

    // A rate needs something to divide by. Zero offers is NOT a perfect score — the dispatch engine
    // defaults to 100 in that case for routing purposes, and copying that here would congratulate a
    // partner who was never offered work.
    if (current.denominator === 0) {
      return { ...base, state: "INSUFFICIENT_HISTORY", currentValue: null, baselineValue: null, change: null, adjustedChange: null, significanceThreshold: null, significant: false, confidence: null, reasonCode: "NO_EVENTS_IN_CURRENT_PERIOD" };
    }
    const currentValue = Math.round((current.numerator / current.denominator) * 1000) / 10;
    if (baseline.denominator === 0) {
      return { ...base, state: "NO_BASELINE", currentValue, baselineValue: null, change: null, adjustedChange: null, significanceThreshold: null, significant: false, confidence: null, reasonCode: "NO_EVENTS_IN_BASELINE_PERIOD" };
    }
    const baselineValue = Math.round((baseline.numerator / baseline.denominator) * 1000) / 10;

    const p1 = (current.numerator + AC_ADJUST) / (current.denominator + 2 * AC_ADJUST);
    const p2 = (baseline.numerator + AC_ADJUST) / (baseline.denominator + 2 * AC_ADJUST);
    const n1 = current.denominator + 2 * AC_ADJUST;
    const n2 = baseline.denominator + 2 * AC_ADJUST;
    const seDiff = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
    const threshold = SIGNIFICANCE_SIGMA * seDiff;
    const diff = p1 - p2;
    const significant = Math.abs(diff) > threshold && threshold > 0;

    return {
      ...base,
      state: "OK",
      currentValue,
      baselineValue,
      change: Math.round((currentValue - baselineValue) * 10) / 10,
      adjustedChange: Math.round(diff * 1000) / 10,
      significanceThreshold: Math.round(threshold * 1000) / 10,
      significant,
      // Confidence reflects how far the change clears the noise bar, capped well below certainty.
      confidence: significant ? Math.min(0.95, Math.round((Math.abs(diff) / threshold) * 0.5 * 100) / 100) : null,
    };
  }

  /** Compare two means (ratings) using the standard error of the difference of means. */
  private meanMetric(
    metric: MetricCode,
    definition: string,
    current: number[],
    baseline: number[],
    period: MetricEvidence["period"],
    source: string,
    observedAt: string,
  ): MetricEvidence {
    const base = { metric, definition, currentSample: current.length, baselineSample: baseline.length, period, source, observedAt };

    // A mean needs spread to be comparable. One rating has no variance and no standard error, so a
    // single 5.0 must never read as a trend — the brief's explicit negative case.
    if (current.length < 2) {
      return { ...base, state: "INSUFFICIENT_HISTORY", currentValue: current.length === 1 ? current[0] : null, baselineValue: null, change: null, adjustedChange: null, significanceThreshold: null, significant: false, confidence: null, reasonCode: "NEEDS_AT_LEAST_2_RATINGS" };
    }
    if (baseline.length < 2) {
      const mean = current.reduce((s, v) => s + v, 0) / current.length;
      return { ...base, state: "NO_BASELINE", currentValue: Math.round(mean * 100) / 100, baselineValue: null, change: null, adjustedChange: null, significanceThreshold: null, significant: false, confidence: null, reasonCode: "NEEDS_AT_LEAST_2_BASELINE_RATINGS" };
    }

    const meanOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const varOf = (a: number[], m: number) => a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
    const m1 = meanOf(current);
    const m2 = meanOf(baseline);
    const seDiff = Math.sqrt(varOf(current, m1) / current.length + varOf(baseline, m2) / baseline.length);
    const threshold = SIGNIFICANCE_SIGMA * seDiff;
    const diff = m1 - m2;
    const significant = threshold > 0 && Math.abs(diff) > threshold;

    return {
      ...base,
      state: "OK",
      currentValue: Math.round(m1 * 100) / 100,
      baselineValue: Math.round(m2 * 100) / 100,
      change: Math.round((m1 - m2) * 100) / 100,
      // No shrinkage applies to a mean, so the compared difference is the raw one.
      adjustedChange: Math.round((m1 - m2) * 100) / 100,
      significanceThreshold: Math.round(threshold * 100) / 100,
      significant,
      confidence: significant ? Math.min(0.95, Math.round((Math.abs(diff) / threshold) * 0.5 * 100) / 100) : null,
    };
  }

  /**
   * Turn a significant change into a neutral statement.
   *
   * States WHAT moved and by how much, over which sample. Never why. No intent is attributed, and
   * no cause is inferred — these are observational metrics, and a causal claim from them would be
   * unsupported however plausible it sounds.
   */
  private toNudge(m: MetricEvidence): Nudge {
    const improved =
      m.metric === "PROVIDER_CANCELLATION_RATE" ? (m.change ?? 0) < 0 : (m.change ?? 0) > 0;
    const severity: NudgeSeverity = improved ? "IMPROVEMENT" : m.metric === "ACCEPTANCE_RATE" ? "OPPORTUNITY" : "WARNING";

    const label: Record<MetricCode, string> = {
      ACCEPTANCE_RATE: "Your acceptance rate",
      COMPLETION_RATE: "Your completion rate",
      PROVIDER_CANCELLATION_RATE: "Your cancellation rate",
      AVERAGE_RATING: "Your average rating",
    };
    const unit = m.metric === "AVERAGE_RATING" ? "" : "%";
    const direction = (m.change ?? 0) > 0 ? "increased" : "decreased";

    return {
      metric: m.metric,
      severity,
      message:
        `${label[m.metric]} ${direction} from ${m.baselineValue}${unit} to ${m.currentValue}${unit} ` +
        `compared with your previous ${WINDOW_DAYS} days ` +
        `(${m.currentSample} vs ${m.baselineSample} in sample).`,
      evidence: m,
    };
  }
}

export const performanceNudgesService = new PerformanceNudgesService();
