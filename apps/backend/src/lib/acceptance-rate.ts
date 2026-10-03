/**
 * One definition of "acceptance rate".
 *
 * ── Why this is centralised ──────────────────────────────────────────────────
 *
 * The rate was computed in several places with different denominators and different answers for
 * "no evidence":
 *
 *   - `refreshProviderAcceptanceRate` — ACCEPTED / (ACCEPTED + REJECTED + TIMEOUT) over 30 days,
 *     and correctly writes NOTHING when the window is empty.
 *   - `assignment-engine` dispatch metrics — ACCEPTED / (all attempts − SENT), no time window, and
 *     resolves an empty sample to **0**.
 *   - `metrics-samplers`, `partner-exec-metrics`, `ml-readiness` — their own windows, each also
 *     resolving an empty sample to **0**.
 *   - `hyperlocal-coverage` — `seeded(91, 98)`, a fabricated number shown to customers.
 *
 * Zero and one hundred are both fabrications when the sample is empty, pointing in opposite
 * directions: 0 says "this provider always refuses", 100 says "this provider never refuses". Neither
 * is a measurement. The only honest value is the absence of one, so this returns `null`.
 *
 * Callers that must emit a number (a Prometheus gauge cannot publish null) decide that for
 * themselves at the edge, but they decide it from a value that told them the truth first.
 */
import { AssignmentAttemptStatus } from "@prisma/client";

/** 30 days, matching the window the provider column has always used. */
export const ACCEPTANCE_WINDOW_DAYS = 30;

/**
 * Outcomes that count. SENT is excluded because an offer still waiting for an answer is not a
 * refusal — counting it as one would make every in-flight broadcast depress the rate.
 */
export const ACCEPTANCE_TERMINAL_STATUSES: AssignmentAttemptStatus[] = [
  AssignmentAttemptStatus.ACCEPTED,
  AssignmentAttemptStatus.REJECTED,
  AssignmentAttemptStatus.TIMEOUT,
];

export function acceptanceWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACCEPTANCE_WINDOW_DAYS * 24 * 3600_000);
}

/**
 * Accepted over terminal, as a percentage to two decimals — or `null` when there is nothing to
 * measure. `null` means UNMEASURED and must never be rendered as a number.
 */
export function acceptanceRatePct(accepted: number, terminal: number): number | null {
  if (!Number.isFinite(accepted) || !Number.isFinite(terminal)) return null;
  if (terminal <= 0) return null;
  if (accepted < 0 || accepted > terminal) return null;
  return Math.round((accepted / terminal) * 10000) / 100;
}
