/**
 * Phase 6B — declarative conditions.
 *
 * A condition is data, never code. There is no `eval`, no Function constructor and no expression
 * string that gets interpreted: a condition is a small tagged object that the evaluator walks.
 * That is what makes it safe to store a condition's shape in a frozen workflow definition — a
 * definition can describe a comparison, but it can never introduce behaviour.
 */

export const OPERATORS = [
  "equals",
  "notEquals",
  "greaterThan",
  "lessThan",
  "greaterThanOrEqual",
  "lessThanOrEqual",
  "in",
  "exists",
  "notExists",
] as const;

export type Operator = (typeof OPERATORS)[number];

/** `field` is a two-part path: "<domain>.<field>", e.g. "booking.status". */
export type Comparison = {
  field: string;
  operator: Operator;
  value?: unknown;
};

export type Condition =
  | Comparison
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

/** Why an evaluation came out the way it did. Recorded verbatim in the step audit. */
export const CONDITION_REASON = {
  PASSED: "PASSED",
  FAILED: "FAILED",
  /** No resolver registered for the domain, or the field is not exposed by it. */
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  /** The workflow's subject is not one this resolver is allowed to read. */
  SUBJECT_SCOPE_DENIED: "SUBJECT_SCOPE_DENIED",
  /** Operand types cannot be compared — never coerced, always refused. */
  TYPE_MISMATCH: "TYPE_MISMATCH",
  /** The resolver answered, but its data is older than the condition tolerates. */
  STALE_DATA: "STALE_DATA",
  /**
   * A resolver that declares itself freshness-sensitive answered without usable freshness
   * metadata — absent, malformed, or dated in the future. Distinct from STALE_DATA: there the
   * age was known and too large, here the age could not be established at all.
   */
  FRESHNESS_UNKNOWN: "FRESHNESS_UNKNOWN",
  /** The subject row no longer exists. */
  SUBJECT_NOT_FOUND: "SUBJECT_NOT_FOUND",
  /** Malformed condition — empty branch, unknown operator, bad path. */
  MALFORMED: "MALFORMED",
  RESOLVER_ERROR: "RESOLVER_ERROR",
} as const;

export type ConditionReason = (typeof CONDITION_REASON)[keyof typeof CONDITION_REASON];

export type ConditionResult = {
  /** True only when the condition definitively passed. Every other outcome is false. */
  passed: boolean;
  reason: ConditionReason;
  /** Human-readable trail, e.g. `booking.status equals COMPLETED → CANCELLED_BY_USER`. */
  detail?: string;
  /** Per-field outcomes, for the audit trail. */
  evaluated?: Array<{ field: string; operator: Operator; passed: boolean; reason: ConditionReason }>;
};

/** The subject a workflow instance is bound to. Immutable for the life of the instance. */
export type SubjectRef = {
  subjectType: string;
  subjectId: string;
};

/**
 * What a resolver returns.
 *
 * The freshness fields follow the convention `IntelResult` already established across
 * geo-intelligence, customer-intelligence, digital-twin and dynamic-pricing — `observedAt` for
 * when the underlying fact was true, `generatedAt` for when a derived value was computed, plus a
 * `source`. Reusing that vocabulary means a future weather or demand resolver can hand its
 * existing result straight through instead of translating into a second freshness dialect.
 *
 * A point-in-time transactional read — booking, payment, rating — has no meaningful age. It is
 * the current authoritative state, so it carries no freshness fields and no resolver should
 * pretend otherwise by stamping `observedAt = now`.
 */
export type ResolvedValue = {
  value: unknown;
  /** When the underlying fact was observed. Required when the resolver declares `maxAgeMs`. */
  observedAt?: Date;
  /** When a derived value was computed, where that differs from when it was observed. */
  generatedAt?: Date;
  /** Optional 0–1 score, carried through for audit only — never used to decide freshness. */
  confidence?: number;
  source: string;
};

/**
 * A resolver exposes a fixed, allowlisted set of fields for exactly one domain, and declares which
 * workflow subjects it will answer for.
 *
 * `acceptsSubjectTypes` is the enforcement point for the approved scoping rule: a booking workflow
 * reads its own booking and nothing else. Traversal counts as cross-subject — a payment workflow
 * may not reach into the booking behind its payment, even though the relation is unambiguous.
 * That capability, if ever needed, is a separate resolver with its own authorization.
 */
export type ConditionResolver = {
  domain: string;
  acceptsSubjectTypes: string[];
  fields: string[];
  /** Maximum age this resolver's data may have. Omitted for point-in-time reads. */
  maxAgeMs?: number;
  resolve: (subject: SubjectRef, field: string) => Promise<ResolvedValue | null>;
};
