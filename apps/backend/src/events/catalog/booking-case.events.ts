/**
 * Phase 10 §11 — complaint / warranty-claim case events. Ids, states and money in paise only:
 * never the customer's description, notes or evidence (those stay in booking_case_* tables).
 */
import { buildHomigoEvent } from "../core/event-publisher";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_SOURCES, EVENT_TYPES } from "./event-types";

export type BookingCaseOpenedPayload = {
  caseId: string;
  caseNumber: string;
  bookingId: string;
  type: string;
  category: string;
  warrantyCovers: boolean;
  slaDueAt: string;
};

export type BookingCaseResolvedPayload = {
  caseId: string;
  bookingId: string;
  state: string;
  action: string;
  refundPaise: number | null;
  followUpBookingId: string | null;
  overridden: boolean;
};

export function buildBookingCaseOpenedEvent(input: BookingCaseOpenedPayload & { customerId: string }): HomigoEvent<BookingCaseOpenedPayload> {
  const { customerId, ...data } = input;
  return buildHomigoEvent({
    type: EVENT_TYPES.BOOKING_CASE_OPENED,
    source: EVENT_SOURCES.SUPPORT,
    data,
    homigo: { aggregateType: "booking_case", aggregateId: input.caseId, correlationId: input.bookingId, actorType: "customer", actorId: customerId },
  });
}

export function buildBookingCaseResolvedEvent(input: BookingCaseResolvedPayload & { adminId: string }): HomigoEvent<BookingCaseResolvedPayload> {
  const { adminId, ...data } = input;
  return buildHomigoEvent({
    type: EVENT_TYPES.BOOKING_CASE_RESOLVED,
    source: EVENT_SOURCES.SUPPORT,
    data,
    homigo: { aggregateType: "booking_case", aggregateId: input.caseId, correlationId: input.bookingId, actorType: "admin", actorId: adminId },
  });
}
