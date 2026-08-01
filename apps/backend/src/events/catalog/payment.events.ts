import crypto from "crypto";
import { EVENT_SOURCES, EVENT_TYPES, EVENT_VERSION } from "./event-types";
import type { HomigoEvent } from "../core/homigo-event";
import { mergeEventContext } from "../core/event-context";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../core/pii";
import { rupeesToPaise } from "../../lib/money-paise";

export type PaymentSuccessPayload = {
  paymentId: string;
  bookingId: string;
  userId: string;
  amountPaise: number;
  paymentMethod: string | null;
  completedAt: string;
};

export type PaymentFailedPayload = {
  paymentId: string;
  bookingId: string;
  userId: string;
  amountPaise: number;
  reason: string;
  failedAt: string;
};

function envelope<T extends Record<string, unknown>>(
  type: string,
  aggregateId: string,
  data: T,
  correlationId: string,
): HomigoEvent<T> {
  const trace = mergeEventContext();
  const safe = sanitizeEventPayload(data);
  assertNoProhibitedPii(safe);
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type,
    source: EVENT_SOURCES.PAYMENT,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: safe,
    homigo: {
      version: EVENT_VERSION,
      aggregateType: "payment",
      aggregateId,
      actorType: trace.actorType ?? "system",
      actorId: trace.actorId,
      traceId: trace.traceId,
      correlationId: correlationId,
      causationId: trace.causationId,
    },
  };
}

export function buildPaymentSuccessEvent(input: {
  paymentId: string;
  bookingId: string;
  userId: string;
  amount: number;
  amountPaise?: bigint;
  paymentMethod: string | null;
  completedAt: Date;
}): HomigoEvent<PaymentSuccessPayload> {
  const amountPaise =
    input.amountPaise != null ? Number(input.amountPaise) : Number(rupeesToPaise(input.amount));
  return envelope(
    EVENT_TYPES.PAYMENT_SUCCESS,
    input.paymentId,
    {
      paymentId: input.paymentId,
      bookingId: input.bookingId,
      userId: input.userId,
      amountPaise,
      paymentMethod: input.paymentMethod,
      completedAt: input.completedAt.toISOString(),
    },
    input.bookingId,
  );
}

export function buildPaymentFailedEvent(input: {
  paymentId: string;
  bookingId: string;
  userId: string;
  amount: number;
  amountPaise?: bigint;
  reason: string;
  failedAt: Date;
}): HomigoEvent<PaymentFailedPayload> {
  const amountPaise =
    input.amountPaise != null ? Number(input.amountPaise) : Number(rupeesToPaise(input.amount));
  return envelope(
    EVENT_TYPES.PAYMENT_FAILED,
    input.paymentId,
    {
      paymentId: input.paymentId,
      bookingId: input.bookingId,
      userId: input.userId,
      amountPaise,
      reason: input.reason,
      failedAt: input.failedAt.toISOString(),
    },
    input.bookingId,
  );
}
