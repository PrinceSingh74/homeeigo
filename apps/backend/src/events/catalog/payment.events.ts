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

/**
 * A checkout the customer started and has not finished.
 *
 * Carries identity and nothing else. The amount is present because recovery needs to know what was
 * at stake, but no card detail, no gateway credential, no contact detail and no address appears
 * here — the workflow re-reads whatever it needs from authoritative state when it wakes, so a
 * fuller payload would only be a copy of customer data waiting to go stale.
 */
export type CheckoutStartedPayload = {
  bookingId: string;
  userId: string;
  paymentId: string;
  amountPaise: number;
  /** The gateway order, when one exists. Absent while the reservation is still a placeholder. */
  razorpayOrderId?: string;
  startedAt: string;
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

/**
 * Built at the one point where a customer has demonstrably begun paying: a gateway order created
 * for their own booking. Correlated on `bookingId`, matching how payment recovery already works —
 * the customer's experience is booking-shaped, not payment-shaped.
 */
export function buildCheckoutStartedEvent(input: {
  bookingId: string;
  userId: string;
  paymentId: string;
  amountPaise: number;
  razorpayOrderId?: string;
  startedAt: Date;
}): HomigoEvent<CheckoutStartedPayload> {
  return envelope(
    EVENT_TYPES.CHECKOUT_STARTED,
    input.bookingId,
    {
      bookingId: input.bookingId,
      userId: input.userId,
      paymentId: input.paymentId,
      amountPaise: input.amountPaise,
      ...(input.razorpayOrderId ? { razorpayOrderId: input.razorpayOrderId } : {}),
      startedAt: input.startedAt.toISOString(),
    },
    input.bookingId,
  );
}
