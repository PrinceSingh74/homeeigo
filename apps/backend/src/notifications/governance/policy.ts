import type { NotificationCategory } from "@prisma/client";

/**
 * What Phase 6C is allowed to do to a notification, expressed once.
 *
 * Every limit lives here rather than being read from the environment at each call site, so the
 * policy in force is a single readable object and a test can state exactly which numbers it is
 * asserting against.
 */

function envInt(key: string, defaultValue: number, min: number, max: number): number {
  const n = Number(process.env[key]);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v === "true" || v === "1";
}

export const governanceConfig = {
  /**
   * How many automation notifications one recipient may receive in a local calendar day, across
   * every workflow and every channel. Push, email and SMS all draw on this one number — a person
   * who has been messaged five times does not experience it as "only two of them were email".
   */
  recipientDailyCap: envInt("AUTOMATION_RECIPIENT_DAILY_CAP", 5, 1, 100),

  /** Default gap before the same workflow may contact the same recipient again. */
  defaultCooldownMs: envInt(
    "AUTOMATION_WORKFLOW_COOLDOWN_MS",
    24 * 60 * 60 * 1000,
    60_000,
    30 * 24 * 60 * 60 * 1000,
  ),

  /** Quiet window in the recipient's local time, as minutes past midnight. 21:00 → 08:00. */
  quietStartMinute: envInt("AUTOMATION_QUIET_START_MINUTE", 21 * 60, 0, 24 * 60 - 1),
  quietEndMinute: envInt("AUTOMATION_QUIET_END_MINUTE", 8 * 60, 0, 24 * 60 - 1),

  /**
   * Whether mandatory traffic is exempt from cadence and quiet hours.
   *
   * Written down rather than implied, because it is a product decision and not a technical one. A
   * login code at 03:00 is the whole reason the person is awake; a review reminder at 03:00 is
   * not. TRANSACTIONAL and SECURITY are therefore exempt by default, and OPTIONAL never is.
   */
  mandatoryExemptFromCadence: envBool("AUTOMATION_MANDATORY_EXEMPT_CADENCE", true),
  mandatoryExemptFromQuietHours: envBool("AUTOMATION_MANDATORY_EXEMPT_QUIET_HOURS", true),
} as const;

/** Categories the recipient cannot switch off, and which the exemptions above may apply to. */
export function isMandatoryCategory(category: NotificationCategory): boolean {
  return category === "TRANSACTIONAL" || category === "SECURITY";
}

/**
 * Whether governance applies to this category at all.
 *
 * Kept as two separate questions because they are genuinely separate: a policy could well decide
 * that a security alert may wake someone at night but must still not be the ninth message of the
 * day. Collapsing them into one "is mandatory" check would make that impossible to express.
 */
export function cadenceApplies(category: NotificationCategory): boolean {
  if (!isMandatoryCategory(category)) return true;
  return !governanceConfig.mandatoryExemptFromCadence;
}

export function quietHoursApply(category: NotificationCategory): boolean {
  if (!isMandatoryCategory(category)) return true;
  return !governanceConfig.mandatoryExemptFromQuietHours;
}

/** Cooldown for a workflow. One knob today; the shape allows per-workflow values later. */
export function cooldownMsFor(_workflowId: string): number {
  return governanceConfig.defaultCooldownMs;
}

export const GOVERNANCE_DECISION = {
  ALLOWED: "ALLOWED",
  SUPPRESSED_RECIPIENT_DAILY_CAP: "SUPPRESSED_RECIPIENT_DAILY_CAP",
  SUPPRESSED_WORKFLOW_COOLDOWN: "SUPPRESSED_WORKFLOW_COOLDOWN",
  DEFERRED_QUIET_HOURS: "DEFERRED_QUIET_HOURS",
  /** The recipient asked not to be contacted this way. Their decision, not a policy block. */
  PREFERENCE_SUPPRESSED: "PREFERENCE_SUPPRESSED",
  BLOCKED_POLICY: "BLOCKED_POLICY",
  GOVERNANCE_UNAVAILABLE: "GOVERNANCE_UNAVAILABLE",
} as const;

export type GovernanceDecision = (typeof GOVERNANCE_DECISION)[keyof typeof GOVERNANCE_DECISION];

export const GOVERNANCE_REASON = {
  ALLOWED: "ALLOWED",
  RECIPIENT_DAILY_CAP: "RECIPIENT_DAILY_CAP",
  WORKFLOW_COOLDOWN: "WORKFLOW_COOLDOWN",
  QUIET_HOURS: "QUIET_HOURS",
  PREFERENCE_OPTED_OUT: "PREFERENCE_OPTED_OUT",
  MANDATORY_CATEGORY: "MANDATORY_CATEGORY",
  GOVERNANCE_UNAVAILABLE: "GOVERNANCE_UNAVAILABLE",
  POLICY_BLOCKED: "POLICY_BLOCKED",
} as const;

export type GovernanceReason = (typeof GOVERNANCE_REASON)[keyof typeof GOVERNANCE_REASON];

/**
 * The decision each reason belongs to.
 *
 * Pairing them in one table is what stops the audit from ever reading `ALLOWED` next to
 * `RECIPIENT_DAILY_CAP`. A caller picks a reason and the decision follows from it, so the two
 * cannot drift apart in one branch of a long function.
 */
const REASON_TO_DECISION: Record<GovernanceReason, GovernanceDecision> = {
  ALLOWED: GOVERNANCE_DECISION.ALLOWED,
  MANDATORY_CATEGORY: GOVERNANCE_DECISION.ALLOWED,
  RECIPIENT_DAILY_CAP: GOVERNANCE_DECISION.SUPPRESSED_RECIPIENT_DAILY_CAP,
  WORKFLOW_COOLDOWN: GOVERNANCE_DECISION.SUPPRESSED_WORKFLOW_COOLDOWN,
  QUIET_HOURS: GOVERNANCE_DECISION.DEFERRED_QUIET_HOURS,
  /**
   * Distinct from POLICY_BLOCKED on purpose. "The platform refused" and "the recipient asked us
   * not to" read identically in a dashboard that collapses them, and they call for opposite
   * responses: one is something to investigate, the other is the product working correctly.
   */
  PREFERENCE_OPTED_OUT: GOVERNANCE_DECISION.PREFERENCE_SUPPRESSED,
  POLICY_BLOCKED: GOVERNANCE_DECISION.BLOCKED_POLICY,
  GOVERNANCE_UNAVAILABLE: GOVERNANCE_DECISION.GOVERNANCE_UNAVAILABLE,
};

export function decisionFor(reason: GovernanceReason): GovernanceDecision {
  return REASON_TO_DECISION[reason];
}
