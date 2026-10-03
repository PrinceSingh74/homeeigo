import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { sanitizeInput } from "../ai/security/prompt-security";

/**
 * Phase 9, Capability 6 — fraud narratives.
 *
 * ── The domain never says anyone committed fraud ───────────────────────────────
 *
 * Traced before writing a line of narrative. The authoritative states are:
 *
 *   FraudAlertStatus         OPEN | REVIEWING | RESOLVED | DISMISSED
 *   PartnerRiskReviewStatus  MONITOR | REVIEW | RESTRICT | SUSPEND | CLEARED
 *   FraudRiskLevel           LOW | MEDIUM | HIGH | CRITICAL
 *
 * There is **no CONFIRMED_FRAUD state anywhere**. `RESOLVED` means an alert was closed, not that
 * fraud occurred, and every `PartnerRiskReviewStatus` value is a review disposition rather than a
 * finding. So this service cannot emit a fraud verdict — there is no authoritative state to carry
 * one, and inventing the vocabulary would be inventing the conclusion.
 *
 * Severity and level are different: `riskLevel` is a stored enum written by the risk engine, so
 * reporting "level HIGH" is quoting the domain. Deriving a band from a raw score here would not be.
 *
 * ── Freshness for an event-driven score ────────────────────────────────────────
 *
 * There is no scheduled re-evaluation and no declared TTL: profiles are evaluated from partner
 * events (`evaluateArrival`, `evaluateCompletion`, `evaluateCancellationAbuse`). Age therefore does
 * not mean staleness — a profile last evaluated a month ago is perfectly current if nothing has
 * happened since. Rather than invent a threshold, staleness is measured: a profile is STALE when a
 * risk signal exists that is newer than `lastEvaluatedAt`, because the score demonstrably has not
 * absorbed it.
 *
 * ── Privacy ────────────────────────────────────────────────────────────────────
 *
 * `FraudSignal` carries device fingerprints, IP addresses, user agents, browser fingerprints and
 * coordinates. None of it leaves this service. Signals are reported by type, severity and count;
 * the evidence blob is never passed through, and free text (`reviewNotes`) is sanitised before it
 * can reach a screen or a prompt.
 */

export const FRAUD_NARRATIVE_RULES_VERSION = "exec.fraud.v1";

/** Exactly the authoritative dispositions. No verdict vocabulary exists here. */
export type RiskDisposition = "MONITOR" | "REVIEW" | "RESTRICT" | "SUSPEND" | "CLEARED";

export type NarrativeState =
  | "RISK_PROFILE_PRESENT"
  | "SIGNALS_ONLY"
  | "SOURCE_UNAVAILABLE"
  | "SUBJECT_NOT_FOUND";

export type EvidenceFreshness = "CURRENT" | "STALE" | "UNKNOWN";

export const FRAUD_REASON = {
  NO_PROFILE: "NO_RISK_PROFILE",
  NO_SIGNALS: "NO_RISK_SIGNALS",
  PROFILE_BEHIND_SIGNALS: "PROFILE_BEHIND_SIGNALS",
  NO_EVALUATION_TIMESTAMP: "NO_EVALUATION_TIMESTAMP",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  CONSUMER_FRAUD_SURFACE_EMPTY: "CONSUMER_FRAUD_SURFACE_EMPTY",
} as const;

/** Advisory only. None of these authorises anything. */
export const REVIEW_PROMPTS = {
  REVIEW_CASE: "Review this risk case.",
  REVIEW_PARTNER_ACTIVITY: "Review recent partner activity.",
  REVIEW_PAYMENT_ACTIVITY: "Review recent payment activity.",
  REVIEW_ACCOUNT: "Review this account.",
} as const;

/**
 * Sentences keyed by disposition. Each restates the domain's own status.
 *
 * None asserts a finding, a motive or a cause. "Under review" is what `REVIEW` means; "is committing
 * fraud" is not something any of these states says.
 */
const DISPOSITION_STATEMENTS: Record<RiskDisposition, string> = {
  MONITOR: "This partner is being monitored. No review action has been taken.",
  REVIEW: "This partner is queued for human review. No conclusion has been recorded.",
  RESTRICT: "A restriction has been applied to this partner by a reviewer.",
  SUSPEND: "This partner has been suspended by a reviewer.",
  CLEARED: "A reviewer has cleared this partner.",
};

export type RiskSignalSummary = {
  type: string;
  /** Severity as the risk engine recorded it. Never re-derived. */
  severity: number;
  /** Only when the signal itself carries one. Never invented. */
  confidence: number | null;
  source: string;
  observedAt: string;
};

