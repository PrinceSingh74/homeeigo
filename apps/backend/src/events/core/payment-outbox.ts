import type { Prisma } from "@prisma/client";
import { eventPlatformConfig } from "./config";
import { emitInTransaction } from "./event-publisher";
import {
  buildCheckoutStartedEvent,
  buildPaymentFailedEvent,
  buildPaymentSuccessEvent,
} from "../catalog/payment.events";

type PaymentEmitInput = {
  id: string;
  bookingId: string;
  userId: string | null;
  amount: number;
  amountPaise: bigint;
  paymentMethod: string | null;
};

export async function emitPaymentSuccessInTransaction(
  tx: Prisma.TransactionClient,
  payment: PaymentEmitInput,
  completedAt: Date,
): Promise<void> {
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.paymentEventsEnabled || !payment.userId) {
    return;
  }
  await emitInTransaction(
    tx,
    buildPaymentSuccessEvent({
      paymentId: payment.id,
      bookingId: payment.bookingId,
      userId: payment.userId,
      amount: payment.amount,
      amountPaise: payment.amountPaise,
      paymentMethod: payment.paymentMethod,
      completedAt,
    }),
  );
}

export async function emitPaymentFailedInTransaction(
  tx: Prisma.TransactionClient,
  payment: PaymentEmitInput,
  reason: string,
  failedAt: Date,
): Promise<void> {
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.paymentEventsEnabled || !payment.userId) {
    return;
  }
  await emitInTransaction(
    tx,
    buildPaymentFailedEvent({
      paymentId: payment.id,
      bookingId: payment.bookingId,
      userId: payment.userId,
      amount: payment.amount,
      amountPaise: payment.amountPaise,
      reason,
      failedAt,
    }),
  );
}

/**
 * Emit that a checkout began, inside the caller's transaction.
 *
 * Same guards as the payment emitters: no outbox, no payment events, or no user means no event.
 * The flags are checked here rather than at the call site so a future caller cannot forget them.
 *
 * This is observational. It changes no price, no payment status, no booking status and no ledger
 * row — it records that a checkout started so something downstream can notice if it never finished.
 */
export async function emitCheckoutStartedInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    userId: string | null;
    paymentId: string;
    amountPaise: bigint | number;
    razorpayOrderId?: string;
  },
  startedAt: Date,
): Promise<void> {
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.paymentEventsEnabled || !input.userId) {
    return;
  }
  await emitInTransaction(
    tx,
    buildCheckoutStartedEvent({
      bookingId: input.bookingId,
      userId: input.userId,
      paymentId: input.paymentId,
      amountPaise: Number(input.amountPaise),
      razorpayOrderId: input.razorpayOrderId,
      startedAt,
    }),
  );
}
