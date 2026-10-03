/**
 * When a partner should be told a zone is under demand pressure — and the fact that nobody has said.
 *
 * ── Why every number here is null ──────────────────────────────────────────────
 *
 * The discovery pass looked for an authoritative surge threshold and found none. Not a weak one, not
 * a hardcoded one: there is no threshold, no hysteresis, no debounce and no business cooldown
 * anywhere in the surge path. The only time-shaped thing near it is the 120 s response cache on
 * `surgePrediction()`, which is a TTL on a computation, not a decision about when a partner is worth
 * interrupting.
 *
 * So a threshold cannot be looked up, and this module refuses to guess one. What it does instead is
 * make the guess impossible: with `threshold: null` the evaluator cannot classify any zone as
 * alert-worthy, and `isSurgeAlertPolicyApproved()` answers false.
 *
 * ── The measured distribution a human should decide against ────────────────────
 *
 * Read from live data on 2026-08-29, seven active zones:
 *
 *   surge 3.00  supply 1  active 5   NCR Gurugram Polygon   (at the clamp ceiling)
 *   surge 2.88  supply 1  active 24  Noida Sector 62
 *   surge 1.47  supply 3  active 4   Delhi Connaught Place
 *   surge 1.00  supply 2  active 1   Smoke Zone — Bangalore
 *   surge 1.00  supply 0  active 0   (three zones)
 *
 * Two properties of that distribution matter more than the numbers.
 *
 * `demandSurge` clamps at 2.5, reached at pressure >= 4.75, so Gurugram's pressure of 5 and Noida's
 * of 24 both saturate — the signal cannot separate busy from overwhelmed above that line. And at
 * supply 1 the multiplier is violently sensitive: one provider coming online moves Gurugram -36%,
 * one leaving moves Noida -44%. A threshold chosen without weighing that will produce an alert
 * stream that toggles on single-provider movements.
 *
 * ── Not derived from the notification cooldown ─────────────────────────────────
 *
 * `governanceConfig.defaultCooldownMs` (24 h) is a limit on how often one workflow may contact one
 * recipient. Surge hysteresis is a different question — how much the *signal* must move before the
 * platform believes the state changed at all — and reusing the notification cooldown as hysteresis
 * would silently answer a question nobody asked. They are kept apart deliberately.
 */

export const SURGE_ALERT_POLICY_STATUS = {
  /** No thresholds decided. The shipped state. */
  UNSET: "UNSET",
  /** Thresholds exist and a human approved them. Reachable only by an explicit code change. */
  APPROVED: "APPROVED",
} as const;

export type SurgeAlertPolicyStatus =
  (typeof SURGE_ALERT_POLICY_STATUS)[keyof typeof SURGE_ALERT_POLICY_STATUS];

export type SurgeAlertPolicy = {
  readonly enabled: boolean;
  /**
   * Minimum `predictedSurge` for a zone to be considered alert-worthy. `null` = undecided.
   *
   * Deliberately expressed against the source's own scale rather than a normalised one, so a human
   * choosing 1.5 can read the measured table above and see which zones that selects today.
   */
  readonly threshold: number | null;
  /**
   * How far the signal must fall below `threshold` before the zone is considered calm again.
   *
   * Separate from `threshold` because a single number produces exactly the flapping the sensitivity
   * measurement predicts: a zone sitting at the line alternates on every provider toggle.
   */
  readonly hysteresis: number | null;
  /** Minimum gap between two alert decisions for the same zone. Not the notification cooldown. */
  readonly cooldownSeconds: number | null;
  readonly status: SurgeAlertPolicyStatus;
};

/**
 * The shipped policy. Every decision field is null, and `enabled` is false.
 *
 * Not environment-driven, for the same reason the morning schedule is not: an env var would let a
 * deployment invent the business decision this module exists to withhold.
 */
export const surgeAlertPolicy: SurgeAlertPolicy = Object.freeze({
  enabled: false,
  threshold: null,
  hysteresis: null,
  cooldownSeconds: null,
  status: SURGE_ALERT_POLICY_STATUS.UNSET,
});

export const SURGE_ALERT_STATE = "DISABLED_UNTIL_POLICY_APPROVED" as const;

export const SURGE_POLICY_REFUSAL = "SURGE_ALERT_POLICY_UNSET" as const;

/**
 * Whether the automation may classify a zone as alert-worthy.
 *
 * All four conditions are required. A threshold without hysteresis is the flapping configuration the
 * measurement warns about; an `enabled` flag without a threshold has nothing to compare against; and
 * `status` is what separates "somebody typed a number" from "somebody decided a number".
 */
export function isSurgeAlertPolicyApproved(
  policy: SurgeAlertPolicy = surgeAlertPolicy,
): boolean {
  return (
    policy.enabled &&
    policy.status === "APPROVED" &&
    policy.threshold !== null &&
    policy.hysteresis !== null &&
    policy.cooldownSeconds !== null
  );
}

export function surgePolicyRefusal(
  policy: SurgeAlertPolicy = surgeAlertPolicy,
): typeof SURGE_POLICY_REFUSAL | null {
  return isSurgeAlertPolicyApproved(policy) ? null : SURGE_POLICY_REFUSAL;
}

/**
 * The named decisions a human still owes this capability.
 *
 * Exported so the state document and the tests quote one list rather than three drifting copies.
 */
export const SURGE_HUMAN_DECISIONS = [
  "SURGE_ALERT_THRESHOLD_REQUIRED",
  "SURGE_HYSTERESIS_POLICY_REQUIRED",
  "SURGE_ALERT_COOLDOWN_REQUIRED",
  "SURGE_TRIGGER_EVENT_SEMANTICS_REQUIRED",
] as const;