export type FraudNarrative = {
  subjectType: "PARTNER";
  /** Opaque provider id. No name, contact detail or device identifier is carried. */
  subjectId: string;
  state: NarrativeState;
  /** Stored disposition. Null when no profile exists. */
  disposition: RiskDisposition | null;
  /** Stored band written by the risk engine. Never derived from the score here. */
  riskLevel: string | null;
  riskScore: number | null;
  /** The risk engine's own explanation, sanitised. Never authored here. */
  engineExplanation: string | null;
  signals: RiskSignalSummary[];
  signalCount: number;
  lastEvaluatedAt: string | null;
  /** Newest signal timestamp, used to decide whether the profile has absorbed it. */
  newestSignalAt: string | null;
  freshness: EvidenceFreshness;
  /** Sanitised human review note, when a reviewer left one. */
  reviewNote: string | null;
  reviewedAt: string | null;
  statement: string;
  reviewPrompts: string[];
  /** Always false: this service performs no action, so nothing needs approving. */
  requiresHumanApproval: false;
  reasonCode?: string;
  source: string;
  rulesVersion: string;
  /** No fraud model is published by the domain, so this is null rather than invented. */
  modelVersion: null;
  generatedAt: string;
};

export type ConsumerFraudSurface = {
  alertCount: number;
  scoreCount: number;
  state: "PRESENT" | "EMPTY";
  reasonCode: string;
};

/**
 * Sanitises free text and refuses anything that reads as an instruction.
 *
 * Review notes and engine explanations are written by people and by rules; both reach a screen and
 * would reach a prompt if a model is ever attached. Sanitising at the boundary means every consumer
 * gets the same already-safe value.
 */
function safeText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const cleaned = sanitizeInput(raw);
  return cleaned.length > 0 ? cleaned : null;
}

/** Reads the engine's stored explanation without trusting its shape. */
function explanationText(explanation: unknown): string | null {
  if (explanation == null) return null;
  if (typeof explanation === "string") return safeText(explanation);
  if (typeof explanation === "object") {
    const rec = explanation as Record<string, unknown>;
    for (const key of ["summary", "reason", "text", "explanation"]) {
      const v = rec[key];
      if (typeof v === "string") return safeText(v);
    }
  }
  return null;
}

