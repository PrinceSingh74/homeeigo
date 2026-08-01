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
  actorType?: "partner" | "system";
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
