import crypto from "crypto";
import { EVENT_SOURCES, EVENT_TYPES, EVENT_VERSION } from "./event-types";
import type { HomigoEvent } from "../core/homigo-event";
import { mergeEventContext } from "../core/event-context";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../core/pii";
import { rupeesToPaise } from "../../lib/money-paise";

export type BookingCreatedPayload = {
  bookingId: string;
  bookingNumber: string;
  userId: string;
  serviceId: string;
  serviceCategory: string;
  city: string;
  providerId: string | null;
  status: string;
  finalAmountPaise: number;
  paymentMethod: string | null;
  scheduledAt: string;
};

export type BookingAssignedPayload = {
  bookingId: string;
  userId: string;
  providerId: string;
  serviceId: string;
  assignedAt: string;
  eta: number | null;
};

export type BookingStartedPayload = {
  bookingId: string;
  userId: string;
  providerId: string;
  startedAt: string;
};

export type BookingCompletedPayload = {
  bookingId: string;
  userId: string;
  providerId: string | null;
  serviceId: string;
  completedAt: string;
  actualDurationMin: number;
  finalAmountPaise: number;
};

export type BookingCancelledPayload = {
  bookingId: string;
  userId: string;
  providerId: string | null;
  cancelledBy: string;
  status: string;
  refundAmountPaise: number;
  cancelledAt: string;
};

function envelope<T extends Record<string, unknown>>(
  type: string,
  source: string,
  aggregateId: string,
  data: T,
  ctx?: { correlationId?: string; causationId?: string; actorType?: "customer" | "partner" | "admin" | "system"; actorId?: string },
): HomigoEvent<T> {
  const trace = mergeEventContext(ctx);
  const safe = sanitizeEventPayload(data);
  assertNoProhibitedPii(safe);
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type,
    source,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: safe,
    homigo: {
      version: EVENT_VERSION,
      aggregateType: "booking",
      aggregateId,
      actorType: ctx?.actorType ?? trace.actorType,
      actorId: ctx?.actorId ?? trace.actorId,
      traceId: trace.traceId,
      correlationId: ctx?.correlationId ?? trace.correlationId ?? aggregateId,
      causationId: ctx?.causationId ?? trace.causationId,
    },
  };
}

export function buildBookingCreatedEvent(input: {
  bookingId: string;
  bookingNumber: string;
  userId: string;
  serviceId: string;
  serviceCategory: string;
  city: string;
  providerId: string | null;
  status: string;
  finalAmount: number;
  finalAmountPaise?: bigint;
  paymentMethod: string | null;
  scheduledAt: Date;
  actorType?: "customer" | "system";
  actorId?: string;
}): HomigoEvent<BookingCreatedPayload> {
  const finalAmountPaise =
    input.finalAmountPaise != null
      ? Number(input.finalAmountPaise)
      : Number(rupeesToPaise(input.finalAmount));
  return envelope(
    EVENT_TYPES.BOOKING_CREATED,
    EVENT_SOURCES.BOOKING,
    input.bookingId,
    {
      bookingId: input.bookingId,
      bookingNumber: input.bookingNumber,
      userId: input.userId,
      serviceId: input.serviceId,
      serviceCategory: input.serviceCategory,
      city: input.city,
      providerId: input.providerId,
      status: input.status,
      finalAmountPaise,
      paymentMethod: input.paymentMethod,
      scheduledAt: input.scheduledAt.toISOString(),
    },
    { correlationId: input.bookingId, actorType: input.actorType ?? "customer", actorId: input.actorId ?? input.userId },
  );
}

export function buildBookingAssignedEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string;
  serviceId: string;
  assignedAt: Date;
  eta?: number | null;
  actorType?: "partner" | "system" | "admin";
  actorId?: string;
}): HomigoEvent<BookingAssignedPayload> {
  return envelope(
    EVENT_TYPES.BOOKING_ASSIGNED,
    EVENT_SOURCES.BOOKING,
    input.bookingId,
    {
      bookingId: input.bookingId,
      userId: input.userId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      assignedAt: input.assignedAt.toISOString(),
      eta: input.eta ?? null,
    },
    { correlationId: input.bookingId, actorType: input.actorType ?? "partner", actorId: input.actorId ?? input.providerId },
  );
}

export function buildBookingStartedEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string;
  startedAt: Date;
}): HomigoEvent<BookingStartedPayload> {
  return envelope(EVENT_TYPES.BOOKING_STARTED, EVENT_SOURCES.BOOKING, input.bookingId, {
    bookingId: input.bookingId,
    userId: input.userId,
    providerId: input.providerId,
    startedAt: input.startedAt.toISOString(),
  }, { correlationId: input.bookingId, actorType: "partner", actorId: input.providerId });
}

export function buildBookingCompletedEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string | null;
  serviceId: string;
  completedAt: Date;
  actualDurationMin: number;
  finalAmount: number;
  finalAmountPaise?: bigint;
}): HomigoEvent<BookingCompletedPayload> {
  const finalAmountPaise =
    input.finalAmountPaise != null
      ? Number(input.finalAmountPaise)
      : Number(rupeesToPaise(input.finalAmount));
  return envelope(EVENT_TYPES.BOOKING_COMPLETED, EVENT_SOURCES.BOOKING, input.bookingId, {
    bookingId: input.bookingId,
    userId: input.userId,
    providerId: input.providerId,
    serviceId: input.serviceId,
    completedAt: input.completedAt.toISOString(),
    actualDurationMin: input.actualDurationMin,
    finalAmountPaise,
  }, { correlationId: input.bookingId, actorType: "partner", actorId: input.providerId ?? undefined });
}

