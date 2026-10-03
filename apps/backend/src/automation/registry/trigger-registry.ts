import { EVENT_TYPES } from "../../events/catalog/event-types";
import type { HomigoEvent } from "../../events/core/homigo-event";
import {
  PARTNER_APPROVAL_ESCALATION_WORKFLOW,
  PARTNER_APPROVED_NOTIFY_WORKFLOW,
  PARTNER_KYC_REMINDER_WORKFLOW,
  PARTNER_LEAD_FOLLOWUP_WORKFLOW,
  PARTNER_LEAD_INTAKE_WORKFLOW,
  PARTNER_ONBOARDING_NUDGE_WORKFLOW,
  PARTNER_TRAINING_REMINDER_WORKFLOW,
  PARTNER_WELCOME_WORKFLOW,
  PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
} from "./definitions/partner-acquisition-workflow-ids";
import { FOLLOW_UP_WORKFLOW } from "./definitions";
import { MORNING_INTELLIGENCE_WORKFLOW } from "./definitions/morning-intelligence-workflow";
import { SURGE_ALERT_WORKFLOW } from "./definitions/surge-alert-workflow";
import {
  COMPLIANCE_KYC_D30_WORKFLOW,
  COMPLIANCE_KYC_D7_WORKFLOW,
  COMPLIANCE_KYC_EXPIRED_WORKFLOW,
  PAYOUT_FAILED_RECOVERY_WORKFLOW,
  PARTNER_SOS_OPS_WORKFLOW,
  PARTNER_RATING_COACHING_WORKFLOW,
  PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
  DISPATCH_STALL_WORKFLOW,
} from "./definitions/section-09-workflow-ids";

/**
 * Which events start which automations.
 *
 * Code-defined, for the same reason workflow steps are: a database row may record that a trigger
 * was approved, but it must never be able to introduce one. A table that could add "this event now
 * starts that workflow" is a table that can make the system do something nobody wrote.
 *
 * The bridge that reads this does three things and nothing else — match, derive a subject, start an
 * instance. It sends no notifications, touches no payments and reassigns nobody. Business behaviour
 * lives in the workflow definition, which is the point of having definitions at all.
 */

export type TriggerSubjectType = "booking" | "partner_lead" | "provider";

export type TriggerDefinition = {
  eventType: string;
  workflowId: string;
  subjectType: TriggerSubjectType;
  /**
   * Pulls the subject out of the event payload.
   *
   * Returns null when the payload cannot supply one. That is a refusal, not a gap to be filled:
   * starting a workflow against a guessed or absent subject would let it act on the wrong booking,
   * and every subject-scoping guarantee in Phase 6B rests on this id being real.
   */
  deriveSubjectId: (event: HomigoEvent) => string | null;
};

