import { incCounter } from "./metrics";

/** Phase 6E' counters. Labels stay bounded to type, channel and reason. */

export function recordNotificationRouted(type: string, channel: string, status: string): void {
  incCounter("notification_routed_total", { type, channel, status });
}

export function recordNotificationSkipped(type: string, reason: string): void {
  incCounter("notification_skipped_total", { type, reason });
}

export function recordNotificationFailed(type: string, reason: string): void {
  incCounter("notification_failed_total", { type, reason });
}

/**
 * Phase 6C governance counters.
 *
 * Deliberately in this module rather than a new one: cadence, cooldown and quiet hours are
 * decisions about notifications, and splitting them into a parallel metrics system would mean two
 * places to look when asking why a message did not arrive.
 *
 * Labels stay bounded — a notification type, a reason, and for cooldown the workflow that owns the
 * gap. Recipient ids never appear; a per-recipient label would be unbounded cardinality and would
 * also put a person's identity into a metrics store that has no business holding it.
 */

export function recordGovernanceAllowed(type: string): void {
  incCounter("automation_notification_governance_allowed_total", { type });
}

export function recordGovernanceSuppressed(type: string, reason: string): void {
  incCounter("automation_notification_governance_suppressed_total", { type, reason });
}

export function recordDailyCapSuppressed(type: string): void {
  incCounter("automation_notification_daily_cap_total", { type });
}

export function recordCooldownSuppressed(type: string, workflow: string): void {
  incCounter("automation_notification_cooldown_total", { type, workflow });
}

export function recordQuietHoursDeferred(type: string): void {
  incCounter("automation_notification_quiet_hours_deferred_total", { type });
}

export function recordGovernanceError(type: string, reason: string): void {
  incCounter("automation_notification_governance_error_total", { type, reason });
}

/** Phase 6C-E. `decision` is a closed enum, so the label cannot grow unbounded. */

export function recordDecisionAudited(type: string, decision: string): void {
  incCounter("automation_notification_decision_audited_total", { type, decision });
}

/**
 * A decision was taken and could not be written down.
 *
 * Worth its own counter rather than folding into the generic governance-error count: this one means
 * the decision log is incomplete, so any report built from that table is understating what happened.
 */
export function recordDecisionAuditFailed(type: string, decision: string): void {
  incCounter("automation_notification_decision_audit_failed_total", { type, decision });
}
