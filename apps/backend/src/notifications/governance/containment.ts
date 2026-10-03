/**
 * A fail-closed stop on notifications from automations whose LIVE authorisation is in question.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Section-01 partner acquisition workflows were certified LIVE and activated by
 * `bootstrapWorkflows()` on every backend boot: the bootstrap wrote its own `AutomationCertification`
 * rows and the sync gate then read the rows it had just written. `certifiedBy` was the hardcoded
 * fallback `system:partner-acquisition`, no delegation was configured, and no human is identifiable
 * anywhere in that chain. Nine workflows reached ACTIVE/LIVE/CERTIFIED that way.
 *
 * By the time it was found, 81 notification-bearing instances were queued, the earliest due within
 * ten hours, each one step away from a real message to a real partner. Three of the nine are held by
 * the fail-closed ESCALATION boundary; the other six carry ordinary NOTIFICATION steps and are held
 * by nothing.
 *
 * ── Why the guard is here and not in the definition ─────────────────────────
 *
 * Moving those definitions to SHADOW does not help, and that was checked before this was written:
 * every one of the 190 pending instances carries `executionMode = LIVE` pinned on its own row, and
 * the step executor reads the instance, not the definition. Work already queued would have run LIVE
 * regardless. A guard at the router is the only place that reaches instances that already exist.
 *
 * It therefore deliberately ignores execution mode, workflow version, channel and provider. The
 * question it asks is only "is this automation's authorisation in question", and if so nothing
 * downstream runs — no cadence is spent, no delivery row is claimed, no adapter is entered.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Not a business-policy decision and not a cleanup. The certifications, definitions, instances and
 * queued jobs are all left exactly as they were, because they are the evidence. This stops the side
 * effect and nothing else. Removing an entry from this list is a human act that belongs with the
 * certification review, not with a deploy.
 */

/** Recorded on the step run so a blocked workflow is visible rather than merely quiet. */
export const CONTAINMENT_REASON = "PARTNER_AUTOMATION_CERTIFICATION_BLOCKED";

/**
 * Automations whose notifications must not leave the system.
 *
 * All nine are listed, not only the six that can currently send: the three ESCALATION-only
 * workflows are protected today by an unimplemented step type, which is a property of the engine
 * rather than a decision about them. If ESCALATION is implemented later, a list that had quietly
 * omitted them would let them start acting on the strength of the same unverified certification.
 */
const CONTAINED_WORKFLOW_IDS = new Set<string>([
  "partner_lead_intake",
  "partner_lead_followup",
  "partner_onboarding_nudge",
  "partner_kyc_reminder",
  "partner_training_reminder",
  "partner_approval_escalation",
  "partner_welcome_journey",
  "partner_application_approved_notify",
  "partner_changes_requested_resume",
  /**
   * Item 6, contained from the moment it exists rather than after a first send.
   *
   * It is already unable to send — SHADOW mode, and an unpublished trigger — so this is a third
   * independent barrier rather than the only one. The value of listing it now is that the day
   * someone certifies it and turns the schedule on, containment is a deliberate removal from this
   * list, not a step nobody remembered was missing.
   */
  "morning_intelligence",
  /** Item 7, contained on arrival for the same reason as Item 6 — a barrier, not the only one. */
  "surge_alert",
]);

/** Whether this automation's notifications are currently withheld pending certification review. */
export function isContainedWorkflow(workflowId: string | undefined | null): boolean {
  return typeof workflowId === "string" && CONTAINED_WORKFLOW_IDS.has(workflowId);
}

/** Exposed so a test can assert the list rather than restate it. */
export function containedWorkflowIds(): string[] {
  return [...CONTAINED_WORKFLOW_IDS].sort();
}