/** Reads a string field from an event payload, refusing anything that is not one. */
function stringField(event: HomigoEvent, field: string): string | null {
  const value = (event.data as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function deriveLeadId(event: HomigoEvent): string | null {
  const fromPayload = stringField(event, "leadId");
  if (fromPayload) return fromPayload;
  const aggregateId = event.homigo.aggregateId;
  return aggregateId && aggregateId.length > 0 ? aggregateId : null;
}

function deriveProviderId(event: HomigoEvent): string | null {
  const fromPayload = stringField(event, "providerId");
  if (fromPayload) return fromPayload;
  const aggregateId = event.homigo.aggregateId;
  return aggregateId && aggregateId.length > 0 ? aggregateId : null;
}

const TRIGGERS: TriggerDefinition[] = [
  {
    /**
     * Surge alerts — mapped, and started by nothing.
     *
     * Subject is the provider rather than the zone, because the engine scopes an instance by its
     * subject and every downstream step here is about one partner: their eligibility, their
     * recipient resolution, their shadow evidence. The zone travels in the event payload, keyed by
     * `zoneId`, because two active zones share the name "Delhi Connaught Place" and a name can
     * never be an identity.
     */
    eventType: EVENT_TYPES.PARTNER_ZONE_SURGE_DETECTED,
    workflowId: SURGE_ALERT_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    /**
     * Morning Intelligence — a trigger for an event nothing publishes.
     *
     * Listed so the mapping is reviewable and the workflow is genuinely reachable the moment a
     * schedule exists, and harmless until then: the bridge only ever reacts to events that were
     * actually emitted, and no code path emits `PARTNER_MORNING_INTELLIGENCE_DUE` while
     * `morningSchedule.localTime` is null.
     *
     * Subject is the provider. The brief is about one partner's day, and every downstream step —
     * the eligibility condition, the recipient resolution, the shadow evidence — is scoped by that
     * id. `deriveSubjectId` refuses rather than guesses, as the others do.
     */
    eventType: EVENT_TYPES.PARTNER_MORNING_INTELLIGENCE_DUE,
    workflowId: MORNING_INTELLIGENCE_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    /**
     * A failed payment starts recovery against the *booking*, not the payment.
     *
     * The customer's experience is booking-shaped — they were buying a service, not making a
     * payment — and every downstream step that resolves a recipient does so from a booking subject.
     * The payment id stays in the event; the workflow re-reads current payment state when it acts,
     * rather than carrying a snapshot that will be stale by the time it matters.
     */
    eventType: EVENT_TYPES.PAYMENT_FAILED,
    workflowId: "payment_recovery",
    subjectType: "booking",
    deriveSubjectId: (e) => stringField(e, "bookingId"),
  },
  {
    /**
     * An abandoned checkout is a different business state from a failed payment, and gets its own
     * workflow rather than sharing `payment_recovery`.
     *
     * A failed payment means the gateway answered and said no. An abandoned checkout means it never
     * answered at all — the customer opened the order and walked away. The messages differ, the
     * eligibility differs, and folding them together would make the evidence for either impossible
     * to read.
     *
     * Subject is the booking, matching payment recovery: the customer was buying a service.
     */
    eventType: EVENT_TYPES.CHECKOUT_STARTED,
    workflowId: "checkout_recovery",
    subjectType: "booking",
    deriveSubjectId: (e) => stringField(e, "bookingId"),
  },
  {
    eventType: EVENT_TYPES.BOOKING_ASSIGNED,
    workflowId: DISPATCH_STALL_WORKFLOW,
    subjectType: "booking",
    deriveSubjectId: (e) => stringField(e, "bookingId"),
  },
  {
    /**
     * The review request, alongside the legacy scheduler rather than instead of it.
     *
     * `automation-scheduler.v1` still consumes this same event and still enqueues the old job, which
     * is what keeps sending for real during the migration. This trigger starts a SHADOW instance
     * that rehearses the identical decision and sends nothing, so the two can be compared on
     * production traffic without any customer receiving the message twice. The legacy consumer is
     * retired only once that comparison holds — and retiring it is a separate, deliberate act.
     */
    eventType: EVENT_TYPES.BOOKING_COMPLETED,
    workflowId: "review_request",
    subjectType: "booking",
    deriveSubjectId: (e) => stringField(e, "bookingId"),
  },
  {
    /**
     * Post-service follow-up (Phase 7, Step 7A) — a second, independent workflow reacting to the
     * same event as `review_request` immediately above.
     *
     * `startWorkflowInstance` idempotency is keyed on (workflowId, version, subjectType, subjectId,
     * triggerEventId) — see instance-manager.ts — so a single booking.completed event legitimately
     * starts one `review_request` instance AND one `follow_up` instance from this one array having
     * two entries for the same eventType; neither collides with or suppresses the other.
     *
     * This entry was missing for the workflow's entire life until this audit: the workflow itself
     * was registered (`registerAllWorkflows`) and activated (`WorkflowDefinition.status = ACTIVE`),
     * but with no row here, `triggersFor(BOOKING_COMPLETED)` never returned it, so
     * `automationTriggerConsumer` had no way to ever call `startWorkflowInstance` for it — no real
     * booking completing, no matter how many, could ever have produced a `follow_up` instance. A
     * workflow can be fully registered and ACTIVE and still be structurally unreachable if it has
     * no row here; this is the one place that connects an event to a workflow at all.
     */
    eventType: EVENT_TYPES.BOOKING_COMPLETED,
    workflowId: FOLLOW_UP_WORKFLOW,
    subjectType: "booking",
    deriveSubjectId: (e) => stringField(e, "bookingId"),
  },

  // ── Partner acquisition & onboarding (Section 01) ───────────────────────────
  {
    eventType: EVENT_TYPES.PARTNER_LEAD_CREATED,
    workflowId: PARTNER_LEAD_INTAKE_WORKFLOW,
    subjectType: "partner_lead",
    deriveSubjectId: deriveLeadId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_LEAD_CREATED,
    workflowId: PARTNER_LEAD_FOLLOWUP_WORKFLOW,
    subjectType: "partner_lead",
    deriveSubjectId: deriveLeadId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_STARTED,
    workflowId: PARTNER_ONBOARDING_NUDGE_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_STARTED,
    workflowId: PARTNER_KYC_REMINDER_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
    workflowId: PARTNER_TRAINING_REMINDER_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
    workflowId: PARTNER_APPROVAL_ESCALATION_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_APPROVED,
    workflowId: PARTNER_APPROVED_NOTIFY_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED,
    workflowId: PARTNER_CHANGES_REQUESTED_RESUME_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_ACTIVATED,
    workflowId: PARTNER_WELCOME_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },

  // ── Section 09 — Events, Notifications & Automation ───────────────────────
  {
    eventType: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    workflowId: COMPLIANCE_KYC_D30_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    workflowId: COMPLIANCE_KYC_D7_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRED,
    workflowId: COMPLIANCE_KYC_EXPIRED_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_PAYOUT_FAILED,
    workflowId: PAYOUT_FAILED_RECOVERY_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_SOS_CREATED,
    workflowId: PARTNER_SOS_OPS_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_RATING_RECEIVED,
    workflowId: PARTNER_RATING_COACHING_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
  {
    eventType: EVENT_TYPES.PARTNER_OFFLINE,
    workflowId: PARTNER_OFFLINE_REENGAGEMENT_WORKFLOW,
    subjectType: "provider",
    deriveSubjectId: deriveProviderId,
  },
];

export function triggersFor(eventType: string): TriggerDefinition[] {
  return TRIGGERS.filter((t) => t.eventType === eventType);
}

export function triggeredEventTypes(): string[] {
  return [...new Set(TRIGGERS.map((t) => t.eventType))];
}

export function listTriggers(): readonly TriggerDefinition[] {
  return TRIGGERS;
}