export const fraudNarrativeService = {
  /**
   * Explain one partner's risk position.
   *
   * Everything is quoted from the risk engine. The only thing computed here is freshness, and that
   * is a comparison of two stored timestamps rather than a judgement.
   */
  async explainPartnerRisk(providerId: string): Promise<FraudNarrative> {
    const generatedAt = new Date().toISOString();
    const shell = {
      subjectType: "PARTNER" as const,
      subjectId: providerId,
      disposition: null,
      riskLevel: null,
      riskScore: null,
      engineExplanation: null,
      signals: [] as RiskSignalSummary[],
      signalCount: 0,
      lastEvaluatedAt: null,
      newestSignalAt: null,
      freshness: "UNKNOWN" as EvidenceFreshness,
      reviewNote: null,
      reviewedAt: null,
      reviewPrompts: [] as string[],
      requiresHumanApproval: false as const,
      source: "db:partner_risk_profiles+partner_risk_signals",
      rulesVersion: FRAUD_NARRATIVE_RULES_VERSION,
      modelVersion: null as null,
      generatedAt,
    };

    let profile: Awaited<ReturnType<typeof prisma.partnerRiskProfile.findUnique>>;
    let signals: Array<{ type: string; severity: number; confidence: number | null; source: string; createdAt: Date }>;
    try {
      [profile, signals] = await Promise.all([
        prisma.partnerRiskProfile.findUnique({ where: { providerId } }),
        prisma.partnerRiskSignal.findMany({
          where: { providerId },
          /**
           * Ordered by the authoritative timestamp, never by id or insertion order — an id ordering
           * would silently become a claim about sequence that the database does not guarantee.
           */
          orderBy: { createdAt: "desc" },
          take: 25,
          select: { type: true, severity: true, confidence: true, source: true, createdAt: true },
        }),
      ]);
    } catch (err) {
      logger.warn("fraud_narrative_source_unavailable", { error: String(err).slice(0, 200) });
      return {
        ...shell,
        state: "SOURCE_UNAVAILABLE",
        statement: "The risk source is unavailable.",
        reasonCode: FRAUD_REASON.SOURCE_UNAVAILABLE,
      };
    }

    const summaries: RiskSignalSummary[] = signals.map((s) => ({
      type: String(s.type),
      severity: s.severity,
      confidence: s.confidence ?? null,
      source: s.source,
      observedAt: s.createdAt.toISOString(),
    }));
    const newestSignalAt = summaries.length > 0 ? summaries[0]!.observedAt : null;

    if (!profile) {
      return {
        ...shell,
        state: summaries.length > 0 ? "SIGNALS_ONLY" : "SUBJECT_NOT_FOUND",
        signals: summaries,
        signalCount: summaries.length,
        newestSignalAt,
        statement: summaries.length > 0
          ? "Risk signals have been recorded for this partner, but no risk profile has been evaluated."
          : "No risk profile or signals exist for this partner.",
        reasonCode: summaries.length > 0 ? FRAUD_REASON.NO_PROFILE : FRAUD_REASON.NO_SIGNALS,
        reviewPrompts: summaries.length > 0 ? [REVIEW_PROMPTS.REVIEW_PARTNER_ACTIVITY] : [],
      };
    }

    const lastEvaluatedAt = profile.lastEvaluatedAt.toISOString();
    /**
     * Freshness is measured, not aged.
     *
     * A profile is stale precisely when a signal exists that it has not seen. Time alone proves
     * nothing for an event-driven score.
     */
    let freshness: EvidenceFreshness;
    let reasonCode: string | undefined;
    if (newestSignalAt === null) {
      freshness = "UNKNOWN";
      reasonCode = FRAUD_REASON.NO_SIGNALS;
    } else if (Date.parse(newestSignalAt) > Date.parse(lastEvaluatedAt)) {
      freshness = "STALE";
      reasonCode = FRAUD_REASON.PROFILE_BEHIND_SIGNALS;
    } else {
      freshness = "CURRENT";
    }

    const disposition = String(profile.reviewStatus) as RiskDisposition;
    const prompts: string[] = [];
    if (disposition === "REVIEW") prompts.push(REVIEW_PROMPTS.REVIEW_CASE);
    if (freshness === "STALE") prompts.push(REVIEW_PROMPTS.REVIEW_PARTNER_ACTIVITY);

    return {
      ...shell,
      state: "RISK_PROFILE_PRESENT",
      disposition,
      riskLevel: String(profile.riskLevel),
      riskScore: profile.riskScore,
      engineExplanation: explanationText(profile.explanation),
      signals: summaries,
      signalCount: summaries.length,
      lastEvaluatedAt,
      newestSignalAt,
      freshness,
      reviewNote: safeText(profile.reviewNotes),
      reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
      statement: DISPOSITION_STATEMENTS[disposition],
      reviewPrompts: prompts,
      ...(reasonCode ? { reasonCode } : {}),
    };
  },

  /** Every partner with a risk profile, ordered by the engine's own review queue semantics. */
  async listPartnerRisk(limit = 25): Promise<FraudNarrative[]> {
    const profiles = await prisma.partnerRiskProfile.findMany({
      orderBy: { lastEvaluatedAt: "desc" },
      take: limit,
      select: { providerId: true },
    });
    return Promise.all(profiles.map((p) => this.explainPartnerRisk(p.providerId)));
  },

  /**
   * Whether the consumer-fraud surface holds anything at all.
   *
   * Reported rather than assumed: `FraudAlert` and `FraudRiskScore` were both empty on live data, and
   * a narrative that silently omitted them would leave a reader assuming there was nothing to report
   * rather than nothing recorded.
   */
  async consumerFraudSurface(): Promise<ConsumerFraudSurface> {
    try {
      const [alertCount, scoreCount] = await Promise.all([
        prisma.fraudAlert.count(),
        prisma.fraudRiskScore.count(),
      ]);
      const present = alertCount > 0 || scoreCount > 0;
      return {
        alertCount,
        scoreCount,
        state: present ? "PRESENT" : "EMPTY",
        reasonCode: present ? "CONSUMER_FRAUD_SURFACE_PRESENT" : FRAUD_REASON.CONSUMER_FRAUD_SURFACE_EMPTY,
      };
    } catch (err) {
      logger.warn("fraud_narrative_consumer_surface_unavailable", { error: String(err).slice(0, 200) });
      return { alertCount: 0, scoreCount: 0, state: "EMPTY", reasonCode: FRAUD_REASON.SOURCE_UNAVAILABLE };
    }
  },

  /** Exposed so tests assert the tables rather than restating them. */
  dispositionStatements(): Readonly<Record<RiskDisposition, string>> {
    return DISPOSITION_STATEMENTS;
  },

  reviewPrompts(): Readonly<Record<string, string>> {
    return REVIEW_PROMPTS;
  },

  sanitize(raw: unknown): string | null {
    return safeText(raw);
  },
};
