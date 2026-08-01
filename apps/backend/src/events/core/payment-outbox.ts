import type { Prisma } from "@prisma/client";
import { eventPlatformConfig } from "./config";
import { emitInTransaction } from "./event-publisher";
import { buildPaymentFailedEvent, buildPaymentSuccessEvent } from "../catalog/payment.events";

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
