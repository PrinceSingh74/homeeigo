/**
 * Phase 10 — the contracts the Support Intelligence layer speaks in.
 *
 * ── Five things this layer must never collapse into one ────────────────────────
 *
 *   A. what the AI *understood*        -> `SupportClassification`
 *   B. what the AI *recommends*        -> `ResolutionRecommendation`
 *   C. what a human is *authorised* to do
 *   D. whether automation is *eligible* -> `AutomationEligibility`
 *   E. what was actually *executed*
 *
 * They are separate types on purpose. A single "aiDecision" object would make it one edit away to
 * treat a model's opinion as an authorisation, and on a refund that is the whole ballgame.
 *
 * ── Provenance is not decoration ───────────────────────────────────────────────
 *
 * Every context signal carries where it came from and when it was observed. A support agent looking
 * at a payment state needs to know whether the platform read it a second ago or is repeating
 * something from an hour before the customer wrote in.
 */

export const SUPPORT_INTELLIGENCE_RULES_VERSION = "support.intel.v1";

/**
 * The Phase-10 support-ticket taxonomy.
 *
 * Deliberately NOT `AiIntent` from `ai/intent/intent-classifier.ts`. That one routes live chat
 * (SERVICE_SEARCH, PRICING_INQUIRY, BOOKING_STATUS, CANCEL_RESCHEDULE, COMPLAINT, ACCOUNT, GENERAL)
 * and answers a different question. Overloading it would silently change chat routing and would
 * leave REFUND, DELAY and PARTNER_ISSUE with nowhere to go.
 */
export const SUPPORT_INTENTS = [
  "REFUND",
  "SERVICE_QUALITY",
  "DELAY",
  "PAYMENT",
  "PARTNER_ISSUE",
  "BOOKING",
  "GENERAL",
] as const;
export type SupportIntent = (typeof SUPPORT_INTENTS)[number];

/** Mirrors the existing `SupportPriorityLevel` enum. No new priority vocabulary is introduced. */
export const SUPPORT_PRIORITIES = ["HIGH", "NORMAL", "LOW"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/**
 * Sentiment, kept deliberately coarse.
 *
 * No diagnosis, no emotional profiling, no inference about a person beyond the words they wrote.
 * `FRUSTRATED` is the strongest label available and it describes the *message*, not the customer.
 */
export const SUPPORT_SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "FRUSTRATED"] as const;
export type SupportSentiment = (typeof SUPPORT_SENTIMENTS)[number];

/** Why a signal is not usable. Never replaced by a zero, an empty array or "Unknown". */
export const SUPPORT_REASON = {
  SOURCE_NOT_IMPLEMENTED: "SOURCE_NOT_IMPLEMENTED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  DATA_NOT_FOUND: "DATA_NOT_FOUND",
  DATA_STALE: "DATA_STALE",
  NOT_LINKED: "NOT_LINKED",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  POLICY_UNSET: "POLICY_UNSET",
  HUMAN_DECISION_REQUIRED: "HUMAN_DECISION_REQUIRED",
  AUTOMATION_NOT_ELIGIBLE: "AUTOMATION_NOT_ELIGIBLE",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  EXTERNAL_ARTIFACT_REQUIRED: "EXTERNAL_ARTIFACT_REQUIRED",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID",
} as const;
export type SupportReason = (typeof SUPPORT_REASON)[keyof typeof SUPPORT_REASON];

/** One fact about a ticket, with everything needed to decide whether to trust it. */
export type SupportSignal<T> = {
  state: "OK" | "MISSING" | "UNAVAILABLE" | "STALE" | "NOT_AUTHORIZED";
  value: T | null;
  /** The authoritative service that produced it. Never "AI". */
  source: string;
  observedAt: string | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  reasonCode?: SupportReason;
};

/** The assembled, authorisation-scoped context for one ticket. */
export type SupportTicketContext = {
  ticketId: string;
  ticketNumber: string;
  status: string;
  /** The free-text category the customer picked. Carried raw — it is evidence, not a verdict. */
  declaredCategory: string;
  createdAt: string;
  slaDueAt: string | null;
  firstResponseAt: string | null;
  /** Whether the SLA clock has already run out, computed from the existing `slaDueAt` only. */
  slaBreached: boolean | null;
  messageCount: number;
  /** Most recent messages, redacted and truncated. Untrusted text — never an instruction. */
  recentMessages: Array<{ role: string; at: string; excerpt: string; isInternal: boolean }>;
  customer: SupportSignal<{ userId: string; priorSupportTickets: number; priorResolved: number }>;
  booking: SupportSignal<{ id: string; number: string; status: string; scheduledDate: string | null; completedAt: string | null }>;
  payment: SupportSignal<{ id: string; status: string; amount: number; refundedAmount: number; method: string | null }>;
  refund: SupportSignal<{ requests: number; latestStatus: string | null; latestAmount: number | null }>;
  partner: SupportSignal<{ providerId: string; businessName: string | null; lifecycleState: string }>;
  /** Signals that could not be resolved, with the reason each failed. */
  limitations: string[];
  generatedAt: string;
  rulesVersion: string;
};