export function buildBookingCancelledEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string | null;
  cancelledBy: string;
  status: string;
  refundAmount: number;
  refundAmountPaise?: bigint | null;
  cancelledAt: Date;
  actorType?: "customer" | "partner" | "admin";
  actorId?: string;
}): HomigoEvent<BookingCancelledPayload> {
  const refundAmountPaise =
    input.refundAmountPaise != null
      ? Number(input.refundAmountPaise)
      : Number(rupeesToPaise(input.refundAmount));
  return envelope(EVENT_TYPES.BOOKING_CANCELLED, EVENT_SOURCES.BOOKING, input.bookingId, {
    bookingId: input.bookingId,
    userId: input.userId,
    providerId: input.providerId,
    cancelledBy: input.cancelledBy,
    status: input.status,
    refundAmountPaise,
    cancelledAt: input.cancelledAt.toISOString(),
  }, {
    correlationId: input.bookingId,
    actorType: input.actorType ?? (input.cancelledBy === "user" ? "customer" : "partner"),
    actorId: input.actorId,
  });
}

export type BookingChatMessageSentPayload = {
  bookingId: string;
  messageId: string;
  senderUserId: string;
  createdAt: string;
};

export type FieldEvidenceCreatedPayload = {
  bookingId: string;
  evidenceId: string;
  providerId: string;
  stage: string;
  createdAt: string;
};

export function buildBookingChatMessageSentEvent(input: {
  bookingId: string;
  messageId: string;
  senderUserId: string;
  createdAt: Date;
}): HomigoEvent<BookingChatMessageSentPayload> {
  return envelope(
    EVENT_TYPES.BOOKING_CHAT_MESSAGE_SENT,
    EVENT_SOURCES.BOOKING,
    input.bookingId,
    {
      bookingId: input.bookingId,
      messageId: input.messageId,
      senderUserId: input.senderUserId,
      createdAt: input.createdAt.toISOString(),
    },
    { correlationId: input.bookingId, actorType: "partner", actorId: input.senderUserId },
  );
}

export function buildFieldEvidenceCreatedEvent(input: {
  bookingId: string;
  evidenceId: string;
  providerId: string;
  stage: string;
  createdAt: Date;
}): HomigoEvent<FieldEvidenceCreatedPayload> {
  return envelope(
    EVENT_TYPES.FIELD_EVIDENCE_CREATED,
    EVENT_SOURCES.BOOKING,
    input.bookingId,
    {
      bookingId: input.bookingId,
      evidenceId: input.evidenceId,
      providerId: input.providerId,
      stage: input.stage,
      createdAt: input.createdAt.toISOString(),
    },
    { correlationId: input.bookingId, actorType: "partner", actorId: input.providerId },
  );
}

export type BookingRescheduledPayload = {
  bookingId: string;
  userId: string;
  providerId: string | null;
  /** The appointment being left and the one being taken, both canonical instants. */
  previousScheduledAt: string;
  scheduledAt: string;
  rescheduledAt: string;
  /**
   * §45 / O6 — the fee decision this move was taken under, from the policy FROZEN on the booking.
   * Carried on the event so support and analytics can answer "what was this customer told, and
   * under which terms" without re-deriving it from a policy that may since have changed.
   * Absent on an admin move, which is not subject to the customer late fee.
   */
  reschedulePolicy?: {
    version: string;
    disposition: string;
    feeBps: number;
    feeAmountPaise: number;
  };
};

/**
 * Emitted by the ONE reschedule path (customer and admin) inside the same transaction as the write,
 * so a consumer can never see a schedule change that did not commit — or miss one that did.
 */
export function buildBookingRescheduledEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string | null;
  previousScheduledAt: Date;
  scheduledAt: Date;
  actorType: "customer" | "partner" | "admin";
  actorId?: string;
  reschedulePolicy?: BookingRescheduledPayload["reschedulePolicy"];
}): HomigoEvent<BookingRescheduledPayload> {
  return envelope(EVENT_TYPES.BOOKING_RESCHEDULED, EVENT_SOURCES.BOOKING, input.bookingId, {
    bookingId: input.bookingId,
    userId: input.userId,
    providerId: input.providerId,
    previousScheduledAt: input.previousScheduledAt.toISOString(),
    scheduledAt: input.scheduledAt.toISOString(),
    rescheduledAt: new Date().toISOString(),
    ...(input.reschedulePolicy ? { reschedulePolicy: input.reschedulePolicy } : {}),
  }, {
    correlationId: input.bookingId,
    actorType: input.actorType,
    actorId: input.actorId,
  });
}

export type BookingPaymentExpiredPayload = {
  bookingId: string;
  userId: string;
  providerId: string | null;
  scheduledAt: string;
  /** The window that closed, so a consumer never has to guess which policy produced this. */
  ttlMinutes: number;
  previousPaymentStatus: string;
  expiredAt: string;
};

/**
 * Emitted in the same transaction as the expiry, so a consumer cannot see a released slot without
 * the event, nor the event without the release.
 */
export function buildBookingPaymentExpiredEvent(input: {
  bookingId: string;
  userId: string;
  providerId: string | null;
  scheduledAt: Date;
  ttlMinutes: number;
  previousPaymentStatus: string;
}): HomigoEvent<BookingPaymentExpiredPayload> {
  return envelope(EVENT_TYPES.BOOKING_PAYMENT_EXPIRED, EVENT_SOURCES.BOOKING, input.bookingId, {
    bookingId: input.bookingId,
    userId: input.userId,
    providerId: input.providerId,
    scheduledAt: input.scheduledAt.toISOString(),
    ttlMinutes: input.ttlMinutes,
    previousPaymentStatus: input.previousPaymentStatus,
    expiredAt: new Date().toISOString(),
  }, {
    correlationId: input.bookingId,
    // No person did this: the window closed.
    actorType: "system",
  });
}
