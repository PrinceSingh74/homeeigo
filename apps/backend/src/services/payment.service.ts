import crypto from "crypto";
import { PaymentStatus, Prisma, type Payment } from "@prisma/client";
import prisma from "../lib/prisma";
import { paymentStatusApi } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { razorpayService } from "./razorpay.service";
import { notificationService } from "./notification.service";
import { walletService } from "./wallet.service";
import { invoiceNumberFor, invoiceService } from "./invoice.service";
import { emailDeliveryService } from "./email-delivery.service";
import { userPiiService } from "./user-pii.service";
import { giftCardService } from "./gift-card.service";
import { subscriptionService } from "./subscription.service";
import { settlementChargebackService } from "./settlement-chargeback.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { refundLedgerSyncService } from "./refund-ledger-sync.service";
import { earningsService } from "./earnings.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { incCounter } from "../lib/metrics";
import { logger } from "../lib/logger";
import { onBookingPaymentSettledBackground } from "../lib/booking-payment-settled";
import {
  processGatewayEnvironment,
  readPaymentEnvironment,
  stampPaymentEnvironment,
} from "../lib/payment-environment-column";
import { applyBookingPaymentSuccess, isCapturedPaymentStatus } from "../lib/booking-payment-settlement";
import { isPayableBookingStatus } from "../lib/booking-state-machine";

/** Same literal as booking-refund.service SPLIT_PAYMENT_METHOD (not imported: that module imports this one). */
const SPLIT_PAYMENT_METHOD = "wallet_razorpay_split";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { eventPlatformConfig } from "../events/core/config";
import { rupeesToPaise } from "../lib/money-paise";
import {
  emitCheckoutStartedInTransaction,
  emitPaymentFailedInTransaction,
  emitPaymentSuccessInTransaction,
} from "../events/core/payment-outbox";

type PaymentOrderMetadata = {
  previousRazorpayOrderIds?: string[];
  /** Set when a capture arrived after PAYMENT_PENDING_TTL closed the window (needs a refund). */
  capturedAfterExpiry?: { gatewayPaymentId: string; amountPaise: number | null; at: string };
};

const GATEWAY_ORDER_POLL_MS = 50;
const GATEWAY_ORDER_TIMEOUT_MS = 10_000;

/**
 * The shape this service reads out of a Razorpay webhook body.
 *
 * Exported so the route declares the SAME contract instead of describing the body loosely as
 * `{ event: string; payload: Record<string, unknown> }` and then forcing it in with `as never`.
 * One type, stated once, on a money path.
 *
 * Every field below `payload` is optional on purpose: the body is authenticated (the route
 * verifies the HMAC signature before parsing) but its shape is still the gateway's to change, so
 * the reconciliation logic optional-chains through all of it rather than assuming a field is there.
 */
export type RazorpayWebhookEvent = {
  event: string;
  /**
   * Razorpay does not document a live/test marker on webhook bodies today; if one ever appears
   * it wins over the process credential when deriving the webhook's environment (§27).
   */
  livemode?: boolean;
  payload: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string; amount?: number } };
    refund?: { entity?: { id?: string; payment_id?: string; status?: string; amount?: number } };
  };
};

export class PaymentService {
  buildOrderIdempotencyKey(bookingId: string): string {
    return `booking_order:${bookingId}`;
  }

  private isPendingGatewayOrder(orderId: string): boolean {
    return orderId.startsWith("pending:");
  }

  /** A reservation whose gateway call is KNOWN to have failed (see releaseFailedReservation). */
  private isReleasedReservation(orderId: string): boolean {
    return orderId.startsWith("pending:released:");
  }

  /**
   * The gateway call behind this reservation failed with a typed error, so no request will ever commit
   * it. Mark it released (still `pending:`, still INITIATED — nothing is claimed paid, the booking is not
   * touched) so the next attempt reclaims it at once instead of polling out the 10 s in-flight window.
   * Guarded on the exact placeholder: a reservation someone else already took over is left alone.
   */
  private async releaseFailedReservation(bookingId: string, placeholder: string): Promise<void> {
    await prisma.payment
      .updateMany({
        where: { bookingId, razorpayOrderId: placeholder, status: PaymentStatus.INITIATED },
        data: { razorpayOrderId: `pending:released:${bookingId}:${crypto.randomUUID()}` },
      })
      .catch((err: unknown) =>
        logger.warn("payment.reservation_release_failed", { bookingId, error: err instanceof Error ? err.message : String(err) }),
      );
  }

