import { enterpriseAuditService } from "../../services/enterprise-audit.service";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";

const AUDIT_MAP: Partial<Record<string, { action: string; resource: string; category: "PAYMENT_EVENTS" | "SYSTEM_LOGS" }>> = {
  [EVENT_TYPES.BOOKING_CREATED]: { action: "booking.created", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_ASSIGNED]: { action: "booking.assigned", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_STARTED]: { action: "booking.started", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_COMPLETED]: { action: "booking.completed", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_CANCELLED]: { action: "booking.cancelled", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_RESCHEDULED]: { action: "booking.rescheduled", resource: "booking", category: "SYSTEM_LOGS" },
  // A booking released without anyone cancelling it: the audit trail has to carry it, or the row's
  // history ends at "created" and nothing explains why its slot came back.
  [EVENT_TYPES.BOOKING_PAYMENT_EXPIRED]: { action: "booking.payment_expired", resource: "booking", category: "PAYMENT_EVENTS" },
  [EVENT_TYPES.PAYMENT_SUCCESS]: { action: "payment.success", resource: "payment", category: "PAYMENT_EVENTS" },
  [EVENT_TYPES.PAYMENT_FAILED]: { action: "payment.failed", resource: "payment", category: "PAYMENT_EVENTS" },
  [EVENT_TYPES.PARTNER_ONLINE]: { action: "partner.online", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_OFFLINE]: { action: "partner.offline", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_PAUSED]: { action: "partner.paused", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_RESUMED]: { action: "partner.resumed", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED]: { action: "partner.availability.updated", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED]: { action: "partner.service_area.updated", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_DISPATCHED]: { action: "partner.dispatched", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_ARRIVED]: { action: "partner.arrived", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_CHAT_MESSAGE_SENT]: { action: "booking.chat.message_sent", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.FIELD_EVIDENCE_CREATED]: { action: "field.evidence.created", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_LEAD_CREATED]: { action: "partner.lead.created", resource: "partner_lead", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_LEAD_MERGED]: { action: "partner.lead.merged", resource: "partner_lead", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED]: { action: "partner.application.submitted", resource: "provider", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_APPLICATION_APPROVED]: { action: "partner.application.approved", resource: "provider", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED]: { action: "partner.application.changes_requested", resource: "provider", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_ACTIVATED]: { action: "partner.activated", resource: "provider", category: "SYSTEM_LOGS" },
};

export async function auditConsumer(event: HomigoEvent): Promise<void> {
  const cfg = AUDIT_MAP[event.type];
  if (!cfg) return;

  await enterpriseAuditService.recordSystemEvent({
    action: cfg.action,
    resource: cfg.resource,
    resourceId: event.homigo.aggregateId,
    changesAfter: event.data,
    changesSummary: `${event.type} v${event.homigo.version}`,
    traceId: event.homigo.traceId ?? event.id,
    retentionCategory: cfg.category,
  });
}

export const AUDIT_CONSUMER_NAME = "audit.v1";
