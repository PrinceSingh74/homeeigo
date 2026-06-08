import { PaymentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { paymentStatusApi } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { razorpayService } from "./razorpay.service";
import { notificationService } from "./notification.service";
import { walletService } from "./wallet.service";
import { invoiceNumberFor } from "./invoice.service";
import { emailService } from "./email.service";
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

export class PaymentService {
  async createOrder(userId: string, bookingId: string) {
    const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId } });
    if (!booking) return null;
    const existing = await prisma.payment.findUnique({ where: { bookingId } });
    if (existing?.status === PaymentStatus.SUCCESS) {
      return {
        razorpayOrderId: existing.razorpayOrderId ?? "",
        amount: existing.amount,
        currency: "INR",
        key: razorpayService.keyId,
        notes: { bookingId },
      };
    }
    // Backend is the single source of truth for the charge: always use the
    // booking's authoritative finalAmount, never a client-supplied amount.
    const finalAmount = booking.finalAmount;
    const order = await razorpayService.createOrder(finalAmount, booking.bookingNumber, {
      bookingId,
    });

    await prisma.payment.upsert({
      where: { bookingId },
      create: {
        bookingId,
        userId,
        amount: finalAmount,
        paymentMethod: booking.paymentMethod ?? "razorpay",
        razorpayOrderId: order.orderId,
        status: PaymentStatus.INITIATED,
      },
      update: {
        amount: finalAmount,
        razorpayOrderId: order.orderId,
        status: PaymentStatus.INITIATED,
      },
    });

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

      // Payment receipt email (dev: console; prod: Resend) — never blocks the response.
      const u = await prisma.user.findUnique({
        where: { id: payment.userId },
        select: { email: true, firstName: true },
      });
      if (u?.email) {
        void emailService
          .send({
            to: u.email,
            subject: `Payment received — ₹${payment.amount} · HOMIGO`,
            html: `<p>Hi ${u.firstName ?? "there"},</p><p>We've received your payment of <b>₹${payment.amount}</b> for booking <b>${payment.booking.bookingNumber}</b>. Your invoice is available in Wallet → Invoices.</p><p>— HOMIGO</p>`,
          })
          .catch(() => {});
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

  /**
   * Booking cancellation refund — Razorpay only, idempotent, no direct wallet credit.
   */
  async refundForBookingCancellation(
    bookingId: string,
    reason: string,
    actorUserId: string,
  ): Promise<{ amount: number; status: string } | { error: string }> {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment || payment.status !== PaymentStatus.SUCCESS) {
      return { amount: 0, status: "none" };
    }

    const refundAmount = payment.amountPaid || payment.amount;
    const idempotencyKey = refundOrchestratorService.cancellationIdempotencyKey(bookingId);

    const existing = await prisma.refundRequest.findUnique({ where: { idempotencyKey } });
    if (existing?.status === "COMPLETED" && existing.gatewayRefundId) {
      return { amount: existing.amount, status: "processed" };
    }

    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount: refundAmount,
      reason,
      actorUserId,
      isAdmin: true,
      source: "cancellation",
      idempotencyKey,
      bookingId,
    });

    if ("error" in result) {
      if (result.error === "REFUND_IN_PROGRESS") {
        return { amount: refundAmount, status: "processing" };
      }
      return { error: result.error };
    }

    return { amount: result.amount, status: result.status };
  }

  /** Retry-safe activation for gift cards / subscriptions missed by client verify. */
  async reconcilePendingOrders(): Promise<{ giftCards: number; subscriptions: number }> {
    const [giftCards, subscriptions] = await Promise.all([
      giftCardService.reconcilePendingFromOrders(),
      subscriptionService.reconcilePendingFromOrders(),
    ]);
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
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      await prisma.booking.update({
        where: { id: payment.bookingId },
        data: { paymentStatus: PaymentStatus.FAILED },
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