  private parsePaymentMetadata(raw: string | null): PaymentOrderMetadata {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as PaymentOrderMetadata;
    } catch {
      return {};
    }
  }

  private async awaitCommittedGatewayOrder(bookingId: string): Promise<Payment> {
    const deadline = Date.now() + GATEWAY_ORDER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const payment = await prisma.payment.findUnique({ where: { bookingId } });
      if (!payment) {
        throw new Error("PAYMENT_RESERVATION_MISSING");
      }
      if (!this.isPendingGatewayOrder(payment.razorpayOrderId)) {
        return payment;
      }
      await Bun.sleep(GATEWAY_ORDER_POLL_MS);
    }
    throw new Error("GATEWAY_ORDER_TIMEOUT");
  }

  /**
   * Takes over a `pending:` reservation whose gateway call never completed.
   *
   * The placeholder is written BEFORE Razorpay is contacted, so a failed gateway
   * call (outage, network drop, bad credentials) leaves a row that no request will
   * ever commit. Without this, every later attempt polled for the full timeout and
   * died with GATEWAY_ORDER_TIMEOUT — permanently blocking payment for that booking.
   *
   * The swap is guarded on the exact stale placeholder, so a genuinely in-flight
   * request can never have its reservation stolen: only one caller wins the update,
   * and only the winner drives a new gateway order.
   */
  private async reclaimAbandonedReservation(
    bookingId: string,
    stalePlaceholder: string,
  ): Promise<{ payment: Payment; createdReservation: boolean }> {
    const claimed = await prisma.payment.updateMany({
      where: {
        bookingId,
        razorpayOrderId: stalePlaceholder,
        status: PaymentStatus.INITIATED,
      },
      data: { razorpayOrderId: `pending:${bookingId}:${crypto.randomUUID()}` },
    });
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) throw new Error("PAYMENT_RESERVATION_MISSING");
    return { payment, createdReservation: claimed.count > 0 };
  }

  /**
   * Waits for a concurrent request to commit the gateway order, and reclaims the
   * reservation if nobody ever does. A reservation older than the timeout cannot
   * have a live request behind it, so it is reclaimed immediately — that turns a
   * retry after a gateway outage from a 10s hang into an instant new order.
   */
  private async settleReservation(
    bookingId: string,
    placeholder: string,
    reservedAt: Date,
  ): Promise<{ payment: Payment; createdReservation: boolean }> {
    if (this.isReleasedReservation(placeholder) || Date.now() - reservedAt.getTime() > GATEWAY_ORDER_TIMEOUT_MS) {
      return this.reclaimAbandonedReservation(bookingId, placeholder);
    }
    try {
      const committed = await this.awaitCommittedGatewayOrder(bookingId);
      return { payment: committed, createdReservation: false };
    } catch (error) {
      if (error instanceof Error && error.message === "GATEWAY_ORDER_TIMEOUT") {
        return this.reclaimAbandonedReservation(bookingId, placeholder);
      }
      throw error;
    }
  }

  private async reservePaymentIntent(
    userId: string,
    bookingId: string,
    idempotencyKey: string,
    finalAmount: number,
    paymentMethod: string | null,
  ): Promise<{ payment: Payment; createdReservation: boolean }> {
    const existing = await prisma.payment.findUnique({ where: { bookingId } });
    if (existing) {
      if (existing.status === PaymentStatus.SUCCESS) {
        return { payment: existing, createdReservation: false };
      }
      if (!this.isPendingGatewayOrder(existing.razorpayOrderId)) {
        return { payment: existing, createdReservation: false };
      }
      return this.settleReservation(bookingId, existing.razorpayOrderId, existing.updatedAt);
    }

    const placeholder = `pending:${bookingId}:${crypto.randomUUID()}`;
    try {
      const payment = await prisma.payment.create({
        data: {
          bookingId,
          idempotencyKey,
          userId,
          amount: finalAmount,
          paymentMethod: paymentMethod ?? "razorpay",
          razorpayOrderId: placeholder,
          status: PaymentStatus.INITIATED,
        },
      });
      // §27 — record which gateway world this payment belongs to, from the ACTIVE credential.
      // Probe-guarded and non-throwing: a pre-migration database skips it silently.
      await stampPaymentEnvironment(prisma, payment.id);
      return { payment, createdReservation: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await prisma.payment.findUnique({ where: { bookingId } });
        if (!raced) throw error;
        if (!this.isPendingGatewayOrder(raced.razorpayOrderId)) {
          return { payment: raced, createdReservation: false };
        }
        return this.settleReservation(bookingId, raced.razorpayOrderId, raced.updatedAt);
      }
      throw error;
    }
  }

  private async retryFailedPaymentOrder(
    payment: Payment,
    booking: { id: string; bookingNumber: string; finalAmount: number },
    idempotencyKey: string,
  ) {
    const metadata = this.parsePaymentMetadata(payment.metadata);
    const history = metadata.previousRazorpayOrderIds ?? [];
    if (!history.includes(payment.razorpayOrderId)) {
      history.push(payment.razorpayOrderId);
    }

    // A split row stays a split on retry: the gateway is charged only the remainder after the
    // wallet share, which settleSplitCapture debits on capture. Re-issuing the order for the full
    // total (the old behaviour) charged the customer the total PLUS the wallet share.
    const walletShare = payment.paymentMethod === SPLIT_PAYMENT_METHOD ? Number((metadata as { walletAmount?: number }).walletAmount ?? 0) : 0;
    const gatewayAmount = Math.round((booking.finalAmount - walletShare) * 100) / 100;
    if (!(gatewayAmount > 0)) return { error: "RETRY_CONFLICT" as const };

    const order = await razorpayService.createOrder(gatewayAmount, booking.bookingNumber, {
      bookingId: booking.id,
    });

    const updated = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.FAILED,
        razorpayOrderId: payment.razorpayOrderId,
      },
      data: {
        amount: gatewayAmount,
        amountPaise: Math.round(gatewayAmount * 100),
        razorpayOrderId: order.orderId,
        status: PaymentStatus.INITIATED,
        failedAt: null,
        metadata: JSON.stringify({
          ...metadata,
          previousRazorpayOrderIds: history,
        } satisfies PaymentOrderMetadata),
      },
    });

    if (updated.count === 0) {
      const raced = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
      if (raced) return this.orderResponse(raced, booking.id);
      return { error: "RETRY_CONFLICT" as const };
    }

    // §27 — a retried order re-asserts the environment (fills NULL only, never rewrites).
    await stampPaymentEnvironment(prisma, payment.id, order.orderId);

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: PaymentStatus.INITIATED },
    });

    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
      notes: { bookingId: booking.id },
      idempotencyKey,
      previousRazorpayOrderIds: history,
    };
  }

  async createOrder(userId: string, bookingId: string) {
    const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId } });
    if (!booking) return null;
    if (!isPayableBookingStatus(booking.status)) return { error: "BOOKING_NOT_PAYABLE" as const };

    const idempotencyKey = this.buildOrderIdempotencyKey(bookingId);
    const finalAmount = booking.finalAmount;

    const reservation = await this.reservePaymentIntent(
      userId,
      bookingId,
      idempotencyKey,
      finalAmount,
      booking.paymentMethod,
    );
    const { createdReservation } = reservation;
    let { payment } = reservation;

    if (payment.status === PaymentStatus.SUCCESS) {
      return this.orderResponse(payment, bookingId);
    }

    if (!this.isPendingGatewayOrder(payment.razorpayOrderId)) {
      if (payment.status === PaymentStatus.FAILED) {
        return this.retryFailedPaymentOrder(payment, booking, idempotencyKey);
      }
      return this.orderResponse(payment, bookingId);
    }

    if (!createdReservation) {
      const settled = await this.settleReservation(
        bookingId,
        payment.razorpayOrderId,
        payment.updatedAt,
      );
      if (!settled.createdReservation) {
        return this.orderResponse(settled.payment, bookingId);
      }
      // We took over an abandoned reservation — fall through and drive the order.
      payment = settled.payment;
    }

    const placeholder = payment.razorpayOrderId;
    let order: Awaited<ReturnType<typeof razorpayService.createOrder>>;
    try {
      order = await razorpayService.createOrder(finalAmount, booking.bookingNumber, {
        bookingId,
      });
    } catch (err) {
      // No order exists at the gateway: free the reservation for an immediate retry, then surface the
      // typed PaymentGatewayError (503/502) instead of an UNKNOWN 500.
      await this.releaseFailedReservation(bookingId, placeholder);
      incCounter("payment_order_create_failed_total", {
        code: (err as { code?: string })?.code ?? "UNTYPED",
      });
      throw err;
    }

    const updated = await prisma.payment.updateMany({
      where: {
        bookingId,
        razorpayOrderId: placeholder,
        status: PaymentStatus.INITIATED,
      },
      data: {
        amount: finalAmount,
        razorpayOrderId: order.orderId,
      },
    });

    if (updated.count === 0) {
      const raced = await prisma.payment.findUnique({ where: { bookingId } });
      if (raced) return this.orderResponse(raced, bookingId);
      throw new Error("PAYMENT_COMMIT_FAILED");
    }

    // §27 — the committed gateway order settles the environment (a dev-mock order IS test).
    await stampPaymentEnvironment(prisma, payment.id, order.orderId);

    /**
     * The booking is marked INITIATED and the checkout event is written together, or neither is.
     *
     * This is the only structural change to the checkout path, and it is deliberately the smallest
     * one available: the `booking.update` that was already here now runs inside a transaction with
     * the outbox write, exactly as `verify()` does for payment success and failure. Nothing about
     * the amount, the gateway order, the reservation logic or the payment status is touched — the
     * event is observational and cannot alter any of them.
     *
     * Emitting outside a transaction would have been simpler and wrong: a checkout could be marked
     * INITIATED with no event, so recovery would never learn about it, or an event could survive a
     * failed update and start recovery for a checkout that never began.
     */
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PaymentStatus.INITIATED },
      });
      await emitCheckoutStartedInTransaction(
        tx,
        {
          bookingId,
          userId: booking.userId,
          paymentId: payment.id,
          amountPaise: rupeesToPaise(finalAmount),
          razorpayOrderId: order.orderId,
        },
        new Date(),
      );
    });

    return {
      razorpayOrderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayService.keyId,
      notes: { bookingId },
      idempotencyKey,
      checkoutMode: razorpayService.checkoutModeForOrder(order.orderId),
    };
  }

  private orderAmountPaise(amountInr: number): number {
    return Math.round(amountInr * 100);
  }

  private orderResponse(
    payment: { razorpayOrderId: string; amount: number },
    bookingId: string,
  ) {
    return {
      razorpayOrderId: payment.razorpayOrderId,
      amount: this.orderAmountPaise(payment.amount),
      currency: "INR" as const,
      key: razorpayService.keyId,
      notes: { bookingId },
      idempotencyKey: this.buildOrderIdempotencyKey(bookingId),
      checkoutMode: razorpayService.checkoutModeForOrder(payment.razorpayOrderId),
    };
  }

  async verify(
    userId: string,
    body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ) {
    const payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: body.razorpayOrderId, userId },
      include: { booking: true },
    });
    if (!payment) {
      const walletResult = await walletService.verifyTopUp(userId, body);
      if (walletResult.error === "NOT_FOUND") return { error: "NOT_FOUND" as const };
      if (walletResult.error === "INVALID_SIGNATURE") return { error: "INVALID_SIGNATURE" as const };
      // EXPIRED / FAILED top-ups must surface as errors — never fall through to a
      // success-shaped response (which would report a phantom credit). This guard
      // also narrows the union so the success fields below are type-safe.
      if (walletResult.error === "EXPIRED") return { error: "EXPIRED" as const };
      if (walletResult.error === "FAILED") return { error: "FAILED" as const };
      return {
        walletTransactionId: walletResult.walletTransactionId,
        status: walletResult.status,
        balance: walletResult.balance,
      };
    }

    const valid = razorpayService.verifyPaymentSignature(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
    if (!valid) return { error: "INVALID_SIGNATURE" as const };

    if (payment.paymentMethod === SPLIT_PAYMENT_METHOD) {
      // A split order's gateway capture is only the remainder. Settling it here as a plain payment
      // marked the booking fully paid without debiting the wallet share — a customer could pay ₹1 for
      // a ₹1000 booking by calling this endpoint instead of the split verify. Same settlement as the
      // split endpoint and the webhook.
      const { walletCheckoutService } = await import("./wallet-checkout.service");
      const r = await walletCheckoutService.settleSplitCapture(payment.id, body.razorpayPaymentId, body.razorpaySignature, "razorpay_verify_split");
      if ("error" in r) {
        if (r.error === "NOT_FOUND") return { error: "NOT_FOUND" as const };
        if (r.error === "INVALID_SIGNATURE") return { error: "INVALID_SIGNATURE" as const };
        if (r.error === "WALLET_DEBIT_FAILED") return { error: "FAILED" as const };
        return { error: "ALREADY_SETTLED" as const };
      }
      return { paymentId: payment.id, status: "success", bookingId: payment.bookingId };
    }

    if (isCapturedPaymentStatus(payment.status) && payment.razorpayPaymentId === body.razorpayPaymentId) {
      return { paymentId: payment.id, status: "success", bookingId: payment.bookingId };
    }
    if (isCapturedPaymentStatus(payment.status) && payment.razorpayPaymentId !== body.razorpayPaymentId) {
      return { error: "ALREADY_SETTLED" as const };
    }

    try {
      await financialTransactionManager.executeWithLedger({
        journal: financialLedgerService.journalForBookingPayment(payment.id, payment.amount),
        mutate: async (tx) => {
          await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
          const locked = await tx.payment.findUnique({ where: { id: payment.id } });
          if (!locked) throw new Error("PAYMENT_NOT_FOUND");
          if (isCapturedPaymentStatus(locked.status)) {
            if (locked.razorpayPaymentId === body.razorpayPaymentId) return locked;
            throw new Error("PAYMENT_ALREADY_SETTLED");
          }
          const paymentIdInUse = await tx.payment.findFirst({
            where: {
              razorpayPaymentId: body.razorpayPaymentId,
              NOT: { id: payment.id },
            },
            select: { id: true },
          });
          if (paymentIdInUse) throw new Error("PAYMENT_ID_REUSED");

          return tx.payment.update({
            where: { id: payment.id },
            data: {
              razorpayPaymentId: body.razorpayPaymentId,
              razorpaySignature: body.razorpaySignature,
              status: PaymentStatus.SUCCESS,
              completedAt: new Date(),
              amountPaid: payment.amount,
              amountPaidPaise: rupeesToPaise(payment.amount),
              invoiceNumber: invoiceNumberFor(payment.booking.bookingNumber),
            },
          }).then(async (updated) => {
            await applyBookingPaymentSuccess(tx, payment.bookingId, {
              capturedAmount: payment.amount,
              source: "razorpay_verify",
            });
            if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.paymentEventsEnabled && payment.userId) {
              await emitPaymentSuccessInTransaction(tx, payment, updated.completedAt ?? new Date());
            }
            return updated;
          });
        },
      });
    } catch (error) {
      if (error instanceof Error && ["PAYMENT_ALREADY_SETTLED", "PAYMENT_ID_REUSED"].includes(error.message)) {
        return { error: "ALREADY_SETTLED" as const };
      }
      throw error;
    }

    // §27 — a payment that settled through verify gets its environment recorded if creation
    // predates the column (fills NULL only).
    await stampPaymentEnvironment(prisma, payment.id, body.razorpayOrderId);

    onBookingPaymentSettledBackground(payment.bookingId, "razorpay_verify");

    if (payment.userId) {
      recordFinancialMetric("payment_success_total", 1);

      // Detached: the payment is committed and counted. A transient notification failure must not
      // turn a settled payment into a 500 — and must not skip the receipt/invoice email below, which
      // a re-verify can never reach because it short-circuits on `status === SUCCESS`.
      await notificationService.createForUserDetached(
        {
          userId: payment.userId,
          type: "payment_completed",
          title: "Payment Received",
          message: `Payment of ₹${payment.amount} received for booking`,
          referenceId: payment.id,
          priority: "high",
        },
        { paymentId: payment.id, bookingId: payment.bookingId },
      );

      // Payment receipt + invoice PDF email — never blocks the response.
      const u = await prisma.user.findUnique({
        where: { id: payment.userId },
        select: { id: true, email: true, firstName: true, phoneNumber: true },
      });
      if (u) {
        const email = await userPiiService.resolveEmail(u, { actorId: payment.userId, authorized: true });
        if (email) {
          emailDeliveryService.sendPaymentReceipt(email, payment.amount, payment.booking.bookingNumber, u.firstName);
          void invoiceService.generatePdf(payment.userId, payment.id).then((pdf) => {
            if (pdf) {
              emailDeliveryService.sendInvoiceWithPdf(email, pdf.invoiceNo, payment.amount, pdf.buffer, u.firstName);
            }
          });
        }
      }
    }

    return { paymentId: payment.id, status: "success", bookingId: payment.bookingId };
  }

  async getById(userId: string, id: string) {
    const p = await prisma.payment.findFirst({ where: { id, userId } });
    if (!p) return null;
    return {
      id: p.id,
      bookingId: p.bookingId,
      amount: p.amount,
      status: paymentStatusApi(p.status),
      paymentMethod: p.paymentMethod,
      razorpayPaymentId: p.razorpayPaymentId,
      receiptUrl: p.receiptUrl,
      completedAt: p.completedAt,
    };
  }

  /** Admin-only manual refund with amount caps and audit trail. */
  async refund(id: string, amount: number, reason: string, actor: { userId: string; isAdmin: boolean }) {
    const result = await refundOrchestratorService.executeRefund({
      paymentId: id,
      amount,
      reason,
      actorUserId: actor.userId,
      isAdmin: actor.isAdmin,
      source: "admin",
      idempotencyKey: refundOrchestratorService.buildIdempotencyKey(id, amount, "admin", actor.userId),
    });
    if ("error" in result) {
      return { error: result.error as "FORBIDDEN" | "NOT_FOUND" | "INVALID_AMOUNT" | "NOT_REFUNDABLE" | "AMOUNT_EXCEEDS_REFUNDABLE" | "PAYMENT_ENV_MISMATCH" };
    }
    return { refundId: result.refundId, status: result.status, amount: result.amount };
  }

  /** @deprecated Use bookingRefundService.processCancellationRefund via bookingService.cancel */
  async refundForBookingCancellation(
    bookingId: string,
    reason: string,
    actorUserId: string,
    refundAmount?: number,
  ): Promise<{ amount: number; status: string } | { error: string }> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { userId: true, cancelledBy: true },
    });
    if (!booking?.userId) return { amount: 0, status: "none" };

    const { bookingRefundService } = await import("./booking-refund.service");
    const amount =
      refundAmount ??
      (await bookingRefundService.quoteForBooking(
        bookingId,
        booking.cancelledBy === "provider" ? "provider" : "user",
      ))?.refundAmount ??
      0;

    const result = await bookingRefundService.processCancellationRefund({
      bookingId,
      userId: booking.userId,
      actorUserId,
      reason,
      cancelledBy: booking.cancelledBy === "provider" ? "provider" : "user",
      refundAmount: amount,
    });
    return result;
  }

  /** Retry-safe activation for gift cards / subscriptions missed by client verify. */
  async reconcilePendingOrders(): Promise<{ giftCards: number; subscriptions: number; bookings: number }> {
    const [giftCards, subscriptions, bookings] = await Promise.all([
      giftCardService.reconcilePendingFromOrders(),
      subscriptionService.reconcilePendingFromOrders(),
      this.reconcilePendingBookingPayments(),
    ]);
    const recovered = giftCards + subscriptions + bookings.settled;
    if (recovered > 0) {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        emailDeliveryService.sendRecoveryAlert(
          adminEmail,
          "Payment reconciliation recovered orders",
          `Recovered ${giftCards} gift card(s), ${subscriptions} subscription(s) and ${bookings.settled} booking payment(s) from pending Razorpay orders.`,
        );
      }
    }
    return { giftCards, subscriptions, bookings: bookings.settled };
  }

  /** Booking payments a lost capture webhook would leave unsettled: real gateway order, still open. */
  static readonly RECONCILE_MIN_AGE_MINUTES = 10;

  /**
   * Phase 09 — the booking half of missed-webhook reconciliation.
   *
   * Gift cards and subscriptions were already reconciled from pending orders; booking payments were
   * not, so a booking whose `payment.captured` webhook never arrived stayed PENDING with the customer
   * charged. This asks the gateway what it holds for each open order and, when it reports a capture,
   * hands that capture to `reconcileFromWebhook` — the SAME path the webhook takes, with the same
   * idempotency (ALREADY_RECONCILED), split handling and ledger journal. Nothing is settled here on
   * this method's own authority; the gateway's answer is the evidence and the webhook path is the
   * arbiter.
   *
   * Only orders older than RECONCILE_MIN_AGE_MINUTES are considered, so a capture whose webhook is
   * merely a few seconds behind is left to the webhook. An order the gateway shows as unpaid is left
   * alone — expiring it is owner decision O2 (pending-payment TTL), not something to infer here.
   */
  async reconcilePendingBookingPayments(
    limit = 50,
    /** Narrow the sweep to one payment — support answering "reconcile this booking now". */
    opts?: { paymentId?: string },
  ): Promise<{ scanned: number; settled: number; unpaid: number; errors: number }> {
    const out = { scanned: 0, settled: 0, unpaid: 0, errors: 0 };
    if (!razorpayService.isConfigured) return out;
    const olderThan = new Date(Date.now() - PaymentService.RECONCILE_MIN_AGE_MINUTES * 60_000);
    const open = await prisma.payment.findMany({
      where: {
        ...(opts?.paymentId ? { id: opts.paymentId } : {}),
        status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED, PaymentStatus.PROCESSING] },
        updatedAt: { lt: olderThan },
      },
      select: { id: true, bookingId: true, razorpayOrderId: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    for (const row of open) {
      const orderId = row.razorpayOrderId;
      if (!orderId || this.isPendingGatewayOrder(orderId)) continue;
      out.scanned += 1;
      try {
        const payments = await razorpayService.fetchOrderPayments(orderId);
        const captured = payments.find((p) => p.status === "captured");
        if (!captured) {
          out.unpaid += 1;
          continue;
        }
        const result = await this.reconcileFromWebhook({
          event: "payment.captured",
          payload: { payment: { entity: { id: captured.id, order_id: orderId, status: "captured", amount: captured.amount } } },
        });
        if (result.handled) {
          out.settled += 1;
          incCounter("payment_reconcile_booking_total", { outcome: "settled" });
          logger.warn("payment_reconcile_booking_settled", {
            category: "PAYMENT",
            paymentId: row.id,
            bookingId: row.bookingId,
            orderId,
            gatewayPaymentId: captured.id,
            reason: result.reason,
          });
        } else {
          out.errors += 1;
          incCounter("payment_reconcile_booking_total", { outcome: "unhandled" });
          logger.error("payment_reconcile_booking_unhandled", {
            category: "PAYMENT",
            paymentId: row.id,
            bookingId: row.bookingId,
            orderId,
            gatewayPaymentId: captured.id,
            reason: result.reason,
          });
        }
      } catch (err) {
        out.errors += 1;
        incCounter("payment_reconcile_booking_total", { outcome: "error" });
        logger.error("payment_reconcile_booking_failed", {
          category: "PAYMENT",
          paymentId: row.id,
          orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  /** The booking payment whose retry history contains this gateway order id (metadata is a JSON string). */
  private async findPaymentByReplacedOrder(orderId: string): Promise<Payment | null> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM payments WHERE metadata LIKE ${`%"${orderId}"%`} LIMIT 5`;
    for (const { id } of rows) {
      const row = await prisma.payment.findUnique({ where: { id } });
      if (row && (this.parsePaymentMetadata(row.metadata).previousRazorpayOrderIds ?? []).includes(orderId)) return row;
    }
    return null;
  }

  /**
   * A capture arrived for an order that a retry replaced. If the booking payment is still unsettled
   * and the captured amount is exactly what the row expects, the row is re-bound to the order the
   * customer actually paid and settled through the normal path (split rows included). If the row was
   * already settled by another capture (the customer paid twice) or the amount does not match, NOTHING
   * is settled: a CRITICAL ops alert carries every identifier so the duplicate is refunded, never lost.
   */
  private async reconcileReplacedOrderCapture(
    event: RazorpayWebhookEvent,
    payment: Payment,
    captured: { id: string; orderId: string; amountPaise?: number },
  ): Promise<{ handled: boolean; reason: string }> {
    if (isCapturedPaymentStatus(payment.status) && payment.razorpayPaymentId === captured.id) {
      return { handled: true, reason: "ALREADY_RECONCILED" };
    }
    const expectedPaise = Math.round(payment.amount * 100);
    const orphan = async (why: "ALREADY_SETTLED_BY_OTHER_CAPTURE" | "AMOUNT_MISMATCH") => {
      incCounter("payment_orphan_capture_total", { reason: why });
      const { opsAlertService } = await import("./ops-alert.service");
      await opsAlertService.raise("payment_orphan_capture", "CRITICAL", `Gateway capture ${captured.id} on replaced order ${captured.orderId} needs a refund (${why})`, {
        bookingId: payment.bookingId, paymentId: payment.id, gatewayPaymentId: captured.id, gatewayOrderId: captured.orderId,
        capturedPaise: captured.amountPaise ?? null, expectedPaise, reason: why,
      });
      return { handled: true, reason: `ORPHAN_CAPTURE_ALERTED:${why}` };
    };
    if (isCapturedPaymentStatus(payment.status)) return orphan("ALREADY_SETTLED_BY_OTHER_CAPTURE");
    if (captured.amountPaise == null || captured.amountPaise !== expectedPaise) return orphan("AMOUNT_MISMATCH");

    const history = this.parsePaymentMetadata(payment.metadata).previousRazorpayOrderIds ?? [];
    const nextHistory = [...history.filter((o) => o !== captured.orderId), payment.razorpayOrderId];
    const rebound = await prisma.payment.updateMany({
      where: { id: payment.id, razorpayOrderId: payment.razorpayOrderId, status: { notIn: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDING] } },
      data: {
        razorpayOrderId: captured.orderId,
        metadata: JSON.stringify({ ...this.parsePaymentMetadata(payment.metadata), previousRazorpayOrderIds: nextHistory } satisfies PaymentOrderMetadata),
      },
    });
    if (rebound.count === 0) {
      const fresh = await prisma.payment.findUnique({ where: { id: payment.id } });
      return fresh ? this.reconcileReplacedOrderCapture(event, fresh, captured) : { handled: false, reason: "PAYMENT_NOT_FOUND" };
    }
    incCounter("payment_replaced_order_capture_rebound_total");
    return this.reconcileFromWebhook(event);
  }

  /**
   * O10 — money captured AFTER the payment window closed (owner policy 2026-09-23: GUARDED
   * auto-refund).
   *
   * The booking was expired and its capacity RELEASED, so the slot may already belong to someone
   * else. Confirming the booking here could double-book a partner, so this path never confirms.
   *
   * It refunds automatically ONLY when every question has a single unambiguous answer:
   *   * the payment maps to exactly this booking's order;
   *   * the captured amount equals the expected amount exactly;
   *   * the booking has not been recovered (it is still EXPIRED);
   *   * this booking has exactly one payment row;
   *   * nothing has been refunded yet and no refund is in flight.
   *
   * Anything else — amount mismatch, wrong order, several payments, a partial capture, an existing
   * or concurrent refund, a recovered booking — is RECONCILIATION_REQUIRED and is alerted for a
   * human. Refunding an ambiguous financial event automatically is how money gets returned twice.
   *
   * The refund goes through the ONE refund authority (`refundOrchestratorService`), which owns
   * idempotency, the reservation, the gateway call and the INDETERMINATE outcome. Under Razorpay
   * TEST credentials this performs a Test Mode refund operation; the code path is identical in Live
   * Mode and nothing is weakened because no real money is currently moving.
   */
  private async resolveLateCapture(
    payment: Payment,
    captured: { id: string; orderId: string; amountPaise?: number },
  ): Promise<{ handled: boolean; reason: string }> {
    const { opsAlertService } = await import("./ops-alert.service");
    const expectedPaise = Number(payment.amountPaise ?? rupeesToPaise(payment.amount));

    const reconciliationRequired = async (why: string, extra: Record<string, unknown> = {}) => {
      incCounter("late_capture_total", { outcome: "reconciliation_required", why });
      await opsAlertService.raise(
        "payment_captured_after_expiry",
        "CRITICAL",
        `Gateway capture ${captured.id} arrived after booking ${payment.bookingId} expired and could NOT be auto-refunded (${why}) — needs review`,
        {
          bookingId: payment.bookingId,
          paymentId: payment.id,
          gatewayPaymentId: captured.id,
          gatewayOrderId: captured.orderId,
          capturedPaise: captured.amountPaise ?? null,
          expectedPaise,
          why,
          ...extra,
        },
      );
      logger.error("late_capture_reconciliation_required", {
        category: "PAYMENT", bookingId: payment.bookingId, paymentId: payment.id, gatewayPaymentId: captured.id, why,
      });
      return { handled: true, reason: `RECONCILIATION_REQUIRED:${why}` };
    };

    incCounter("late_capture_total", { outcome: "detected" });

    // Identity: the capture must belong to the order this row holds.
    if (captured.orderId !== payment.razorpayOrderId) return reconciliationRequired("ORDER_MISMATCH");
    // Amount: an exact match, never "close enough" — a partial capture is a different conversation.
    if (captured.amountPaise == null || captured.amountPaise !== expectedPaise) {
      return reconciliationRequired("AMOUNT_MISMATCH");
    }
    // Nothing refunded yet, and no second payment row for the same booking.
    if ((payment.refundedAmount ?? 0) > 0) return reconciliationRequired("REFUND_ALREADY_EXISTS");
    if (payment.bookingId) {
      const paymentRows = await prisma.payment.count({ where: { bookingId: payment.bookingId } });
      if (paymentRows !== 1) return reconciliationRequired("MULTIPLE_PAYMENTS", { paymentRows });
      const booking = await prisma.booking.findUnique({
        where: { id: payment.bookingId },
        select: { status: true, paymentStatus: true },
      });
      if (!booking) return reconciliationRequired("BOOKING_NOT_FOUND");
      // Recovered in the meantime: the money may now belong to a live booking, so do not refund it.
      if (String(booking.status) !== "EXPIRED") {
        return reconciliationRequired("BOOKING_RECOVERED", { bookingStatus: booking.status });
      }
    }

    // Bind the capture to the row first: the refund authority refunds `razorpayPaymentId`, and the
    // money must be traceable to this booking even if the refund itself does not complete.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        razorpayPaymentId: captured.id,
        // Record what the gateway actually took. This is the fact the refund ceiling is computed
        // from (`amountPaid - refundedAmount`), which is what makes refund_total <= captured_total
        // true by construction rather than by a separate check.
        amountPaid: payment.amount,
        amountPaidPaise: BigInt(expectedPaise),
        metadata: JSON.stringify({
          ...this.parsePaymentMetadata(payment.metadata),
          capturedAfterExpiry: { gatewayPaymentId: captured.id, amountPaise: captured.amountPaise ?? null, at: new Date().toISOString() },
        } as PaymentOrderMetadata),
      },
    });

    incCounter("late_capture_total", { outcome: "auto_refund_eligible" });
    const { refundOrchestratorService } = await import("./refund-orchestrator.service");
    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount: payment.amount,
      reason: "Payment captured after the booking's payment window expired",
      actorUserId: "system:late-capture",
      // A platform-authorised refund, not a customer or admin action. `source: "workflow"` keeps it
      // distinguishable in the refund audit from a support-issued refund.
      isAdmin: true,
      source: "workflow",
      idempotencyKey: `late_capture:${payment.id}:${captured.id}`,
      bookingId: payment.bookingId ?? undefined,
    });

    if ("refundId" in result) {
      incCounter("late_capture_total", { outcome: "auto_refunded" });
      logger.warn("late_capture_auto_refunded", {
        category: "PAYMENT",
        bookingId: payment.bookingId,
        paymentId: payment.id,
        gatewayPaymentId: captured.id,
        gatewayRefundId: result.refundId,
        amount: result.amount,
      });
      return { handled: true, reason: "LATE_CAPTURE_AUTO_REFUNDED" };
    }
    // The refund authority refused or could not determine the outcome. Both are reconciliation
    // matters; neither is retried here, because retrying an unknown refund is how one becomes two.
    return reconciliationRequired(`REFUND_${result.error}`, { indeterminate: result.indeterminate ?? false });
  }

  /**
   * §27 — a webhook may not flip the state of a payment that belongs to the OTHER gateway world.
   *
   * The webhook's environment is the payload's `livemode` when present (Razorpay does not send
   * one today), otherwise the world this process's credential belongs to — the same credential
   * whose webhook secret verified the delivery. A stored environment that disagrees means a test
   * event is aimed at a live-stamped payment (or the reverse): the state change is refused and
   * left to reconciliation. UNKNOWN (NULL — historical) rows keep the historical behaviour.
   * Never throws: an unreadable column must not take the webhook path down.
   */
  private async webhookEnvironmentRefusal(
    event: RazorpayWebhookEvent,
    paymentId: string,
  ): Promise<{ handled: boolean; reason: string } | null> {
    try {
      const stored = await readPaymentEnvironment(prisma, paymentId);
      if (!stored) return null;
      const webhookEnv =
        typeof event.livemode === "boolean" ? (event.livemode ? "LIVE" : "TEST") : processGatewayEnvironment();
      if (!webhookEnv || webhookEnv === stored) return null;
      incCounter("webhook_env_mismatch_total", { stored, webhook: webhookEnv });
      logger.error("payments.webhook.environment_mismatch — refusing state change", {
        paymentId,
        stored,
        webhookEnvironment: webhookEnv,
        event: event.event,
      });
      return { handled: false, reason: "PAYMENT_ENV_MISMATCH" };
    } catch {
      return null;
    }
  }

  async reconcileFromWebhook(event: RazorpayWebhookEvent): Promise<{ handled: boolean; reason: string }> {
    const kind = event.event;

    if (kind === "payment.authorized") {
      return { handled: true, reason: "AUTHORIZED_AWAITING_CAPTURE" };
    }

    if (kind === "payment.captured") {
      const p = event.payload.payment?.entity;
      if (!p?.id || !p.order_id) return { handled: false, reason: "MISSING_FIELDS" };

      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (!payment) {
        // A capture on an order a retry REPLACED used to fall through to PAYMENT_NOT_FOUND and be
        // marked processed — real money silently dropped. Resolve it against the replaced order first.
        const replaced = await this.findPaymentByReplacedOrder(p.order_id);
        if (replaced) return this.reconcileReplacedOrderCapture(event, replaced, { id: p.id, orderId: p.order_id, amountPaise: p.amount });

        const walletResult = await walletService.reconcileTopUpFromWebhook(p.order_id, p.id);
        if (walletResult.handled) return { handled: walletResult.handled, reason: walletResult.reason };

        const giftResult = await giftCardService.reconcileFromWebhook(p.order_id, p.id);
        if (giftResult.handled) return giftResult;

        const subResult = await subscriptionService.reconcileFromWebhook(p.order_id, p.id);
        if (subResult.handled) return subResult;

        return { handled: false, reason: "PAYMENT_NOT_FOUND" };
      }

      if (isCapturedPaymentStatus(payment.status) && payment.razorpayPaymentId === p.id) {
        return { handled: true, reason: "ALREADY_RECONCILED" };
      }

      const envRefusal = await this.webhookEnvironmentRefusal(event, payment.id);
      if (envRefusal) return envRefusal;

      /**
       * Money captured AFTER the payment window closed (PAYMENT_PENDING_TTL).
       *
       * The booking was expired and its capacity RELEASED — the slot may already belong to someone
       * else. Settling this capture would confirm a booking that no longer holds a slot, and could
       * double-book a partner. So this path deliberately does not confirm anything.
       *
       * What it does instead: bind the gateway payment id to the row so the money is traceable to a
       * real booking, record that this was a late capture, and raise a CRITICAL ops alert naming
       * every identifier needed to refund it. The refund itself is NOT issued automatically — moving
       * a customer's money back is an instruction, not an inference, and the platform's refund path
       * is owner-operated. Returning `handled` stops the gateway retrying a delivery nothing more
       * can be done with.
       */
      if (payment.status === ("EXPIRED" as typeof payment.status)) {
        incCounter("payment_captured_after_expiry_total");
        await prisma.payment.updateMany({
          where: { id: payment.id, status: payment.status },
          data: {
            razorpayPaymentId: p.id,
            metadata: JSON.stringify({
              ...this.parsePaymentMetadata(payment.metadata),
              capturedAfterExpiry: { gatewayPaymentId: p.id, amountPaise: p.amount ?? null, at: new Date().toISOString() },
            } as PaymentOrderMetadata),
          },
        });
        return this.resolveLateCapture(payment, { id: p.id, orderId: p.order_id!, amountPaise: p.amount });
      }
      if (payment.paymentMethod === SPLIT_PAYMENT_METHOD) {
        // A split order's capture is only the gateway leg. Settling it here as a plain payment marked
        // the booking fully paid while the wallet share was never debited.
        const { walletCheckoutService } = await import("./wallet-checkout.service");
        return walletCheckoutService.settleSplitFromWebhook(payment.id, p.id);
      }
      if (isCapturedPaymentStatus(payment.status) && payment.razorpayPaymentId !== p.id) {
        return { handled: false, reason: "PAYMENT_ID_CONFLICT" };
      }

      try {
        await financialTransactionManager.executeWithLedger({
          journal: financialLedgerService.journalForBookingPayment(payment.id, payment.amount),
          mutate: async (tx) => {
            await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
            const locked = await tx.payment.findUnique({ where: { id: payment.id }, include: { booking: true } });
            if (!locked) throw new Error("PAYMENT_NOT_FOUND");
            if (isCapturedPaymentStatus(locked.status)) {
              if (locked.razorpayPaymentId === p.id) return locked;
              throw new Error("PAYMENT_ALREADY_SETTLED");
            }
            const reused = await tx.payment.findFirst({
              where: { razorpayPaymentId: p.id, NOT: { id: payment.id } },
              select: { id: true },
            });
            if (reused) throw new Error("PAYMENT_ID_REUSED");

            const updated = await tx.payment.update({
              where: { id: payment.id },
              data: {
                razorpayPaymentId: p.id,
                status: PaymentStatus.SUCCESS,
                completedAt: new Date(),
                amountPaid: locked.amount,
                amountPaidPaise: rupeesToPaise(locked.amount),
                invoiceNumber: invoiceNumberFor(locked.booking.bookingNumber),
              },
            });
            await applyBookingPaymentSuccess(tx, locked.bookingId, {
              capturedAmount: locked.amount,
              source: "razorpay_webhook",
            });
            await emitPaymentSuccessInTransaction(tx, locked, updated.completedAt ?? new Date());
            return updated;
          },
        });
      } catch (error) {
        return {
          handled: false,
          reason: error instanceof Error ? error.message : "RECONCILE_FAILED",
        };
      }

      if (payment.userId) {
        recordFinancialMetric("payment_success_total", 1);
      }
      onBookingPaymentSettledBackground(payment.bookingId, "razorpay_webhook");

      return { handled: true, reason: "RECONCILED" };
    }

    if (kind === "payment.failed") {
      const p = event.payload.payment?.entity;
      if (!p?.order_id) return { handled: false, reason: "MISSING_FIELDS" };
      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (!payment) return { handled: false, reason: "PAYMENT_NOT_FOUND" };
      if (payment.status === PaymentStatus.SUCCESS) return { handled: true, reason: "IGNORED_ALREADY_SUCCESS" };
      const envRefusal = await this.webhookEnvironmentRefusal(event, payment.id);
      if (envRefusal) return envRefusal;
      const failedAt = new Date();
      const marked = await prisma.$transaction(async (tx) => {
        // Guarded: a capture that committed after the read above must not be overwritten by a
        // late or out-of-order failure of an earlier attempt on the same order.
        const failed = await tx.payment.updateMany({
          where: { id: payment.id, status: { notIn: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDING] } },
          data: { status: PaymentStatus.FAILED },
        });
        if (failed.count === 0) return false;
        await tx.booking.updateMany({
          where: { id: payment.bookingId, paymentStatus: { not: PaymentStatus.SUCCESS } },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.paymentEventsEnabled && payment.userId) {
          await emitPaymentFailedInTransaction(tx, payment, "gateway_failed", failedAt);
        }
        return true;
      });
      if (!marked) return { handled: true, reason: "IGNORED_ALREADY_SETTLED" };
      recordFinancialMetric("payment_failed_total", 1);
      return { handled: true, reason: "MARKED_FAILED" };
    }

    if (kind === "refund.processed" || kind === "refund.failed") {
      const r = event.payload.refund?.entity;
      if (!r?.payment_id) return { handled: false, reason: "MISSING_FIELDS" };
      if (kind === "refund.failed") {
        return refundLedgerSyncService.syncFromWebhook({
          razorpayPaymentId: r.payment_id,
          refundId: r.id ?? `failed_${r.payment_id}`,
          refundStatus: "failed",
          refundAmountPaise: r.amount,
        });
      }
      return refundLedgerSyncService.syncFromWebhook({
        razorpayPaymentId: r.payment_id,
        refundId: r.id ?? `refund_${r.payment_id}`,
        refundStatus: r.status ?? "processed",
        refundAmountPaise: r.amount,
      });
    }

    if (kind === "settlement.processed" || kind === "settlement.completed") {
      const s = (event.payload as { settlement?: { entity?: Record<string, unknown> } }).settlement?.entity;
      return settlementChargebackService.recordSettlementFromWebhook({
        settlementId: String(s?.id ?? ""),
        amount: typeof s?.amount === "number" ? s.amount / 100 : undefined,
        fee: typeof s?.fees === "number" ? s.fees / 100 : undefined,
        tax: typeof s?.tax === "number" ? s.tax / 100 : undefined,
        status: "settled",
        settledAt: new Date(),
        gatewayReference: typeof s?.utr === "string" ? s.utr : String(s?.id ?? ""),
        raw: s,
      });
    }

    if (kind.startsWith("payout.")) {
      const p = (event.payload as { payout?: { entity?: { id?: string; status?: string; failure_reason?: string } } }).payout?.entity;
      if (!p?.id) return { handled: false, reason: "MISSING_PAYOUT_ID" };
      return earningsService.reconcilePayoutFromWebhook(p.id, p.status ?? kind.replace("payout.", ""), p.failure_reason);
    }

    if (kind.startsWith("payment.dispute.") || kind === "dispute.created" || kind === "dispute.updated" || kind.startsWith("chargeback.")) {
      const d = (event.payload as { dispute?: { entity?: Record<string, unknown> } }).dispute?.entity;
      return settlementChargebackService.recordChargebackFromWebhook({
        disputeId: String(d?.id ?? ""),
        paymentId: String(d?.payment_id ?? ""),
        amount: typeof d?.amount === "number" ? d.amount / 100 : undefined,
        reason: typeof d?.reason_code === "string" ? d.reason_code : undefined,
        status: typeof d?.status === "string" ? d.status : undefined,
        raw: d,
      });
    }

    return { handled: false, reason: "UNHANDLED_EVENT" };
  }

  async history(userId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: { userId: string; status?: PaymentStatus } = { userId };
    if (query.status) where.status = query.status.toUpperCase() as PaymentStatus;

    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { booking: { select: { bookingNumber: true } } },
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments: rows.map((p) => ({
        id: p.id,
        bookingNumber: p.booking.bookingNumber,
        amount: p.amount,
        status: paymentStatusApi(p.status),
        paymentMethod: p.paymentMethod,
        completedAt: p.completedAt,
      })),
      total,
      page,
    };
  }
}

export const paymentService = new PaymentService();
