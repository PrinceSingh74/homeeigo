import { registerWorkflow } from "../workflow-registry";
import { EVENT_TYPES } from "../../../events/catalog/event-types";
import {
  COMPLIANCE_KYC_D30_WORKFLOW,
  COMPLIANCE_KYC_D7_WORKFLOW,
  COMPLIANCE_KYC_EXPIRED_WORKFLOW,
  PAYOUT_FAILED_RECOVERY_WORKFLOW,
  PARTNER_SOS_OPS_WORKFLOW,
  PARTNER_RATING_COACHING_WORKFLOW,
  PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
} from "./section-09-workflow-ids";

/**
 * Section 09 — Events, Notifications & Automation.
 *
 * All workflows register in SHADOW. Certification and LIVE activation remain human-gated.
 * Reuses Phase 6B conditions, 6C governance, 6D shadow, and the notification router.
 */
export function registerSection09Workflows(): void {
  registerWorkflow({
    workflowId: COMPLIANCE_KYC_D30_WORKFLOW,
    version: 1,
    name: "KYC expiring — 30-day reminder",
    trigger: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "check_d30", type: "CONDITION", conditionId: "provider.compliance_d30" },
      {
        id: "remind",
        type: "NOTIFICATION",
        notificationType: "partner.kyc_expiring_d30",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName", "documentType"],
        recheckConditionId: "provider.compliance_d30",
      },
      { id: "done", type: "STOP", reasonCode: "KYC_D30_REMINDER_SENT" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "trust", owner: "compliance", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: COMPLIANCE_KYC_D7_WORKFLOW,
    version: 1,
    name: "KYC expiring — 7-day urgent reminder",
    trigger: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "check_d7", type: "CONDITION", conditionId: "provider.compliance_d7" },
      {
        id: "urgent",
        type: "NOTIFICATION",
        notificationType: "partner.kyc_expiring_d7",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName", "documentType"],
        recheckConditionId: "provider.compliance_d7",
      },
      { id: "done", type: "STOP", reasonCode: "KYC_D7_REMINDER_SENT" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "trust", owner: "compliance", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: COMPLIANCE_KYC_EXPIRED_WORKFLOW,
    version: 1,
    name: "KYC expired — restriction notice",
    trigger: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "MEDIUM",
    steps: [
      { id: "check_expired", type: "CONDITION", conditionId: "provider.compliance_restricted" },
      {
        id: "notify",
        type: "NOTIFICATION",
        notificationType: "partner.kyc_expired",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName", "documentType"],
        recheckConditionId: "provider.compliance_restricted",
      },
      { id: "done", type: "STOP", reasonCode: "KYC_EXPIRED_NOTICE_SENT" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "trust", owner: "compliance", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: PAYOUT_FAILED_RECOVERY_WORKFLOW,
    version: 1,
    name: "Payout failed — partner alert",
    trigger: EVENT_TYPES.PARTNER_PAYOUT_FAILED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "MEDIUM",
    steps: [
      { id: "check_failed", type: "CONDITION", conditionId: "provider.payout_still_failed" },
      {
        id: "partner_alert",
        type: "NOTIFICATION",
        notificationType: "partner.payout_failed",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName", "withdrawalNumber"],
        recheckConditionId: "provider.payout_still_failed",
      },
      { id: "done", type: "STOP", reasonCode: "PAYOUT_FAILURE_HANDLED" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "finance", owner: "finance", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: PARTNER_SOS_OPS_WORKFLOW,
    version: 1,
    name: "Partner SOS — partner acknowledgment",
    trigger: EVENT_TYPES.PARTNER_SOS_CREATED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "HIGH",
    steps: [
      {
        id: "partner_ack",
        type: "NOTIFICATION",
        notificationType: "partner.sos_acknowledged",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
      },
      { id: "done", type: "STOP", reasonCode: "SOS_PARTNER_ACK_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 4,
    metadata: { domain: "trust", owner: "safety", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: PARTNER_RATING_COACHING_WORKFLOW,
    version: 1,
    name: "Rating drop — coaching nudge",
    trigger: EVENT_TYPES.PARTNER_RATING_RECEIVED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "check_low", type: "CONDITION", conditionId: "provider.rating_needs_coaching" },
      {
        id: "coach",
        type: "NOTIFICATION",
        notificationType: "partner.rating_coaching",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.rating_needs_coaching",
      },
      { id: "done", type: "STOP", reasonCode: "RATING_COACHING_SENT" },
    ],
    maxAgeMs: 48 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "growth", owner: "growth", phase: "section-09" },
  });

  registerWorkflow({
    workflowId: PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
    version: 1,
    name: "Partner offline — 5-day re-engagement",
    trigger: EVENT_TYPES.PARTNER_OFFLINE,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_5d", type: "WAIT", delayMs: 5 * 24 * 3_600_000 },
      { id: "check_offline", type: "CONDITION", conditionId: "provider.still_offline" },
      {
        id: "nudge",
        type: "NOTIFICATION",
        notificationType: "partner.reengagement",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName"],
        recheckConditionId: "provider.still_offline",
      },
      { id: "done", type: "STOP", reasonCode: "REENGAGEMENT_SENT" },
    ],
    maxAgeMs: 8 * 24 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "operations", owner: "growth", phase: "section-09" },
  });
}
