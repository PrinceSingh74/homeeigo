/**
 * Phase 10 §10 — outbox events for the customer-confirmation axis of completion.
 * One event per resolution, emitted in the same transaction that resolves the completion row.
 */
import { EVENT_SOURCES, EVENT_TYPES } from "./event-types";
import { buildHomigoEvent } from "../core/event-publisher";
import type { HomigoEvent } from "../core/homigo-event";

export type BookingCompletionConfirmedPayload = {
  bookingId: string;
  state: "CONFIRMED" | "AUTO_CONFIRMED";
  verdictId: number | null;
  confirmBy: string;
  resolvedAt: string;
};

export function buildBookingCompletionConfirmedEvent(input: {
  bookingId: string;
  state: "CONFIRMED" | "AUTO_CONFIRMED";
  verdictId: number | null;
  confirmBy: Date;
  resolvedAt: Date;
  actorId?: string | null;
}): HomigoEvent<BookingCompletionConfirmedPayload> {
  const auto = input.state === "AUTO_CONFIRMED";
  return buildHomigoEvent({
    type: auto ? EVENT_TYPES.BOOKING_COMPLETION_AUTO_CONFIRMED : EVENT_TYPES.BOOKING_COMPLETION_CONFIRMED,
    source: EVENT_SOURCES.BOOKING,
    data: {
      bookingId: input.bookingId,
      state: input.state,
      verdictId: input.verdictId,
      confirmBy: input.confirmBy.toISOString(),
      resolvedAt: input.resolvedAt.toISOString(),
    },
    homigo: {
      aggregateType: "booking",
      aggregateId: input.bookingId,
      correlationId: input.bookingId,
      actorType: auto ? "system" : "customer",
      actorId: auto ? undefined : (input.actorId ?? undefined),
    },
  });
}
