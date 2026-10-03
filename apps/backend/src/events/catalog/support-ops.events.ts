import { EVENT_SOURCES, EVENT_TYPES } from "./event-types";
import { buildHomigoEvent } from "../core/event-publisher";
import type { HomigoEvent } from "../core/homigo-event";

/**
 * Phase 16 — the two events that were missing.
 *
 * Support tickets and operational alerts were both written directly to their tables and never
 * published, which is why the Support and Operations agents could not be event-driven. These
 * close that gap through the SAME transactional outbox every other domain event uses.
 *
 * ── What is deliberately NOT in these payloads ────────────────────────────────
 *
 * No ticket subject, no ticket description, no alert message body. Those are free text written by
 * customers and by alert producers, and an event payload is a durable, replayable, fanned-out
 * record read by consumers nobody has enumerated yet.
 *
 * Three separate reasons, any one of which would be sufficient:
 *
 *  1. `assertNoProhibitedPii` scans the serialised payload, and a customer describing their
 *     problem will eventually include an address or a phone number — which would abort the
 *     enclosing business transaction, i.e. a customer's ticket would fail to be created because
 *     of what they wrote in it.
 *  2. The consumer that needs the text is the agent, and it reads the text through
 *     `read.support.getTicketContext` — a governed, RBAC-checked, audited tool. Putting the same
 *     text in the event would create a second, ungoverned path to it.
 *  3. Untrusted prose in an event payload is prompt-injection cargo. The agent trigger builds its
 *     goal from the trigger definition and never from the payload precisely so that whoever can
 *     write the payload cannot write the agent's instructions — carrying the prose here would put
 *     it one careless `JSON.stringify` away from the prompt anyway.
 *
 * The ids are enough. A consumer that needs more asks the authoritative service for it.
 */

export type SupportTicketCreatedPayload = {
  ticketId: string;
  ticketNumber: string;
  category: string;
  priorityLevel: string;
  /** Present when the ticket is linked to a booking. */
  bookingId: string | null;
  /** Whether the ticket was raised by a partner rather than a customer. */
  raisedByPartner: boolean;
  slaDueAt: string | null;
  createdAt: string;
};

export function buildSupportTicketCreatedEvent(input: {
  ticketId: string;
  ticketNumber: string;
  category: string;
  priorityLevel: string;
  bookingId?: string | null;
  providerId?: string | null;
  userId?: string | null;
  slaDueAt?: Date | null;
  createdAt: Date;
}): HomigoEvent<SupportTicketCreatedPayload> {
  return buildHomigoEvent({
    type: EVENT_TYPES.SUPPORT_TICKET_CREATED,
    source: EVENT_SOURCES.SUPPORT,
    data: {
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      category: input.category,
      priorityLevel: input.priorityLevel,
      bookingId: input.bookingId ?? null,
      raisedByPartner: Boolean(input.providerId),
      slaDueAt: input.slaDueAt ? input.slaDueAt.toISOString() : null,
      createdAt: input.createdAt.toISOString(),
    },
    homigo: {
      aggregateType: "support_ticket",
      aggregateId: input.ticketId,
      actorType: input.providerId ? "partner" : "customer",
      actorId: input.userId ?? undefined,
    },
  });
}

export type OpsAlertRaisedPayload = {
  alertId: string;
  alertType: string;
  severity: string;
  createdAt: string;
};

export function buildOpsAlertRaisedEvent(input: {
  alertId: string;
  alertType: string;
  severity: string;
  createdAt: Date;
}): HomigoEvent<OpsAlertRaisedPayload> {
  return buildHomigoEvent({
    type: EVENT_TYPES.OPS_ALERT_RAISED,
    source: EVENT_SOURCES.OPERATIONS,
    data: {
      alertId: input.alertId,
      alertType: input.alertType,
      severity: input.severity,
      createdAt: input.createdAt.toISOString(),
    },
    homigo: {
      aggregateType: "ops_alert",
      aggregateId: input.alertId,
      actorType: "system",
    },
  });
}