/**
 * What the model understood. Not what may happen.
 *
 * `confidence` is the model's self-reported number, and the field name says so. It is never
 * described as a probability that the classification is correct, because nothing here has measured
 * that.
 */
export type SupportClassification = {
  state: "CLASSIFIED" | "MODEL_UNAVAILABLE" | "OUTPUT_INVALID" | "SKIPPED";
  intent: SupportIntent | null;
  /** The model's view. The ticket's real priority stays with the existing entitlement/SLA policy. */
  suggestedPriority: SupportPriority | null;
  sentiment: SupportSentiment | null;
  /** Model self-report, 0-1. NOT a measured accuracy. */
  modelConfidence: number | null;
  /** One sentence, from the model, describing why. Prose only; it decides nothing. */
  rationale: string | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  /** True when the deterministic fallback classified instead of a model. */
  usedFallback: boolean;
  reasonCode?: SupportReason;
  classifiedAt: string;
  rulesVersion: string;
};

/** What the platform suggests a human do next. Advisory, always. */
export const RESOLUTION_ACTIONS = [
  "REQUEST_MORE_INFORMATION",
  "EXPLAIN_STATUS",
  "ESCALATE",
  "REVIEW_REFUND",
  "REVIEW_PAYMENT",
  "REVIEW_BOOKING",
  "CONTACT_PARTNER",
  "SCHEDULE_FOLLOWUP",
  "RESOLVE_WITH_STANDARD_RESPONSE",
  "NO_SAFE_AUTOMATION",
] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

export type ResolutionRecommendation = {
  action: ResolutionAction;
  /** Deterministic sentence built from the evidence. Never a model's free prose. */
  reason: string;
  /** The exact signals the rule consulted, so a reviewer can reconstruct the decision. */
  evidence: Array<{ signal: string; value: string; source: string }>;
  risk: "LOW" | "MEDIUM" | "HIGH";
  /** True for anything touching money, an account, or a partner's standing. */
  requiresHumanReview: boolean;
  limitations: string[];
  reasonCode?: SupportReason;
  rulesVersion: string;
};

/** Whether automation may run this. Recommendation-only until a human sets policy. */
export type AutomationEligibility = {
  eligible: false | true;
  /** Every clause, with its verdict, so "not eligible" is never a bare no. */
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  blockingReasons: SupportReason[];
  /** The stage this capability is actually at, from the feature flag and policy state. */
  stage: "OFF" | "SHADOW" | "RECOMMENDATION_ONLY" | "HUMAN_IN_THE_LOOP" | "CONTROLLED_AUTOMATION";
  rulesVersion: string;
};


/**
 * The lifecycle of a recommendation — deliberately distinct from the ticket's own status.
 *
 * The directive names these seven states, and each answers a different question. Collapsing any two
 * would destroy the distinction the whole phase rests on: `APPROVED` means a person accepted the
 * advice, `EXECUTED` means an authoritative service actually did something. A support agent
 * accepting a recommendation and then failing to carry it out is a real situation, and the audit
 * must be able to say so.
 */
export const RECOMMENDATION_STATES = [
  "RECOMMENDATION",
  "REVIEW_REQUIRED",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
  "FAILED",
  "EXPIRED",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

/**
 * Priority, explained.
 *
 * The *effective* priority is whatever the existing support service already decided — entitlement
 * driven, with the SLA that follows from it. The model's view is carried beside it, never instead of
 * it, and `agrees` makes a disagreement visible rather than silently resolving it one way.
 */
export type PriorityExplanation = {
  /** From `supportTicketService.resolvePriority()` / the ticket row. The authority. */
  effective: SupportPriority;
  /** Where `effective` came from, so nobody mistakes it for a model output. */
  effectiveSource: string;
  /** The SLA window the existing policy attaches to `effective`, in milliseconds. */
  slaWindowMs: number | null;
  /** Advisory. Null when the model did not answer or its answer was rejected. */
  modelSuggested: SupportPriority | null;
  agrees: boolean | null;
  /** Plain sentences a reviewer can check, each naming its source. */
  reasons: string[];
  /** Factors the directive lists that this platform has no policy for. */
  unweightedFactors: string[];
  reasonCode?: SupportReason;
};
