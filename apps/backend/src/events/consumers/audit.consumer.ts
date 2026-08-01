import { enterpriseAuditService } from "../../services/enterprise-audit.service";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";

const AUDIT_MAP: Partial<Record<string, { action: string; resource: string; category: "PAYMENT_EVENTS" | "SYSTEM_LOGS" }>> = {
  [EVENT_TYPES.BOOKING_CREATED]: { action: "booking.created", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_ASSIGNED]: { action: "booking.assigned", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_STARTED]: { action: "booking.started", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_COMPLETED]: { action: "booking.completed", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.BOOKING_CANCELLED]: { action: "booking.cancelled", resource: "booking", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PAYMENT_SUCCESS]: { action: "payment.success", resource: "payment", category: "PAYMENT_EVENTS" },
  [EVENT_TYPES.PAYMENT_FAILED]: { action: "payment.failed", resource: "payment", category: "PAYMENT_EVENTS" },
  [EVENT_TYPES.PARTNER_DISPATCHED]: { action: "partner.dispatched", resource: "partner", category: "SYSTEM_LOGS" },
  [EVENT_TYPES.PARTNER_ARRIVED]: { action: "partner.arrived", resource: "partner", category: "SYSTEM_LOGS" },
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
    traceId: event.homigo.traceId,
    retentionCategory: cfg.category,
  });
}

export const AUDIT_CONSUMER_NAME = "audit.v1";
