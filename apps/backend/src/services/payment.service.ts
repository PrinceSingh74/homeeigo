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
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";
import { AuditLogService } from "./audit-log.service";
import { giftCardService } from "./gift-card.service";
import { subscriptionService } from "./subscription.service";
import { settlementChargebackService } from "./settlement-chargeback.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { refundLedgerSyncService } from "./refund-ledger-sync.service";
import { earningsService } from "./earnings.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { financialRiskService } from "./financial-risk.service";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { eventPlatformConfig } from "../events/core/config";
import { emitPaymentFailedInTransaction, emitPaymentSuccessInTransaction } from "../events/core/payment-outbox";

type PaymentOrderMetadata = {
  previousRazorpayOrderIds?: string[];
};

const GATEWAY_ORDER_POLL_MS = 50;
const GATEWAY_ORDER_TIMEOUT_MS = 10_000;

export class PaymentService {
  buildOrderIdempotencyKey(bookingId: string): string {
    return `booking_order:${bookingId}`;
  }

  private isPendingGatewayOrder(orderId: string): boolean {
    return orderId.startsWith("pending:");
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
    if (Date.now() - reservedAt.getTime() > GATEWAY_ORDER_TIMEOUT_MS) {
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

    const order = await razorpayService.createOrder(booking.finalAmount, booking.bookingNumber, {
      bookingId: booking.id,
    });

    const updated = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.FAILED,
        razorpayOrderId: payment.razorpayOrderId,
      },
      data: {
        amount: booking.finalAmount,
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

    const idempotencyKey = this.buildOrderIdempotencyKey(bookingId);
    const finalAmount = booking.finalAmount;

    let { payment, createdReservation } = await this.reservePaymentIntent(
      userId,
      bookingId,
      idempotencyKey,
      finalAmount,
      booking.paymentMethod,
    );

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
    const order = await razorpayService.createOrder(finalAmount, booking.bookingNumber, {
      bookingId,
    });

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

    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: PaymentStatus.INITIATED },
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

    if (payment.status === PaymentStatus.SUCCESS && payment.razorpayPaymentId === body.razorpayPaymentId) {
      return { paymentId: payment.id, status: "success", bookingId: payment.bookingId };
    }
    if (payment.status === PaymentStatus.SUCCESS && payment.razorpayPaymentId !== body.razorpayPaymentId) {
      return { error: "ALREADY_SETTLED" as const };
    }

    try {
      await financialTransactionManager.executeWithLedger({
        journal: financialLedgerService.journalForBookingPayment(payment.id, payment.amount),
        mutate: async (tx) => {
          const locked = await tx.payment.findUnique({ where: { id: payment.id } });
          if (!locked) throw new Error("PAYMENT_NOT_FOUND");
          if (locked.status === PaymentStatus.SUCCESS) {
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
              invoiceNumber: invoiceNumberFor(payment.booking.bookingNumber),
            },
          }).then(async (updated) => {
            await tx.booking.update({
              where: { id: payment.bookingId },
              data: { paymentStatus: PaymentStatus.SUCCESS, status: payment.booking.providerId ? "ACCEPTED" : "PENDING" },
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

    if (payment.userId) {
      recordFinancialMetric("payment_success_total", 1);

      await notificationService.createForUser({
        userId: payment.userId,
        type: "payment_completed",
        title: "Payment Received",
        message: `Payment of ₹${payment.amount} received for booking`,
        referenceId: payment.id,
        priority: "high",
      });

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
      return { error: result.error as "FORBIDDEN" | "NOT_FOUND" | "INVALID_AMOUNT" | "NOT_REFUNDABLE" | "AMOUNT_EXCEEDS_REFUNDABLE" };
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
  async reconcilePendingOrders(): Promise<{ giftCards: number; subscriptions: number }> {
    const [giftCards, subscriptions] = await Promise.all([
      giftCardService.reconcilePendingFromOrders(),
      subscriptionService.reconcilePendingFromOrders(),
    ]);
    const recovered = giftCards + subscriptions;
    if (recovered > 0) {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        emailDeliveryService.sendRecoveryAlert(
          adminEmail,
          "Payment reconciliation recovered orders",
          `Recovered ${giftCards} gift card(s) and ${subscriptions} subscription(s) from pending Razorpay orders.`,
        );
      }
    }
    return { giftCards, subscriptions };
  }

  async reconcileFromWebhook(event: {
    event: string;
    payload: {
      payment?: { entity?: { id?: string; order_id?: string; status?: string; amount?: number } };
      refund?: { entity?: { id?: string; payment_id?: string; status?: string; amount?: number } };
    };
  }): Promise<{ handled: boolean; reason: string }> {
    const kind = event.event;

    if (kind === "payment.authorized") {
      return { handled: true, reason: "AUTHORIZED_AWAITING_CAPTURE" };
    }

    if (kind === "payment.captured") {
      const p = event.payload.payment?.entity;
      if (!p?.id || !p.order_id) return { handled: false, reason: "MISSING_FIELDS" };

      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (!payment) {
        const walletResult = await walletService.reconcileTopUpFromWebhook(p.order_id, p.id);
        if (walletResult.handled) return { handled: walletResult.handled, reason: walletResult.reason };

        const giftResult = await giftCardService.reconcileFromWebhook(p.order_id, p.id);
        if (giftResult.handled) return giftResult;

        const subResult = await subscriptionService.reconcileFromWebhook(p.order_id, p.id);
        if (subResult.handled) return subResult;

        return { handled: false, reason: "PAYMENT_NOT_FOUND" };
      }

      if (payment.status === PaymentStatus.SUCCESS && payment.razorpayPaymentId === p.id) {
        return { handled: true, reason: "ALREADY_RECONCILED" };
      }
      if (payment.status === PaymentStatus.SUCCESS && payment.razorpayPaymentId !== p.id) {
        return { handled: false, reason: "PAYMENT_ID_CONFLICT" };
      }

      try {
        await financialTransactionManager.executeWithLedger({
          journal: financialLedgerService.journalForBookingPayment(payment.id, payment.amount),
          mutate: async (tx) => {
            const locked = await tx.payment.findUnique({ where: { id: payment.id }, include: { booking: true } });
            if (!locked) throw new Error("PAYMENT_NOT_FOUND");
            if (locked.status === PaymentStatus.SUCCESS) {
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
                invoiceNumber: invoiceNumberFor(locked.booking.bookingNumber),
              },
            });
            await tx.booking.update({
              where: { id: locked.bookingId },
              data: {
                paymentStatus: PaymentStatus.SUCCESS,
                status: locked.booking.providerId ? "ACCEPTED" : "PENDING",
              },
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

      return { handled: true, reason: "RECONCILED" };
    }

    if (kind === "payment.failed") {
      const p = event.payload.payment?.entity;
      if (!p?.order_id) return { handled: false, reason: "MISSING_FIELDS" };
      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (!payment) return { handled: false, reason: "PAYMENT_NOT_FOUND" };
      if (payment.status === PaymentStatus.SUCCESS) return { handled: true, reason: "IGNORED_ALREADY_SUCCESS" };
      const failedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED },
        });
        await tx.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.paymentEventsEnabled && payment.userId) {
          await emitPaymentFailedInTransaction(tx, payment, "gateway_failed", failedAt);
        }
      });
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
