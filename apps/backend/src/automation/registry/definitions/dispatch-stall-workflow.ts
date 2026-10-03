import { registerWorkflow } from "../workflow-registry";
import { EVENT_TYPES } from "../../../events/catalog/event-types";
import { DISPATCH_STALL_WORKFLOW } from "./section-09-workflow-ids";

/**
 * Dispatch stall — partner assigned but has not set off within the stall window.
 *
 * Previously the trigger existed without a registered workflow, leaving an orphan mapping.
 */
export function registerDispatchStallWorkflow(): void {
  registerWorkflow({
    workflowId: DISPATCH_STALL_WORKFLOW,
    version: 1,
    name: "Dispatch stall — partner not en route",
    trigger: EVENT_TYPES.BOOKING_ASSIGNED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_15m", type: "WAIT", delayMs: 15 * 60_000 },
      { id: "check_stall", type: "CONDITION", conditionId: "booking.assigned_not_en_route" },
      {
        id: "nudge_partner",
        type: "NOTIFICATION",
        notificationType: "partner.dispatch_stall",
        recipient: "SUBJECT_PARTNER",
        // `partnerName` is required by every partner template; for a booking subject it resolves
        // from the assigned provider (notification-step.ts resolveSubjectVariables).
        variables: ["partnerName", "bookingNumber"],
        recheckConditionId: "booking.assigned_not_en_route",
      },
      { id: "done", type: "STOP", reasonCode: "DISPATCH_STALL_NUDGE_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "execution", owner: "operations", phase: "section-09" },
  });
}
