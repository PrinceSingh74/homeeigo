import prisma from "./prisma";
import { incCounter } from "./metrics";
import { logger } from "./logger";
import { publishBookingStatus } from "./booking-realtime";
import { paymentDispositionFor } from "./booking-state-machine";

/**
 * Post-commit hook for "this booking's payment just reached SUCCESS".
 *
 * Two things were missing at that moment:
 *
 *   1. Nobody told the customer's open views that the payment had landed — the booking status
 *      frame is now published with `paymentStatus` attached.
 *
 *   2. Nobody re-dispatched the booking. Dispatch runs at *creation* (before payment), but partner
 *      accept is gated on `paymentStatus === SUCCESS` (booking-payment-gate.ts). A customer who
 *      paid after the first offers timed out was left with a job in TIMEOUT/REASSIGNED that only
 *      the 30 s cron might pick up — and never if it had exhausted. Re-dispatching here is safe:
 *      `dispatchBookingNow` is idempotent and only acts on PENDING / REASSIGNED / TIMEOUT jobs with
 *      attempts remaining.
 *
 * Whether dispatch should be *withheld* until payment (rather than merely repeated after it) is a
 * product decision recorded as OWNER_DECISION_REQUIRED; this hook is correct under either answer.
 *
 * Never throws; a realtime or dispatch failure must not fail a settled payment.
 */
export async function onBookingPaymentSettled(bookingId: string, source: string): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        paymentStatus: true,
        providerId: true,
        userId: true,
        refundStatus: true,
        refundAmount: true,
        cancellationReason: true,
        cancelledBy: true,
        provider: { select: { userId: true } },
      },
    });
    if (!booking) return;

    // Money landed on a booking that can no longer be served (applyBookingPaymentSuccess marked it
    // refund-pending in the settling transaction). Return it; never dispatch, never re-open.
    if (paymentDispositionFor(booking.status) === "REFUND") {
      if (booking.refundStatus === "pending" && (booking.refundAmount ?? 0) > 0 && booking.userId) {
        const { bookingRefundService } = await import("../services/booking-refund.service");
        const result = await bookingRefundService.processCancellationRefund({
          bookingId,
          userId: booking.userId,
          actorUserId: "system",
          reason: `Payment received after ${booking.status.toLowerCase()} (${source})`,
          cancelledBy: booking.cancelledBy === "provider" ? "provider" : "user",
          refundAmount: booking.refundAmount ?? 0,
        });
        await prisma.booking.updateMany({
          where: { id: bookingId, refundStatus: "pending" },
          data: { refundStatus: result.status, refundAmount: result.amount },
        });
        incCounter("booking_payment_after_terminal_refund_total", { source, outcome: result.status });
      }
      return;
    }

    await publishBookingStatus({
      bookingId,
      status: booking.status,
      userId: booking.userId,
      providerUserId: booking.provider?.userId ?? null,
      extra: { paymentStatus: String(booking.paymentStatus).toLowerCase(), paymentSource: source },
    });

    if (!booking.providerId && booking.status === "PENDING") {
      const { assignmentEngine } = await import("../services/assignment-engine.service");
      assignmentEngine.dispatchBookingNowBackground(bookingId);
      incCounter("booking_payment_settled_redispatch_total", { source });
    }
  } catch (err) {
    incCounter("booking_payment_settled_hook_failed_total", { source });
    logger.error("booking_payment_settled_hook_failed", {
      bookingId,
      source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function onBookingPaymentSettledBackground(bookingId: string, source: string): void {
  void onBookingPaymentSettled(bookingId, source);
}
