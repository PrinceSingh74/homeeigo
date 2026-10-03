/**
 * How old is the data this step just read, and is that old enough to matter?
 *
 * ── Why ───────────────────────────────────────────────────────────────────────
 *
 * §35 requires that an agent check freshness before acting on ETA, availability, forecasts,
 * finance, fraud, partner state, ticket state or retrieved knowledge, and that stale data must
 * not be silently acted upon.
 *
 * The failure this prevents is specific and quiet. A zone read returns a cached scoring from
 * forty minutes ago; the supply gap it describes has since closed; the agent resolves the alert
 * that was tracking it. Every control passes — the read succeeded, the write was authorised, the
 * post-condition verifies that the alert is now resolved — and the platform has closed an alert
 * about a condition it never actually re-checked. Verification proves the WRITE happened. It says
 * nothing about whether the evidence behind it was still true.
 *
 * ── The three-valued result, and why UNKNOWN blocks ───────────────────────────
 *
 * FRESH / STALE / UNKNOWN, and UNKNOWN is not a pass. A result carrying no timestamp is a result
 * whose age cannot be established, and treating "I could not tell how old this is" as "it is
 * current" is exactly the rounding-up this codebase refuses everywhere else.
 *
 * UNKNOWN does not fail the read — reads are still returned and still summarised. It withholds
 * one specific thing: the right to be the EVIDENCE FOR A WRITE within the same run.
 */

/**
 * Fields that carry a generation time, in descending order of authority.
 *
 * `freshness` and `generatedAt` come first because the intelligence services set them at the
 * moment the underlying computation ran. `readAt` is last on purpose: the tool adapters stamp it
 * when the handler returned, so it describes when we asked rather than when the answer was made.
 * Preferring it would let a cached forty-minute-old payload present itself as one second old.
 */
const FRESHNESS_FIELDS = [
  "freshness",
  "generatedAt",
  "computedAt",
  "asOf",
  "dataAsOf",
  "lastUpdated",
  "updatedAt",
  "readAt",
] as const;

export type FreshnessVerdict = "FRESH" | "STALE" | "UNKNOWN" | "NOT_REQUIRED";

export type FreshnessAssessment = {
  verdict: FreshnessVerdict;
  /** Which field the timestamp came from, so a disagreement can be traced to its source. */
  field?: string;
  observedAt?: string;
  ageMs?: number;
  maxAgeMs?: number;
  reason?: string;
};

/** Depth ceiling for the search. A deeply nested payload must not turn this into a walk. */
const MAX_SCAN_DEPTH = 3;

/**
 * Find the most authoritative timestamp in a tool result.
 *
 * Searches the top level first, then one nesting level at a time, so a field on the envelope
 * always beats the same field buried inside a sub-layer. A breadth-first walk matters here: the
 * city twin returns `{ data: { layers: { ... } }, freshness }`, and a depth-first search would
 * find a layer's own timestamp before the envelope's.
 */
function findTimestamp(value: unknown): { field: string; iso: string } | null {
  let frontier: unknown[] = [value];

  for (let depth = 0; depth <= MAX_SCAN_DEPTH && frontier.length > 0; depth += 1) {
    const next: unknown[] = [];

    for (const node of frontier) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
      const record = node as Record<string, unknown>;

      for (const field of FRESHNESS_FIELDS) {
        const raw = record[field];
        const iso = coerceIso(raw);
        if (iso) return { field, iso };
      }

      for (const child of Object.values(record)) {
        if (child !== null && typeof child === "object" && !Array.isArray(child)) next.push(child);
      }
    }

    frontier = next;
  }

  return null;
}

/**
 * Accept an ISO string or a Date; reject everything else.
 *
 * Epoch numbers are deliberately NOT accepted. A bare number in one of these fields is as likely
 * to be a count or a score as a millisecond timestamp, and guessing wrong produces a confident
 * age that is off by decades — which would read as FRESH or STALE with equal conviction.
 */
function coerceIso(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  }
  if (typeof raw !== "string" || raw.length < 8) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function assessFreshness(params: {
  result: unknown;
  maxAgeMs?: number;
  now?: number;
}): FreshnessAssessment {
  // A capability that declares no policy is one whose result does not age in a way that could
  // mislead — a knowledge citation, a decision log. Silence here is a decision, not an omission.
  if (params.maxAgeMs === undefined) {
    return { verdict: "NOT_REQUIRED", reason: "Capability declares no freshness requirement" };
  }

  const found = findTimestamp(params.result);
  if (!found) {
    return {
      verdict: "UNKNOWN",
      maxAgeMs: params.maxAgeMs,
      reason: "Result carried no recognisable generation timestamp",
    };
  }

  const now = params.now ?? Date.now();
  const ageMs = now - Date.parse(found.iso);

  /**
   * A timestamp in the future is UNKNOWN, not fresh.
   *
   * Small negative ages are ordinary clock skew between this process and the database, so a
   * second of tolerance absorbs them. Anything beyond that is a payload whose timestamp cannot be
   * trusted in either direction, and "the data is from the future" must never be the reason a
   * write was permitted.
   */
  if (ageMs < -1_000) {
    return {
      verdict: "UNKNOWN",
      field: found.field,
      observedAt: found.iso,
      ageMs,
      maxAgeMs: params.maxAgeMs,
      reason: "Timestamp is in the future; clock disagreement between services",
    };
  }

  const clampedAge = Math.max(0, ageMs);
  return {
    verdict: clampedAge <= params.maxAgeMs ? "FRESH" : "STALE",
    field: found.field,
    observedAt: found.iso,
    ageMs: clampedAge,
    maxAgeMs: params.maxAgeMs,
    reason:
      clampedAge <= params.maxAgeMs
        ? undefined
        : `Data is ${Math.round(clampedAge / 1000)}s old, beyond the ${Math.round(params.maxAgeMs / 1000)}s limit for this capability`,
  };
}

/**
 * Does this assessment disqualify the read from supporting a later write in the same run?
 *
 * STALE and UNKNOWN both do. FRESH and NOT_REQUIRED do not.
 */
export function blocksDownstreamWrite(assessment: FreshnessAssessment): boolean {
  return assessment.verdict === "STALE" || assessment.verdict === "UNKNOWN";
}
