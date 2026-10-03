import { registerWorkflow } from "../workflow-registry";
import { EVENT_TYPES } from "../../../events/catalog/event-types";

/**
 * ── These nine declare SHADOW, not LIVE ─────────────────────────────────────
 *
 * They previously declared `executionMode: "LIVE"` and `certificationStatus: "CERTIFIED"`, and the
 * boot path wrote the matching certification rows itself — so the gate read what the same boot had
 * just written and let all nine through. Nine automations reached ACTIVE/LIVE with no human
 * anywhere in the chain, and 81 notification-bearing instances were queued against real leads and
 * real providers before it was found.
 *
 * A definition may describe what a workflow does. It may not decide that the workflow is allowed to
 * do it for real — that is what a certification is, and a certification names a person. Declaring
 * CERTIFIED in code was never authorisation; it only worked because something else supplied the row.
 *
 * Those certifications are now voided. Reaching LIVE again requires a human certification through
 * the hardened `certifyAutomation`, and a deliberate activation outside any startup path.
 */
import {
  PARTNER_APPROVAL_ESCALATION_WORKFLOW,
  PARTNER_APPROVED_NOTIFY_WORKFLOW,
  PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
  PARTNER_KYC_REMINDER_WORKFLOW,
  PARTNER_LEAD_FOLLOWUP_WORKFLOW,
  PARTNER_LEAD_INTAKE_WORKFLOW,
  PARTNER_ONBOARDING_NUDGE_WORKFLOW,
  PARTNER_TRAINING_REMINDER_WORKFLOW,
  PARTNER_WELCOME_WORKFLOW,
} from "./partner-acquisition-workflow-ids";

export {
  PARTNER_APPROVAL_ESCALATION_WORKFLOW,
  PARTNER_APPROVED_NOTIFY_WORKFLOW,
  PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
  PARTNER_KYC_REMINDER_WORKFLOW,
  PARTNER_LEAD_FOLLOWUP_WORKFLOW,
  PARTNER_LEAD_INTAKE_WORKFLOW,
  PARTNER_ONBOARDING_NUDGE_WORKFLOW,
  PARTNER_TRAINING_REMINDER_WORKFLOW,
  PARTNER_WELCOME_WORKFLOW,
} from "./partner-acquisition-workflow-ids";

/** Partner acquisition automations — LIVE after certification bootstrap. */

export function registerPartnerAcquisitionWorkflows(): void {
  registerWorkflow({
    workflowId: PARTNER_LEAD_INTAKE_WORKFLOW,
    version: 1,
    name: "Partner lead intake",
    trigger: EVENT_TYPES.PARTNER_LEAD_CREATED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_30m", type: "WAIT", delayMs: 30 * 60_000 },
      { id: "check_unassigned", type: "CONDITION", conditionId: "partnerLead.unassigned" },
      { id: "escalate", type: "ESCALATION", target: "acquisition.assign_queue", reasonCode: "LEAD_NEEDS_ASSIGNMENT" },
      { id: "done", type: "STOP", reasonCode: "LEAD_INTAKE_COMPLETE" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_LEAD_FOLLOWUP_WORKFLOW,
    version: 1,
    name: "Partner lead follow-up",
    trigger: EVENT_TYPES.PARTNER_LEAD_CREATED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_48h", type: "WAIT", delayMs: 48 * 3_600_000 },
      { id: "check_stale", type: "CONDITION", conditionId: "partnerLead.stale_pipeline" },
      { id: "escalate", type: "ESCALATION", target: "acquisition.followup_queue", reasonCode: "LEAD_FOLLOWUP_DUE" },
      { id: "done", type: "STOP", reasonCode: "LEAD_FOLLOWUP_COMPLETE" },
    ],
    maxAgeMs: 96 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_ONBOARDING_NUDGE_WORKFLOW,
    version: 1,
    name: "Partner onboarding resume",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_STARTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_24h", type: "WAIT", delayMs: 24 * 3_600_000 },
      { id: "check_incomplete", type: "CONDITION", conditionId: "provider.onboarding_incomplete" },
      {
        id: "nudge",
        type: "NOTIFICATION",
        notificationType: "partner.onboarding_resume",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.onboarding_incomplete",
      },
      { id: "done", type: "STOP", reasonCode: "ONBOARDING_NUDGE_SENT" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_KYC_REMINDER_WORKFLOW,
    version: 1,
    name: "Partner KYC reminder",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_STARTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_48h", type: "WAIT", delayMs: 48 * 3_600_000 },
      { id: "check_kyc", type: "CONDITION", conditionId: "provider.kyc_incomplete" },
      {
        id: "remind",
        type: "NOTIFICATION",
        notificationType: "partner.kyc_reminder",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.kyc_incomplete",
      },
      { id: "done", type: "STOP", reasonCode: "KYC_REMINDER_SENT" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "compliance", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_TRAINING_REMINDER_WORKFLOW,
    version: 1,
    name: "Partner training reminder",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_48h", type: "WAIT", delayMs: 48 * 3_600_000 },
      { id: "check_training", type: "CONDITION", conditionId: "provider.training_incomplete" },
      {
        id: "remind",
        type: "NOTIFICATION",
        notificationType: "partner.training_reminder",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.training_incomplete",
      },
      { id: "done", type: "STOP", reasonCode: "TRAINING_REMINDER_SENT" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "academy", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_APPROVAL_ESCALATION_WORKFLOW,
    version: 1,
    name: "Partner approval escalation",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_24h", type: "WAIT", delayMs: 24 * 3_600_000 },
      { id: "check_pending", type: "CONDITION", conditionId: "provider.approval_pending" },
      { id: "escalate", type: "ESCALATION", target: "admin.approval_queue", reasonCode: "APPROVAL_PENDING" },
      { id: "done", type: "STOP", reasonCode: "APPROVAL_ESCALATION_COMPLETE" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "partner_acquisition", owner: "operations", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_WELCOME_WORKFLOW,
    version: 1,
    name: "Partner welcome journey",
    trigger: EVENT_TYPES.PARTNER_ACTIVATED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      {
        id: "welcome",
        type: "NOTIFICATION",
        notificationType: "partner.welcome",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
      },
      { id: "done", type: "STOP", reasonCode: "WELCOME_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_APPROVED_NOTIFY_WORKFLOW,
    version: 1,
    name: "Partner application approved",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_APPROVED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      {
        id: "notify",
        type: "NOTIFICATION",
        notificationType: "partner.application_approved",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
      },
      { id: "done", type: "STOP", reasonCode: "APPROVAL_NOTIFY_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });

  registerWorkflow({
    workflowId: PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
    version: 1,
    name: "Partner changes requested resume",
    trigger: EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "check_changes", type: "CONDITION", conditionId: "provider.changes_requested" },
      {
        id: "notify_resume",
        type: "NOTIFICATION",
        notificationType: "partner.onboarding_resume",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.changes_requested",
      },
      { id: "done", type: "STOP", reasonCode: "CHANGES_REQUESTED_NUDGE_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "partner_acquisition", owner: "growth", phase: "section-01" },
  });
}
