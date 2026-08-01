import { PaymentStatus, RefundRequestStatus, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { rupeesToPaise } from "../lib/money-paise";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { refundOrchestratorService } from "./refund-orchestrator.service";
import { cancellationPolicyService, type CancellationActor } from "./cancellation-policy.service";
import { AuditLogService } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { notificationService } from "./notification.service";

const MAX_REFUND_RETRIES = 5;

export class BookingRefundService {
  async quoteForBooking(bookingId: string, cancelledBy: CancellationActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        finalAmount: true,
        scheduledDate: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
      },
    });
    if (!booking) return null;

    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    const paidAmount =
      payment?.status === PaymentStatus.SUCCESS
        ? payment.amountPaid || payment.amount
        : 0;

    return cancellationPolicyService.calculate({
      paidAmount: paidAmount || booking.finalAmount,
      scheduledDate: booking.scheduledDate,
      bookingStatus: booking.status,
      cancelledBy,
      paymentMethod: payment?.paymentMethod ?? booking.paymentMethod,
    });
  }

  /**
   * Process cancellation refund (idempotent). Wallet = instant credit; gateway = Razorpay + retry on fail.
   */
  async processCancellationRefund(opts: {
    bookingId: string;
    userId: string;
    actorUserId: string;
    reason: string;
    cancelledBy: CancellationActor;
    refundAmount: number;
  }): Promise<{ amount: number; status: string }> {
    const amount = Math.round(opts.refundAmount * 100) / 100;
    if (amount <= 0) return { amount: 0, status: "none" };

    const payment = await prisma.payment.findUnique({ where: { bookingId: opts.bookingId } });
    if (!payment || payment.status !== PaymentStatus.SUCCESS) {
      return { amount: 0, status: "none" };
    }

    const idempotencyKey = refundOrchestratorService.cancellationIdempotencyKey(opts.bookingId);
    const existing = await prisma.refundRequest.findUnique({ where: { idempotencyKey } });
    if (existing?.status === RefundRequestStatus.COMPLETED) {
      return { amount: existing.amount, status: "processed" };
    }

    const isWallet = payment.paymentMethod.toLowerCase() === "wallet";
    if (isWallet) {
      return this.creditWalletRefund({
        bookingId: opts.bookingId,
        userId: opts.userId,
        paymentId: payment.id,
        amount,
        reason: opts.reason,
        actorUserId: opts.actorUserId,
        idempotencyKey,
      });
    }

    if (!payment.razorpayPaymentId) {
      await this.markRefundPending(idempotencyKey, payment.id, opts.userId, amount, opts.reason, opts.actorUserId);
      return { amount, status: "pending" };
    }

    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount,
      reason: opts.reason,
      actorUserId: opts.actorUserId,
      isAdmin: true,
      source: "cancellation",
      idempotencyKey,
      bookingId: opts.bookingId,
    });

    if ("error" in result) {
      if (result.error === "REFUND_IN_PROGRESS") {
        return { amount, status: "processing" };
      }
      recordFinancialMetric("refund_failure_total", 1);
      return { amount, status: "pending" };
    }

    void this.notifyCustomerRefund(opts.userId, opts.bookingId, amount, "gateway");
    return { amount: result.amount, status: result.status === "processed" ? "processed" : "processing" };
  }

  private async creditWalletRefund(opts: {
    bookingId: string;
    userId: string;
    paymentId: string;
    amount: number;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<{ amount: number; status: string }> {
    const walletKey = `wallet-cancel-refund:${opts.bookingId}`;
    const existingTxn = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: walletKey },
    });
    if (existingTxn?.status === WalletTxnStatus.COMPLETED) {
      return { amount: opts.amount, status: "processed" };
    }

    try {
      await financialTransactionManager.executeWithLedger({
        journal: financialLedgerService.journalForWalletBookingRefund(opts.bookingId, opts.amount),
        mutate: async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: opts.userId },
            select: { walletBalance: true },
          });
          if (!user) throw new Error("USER_NOT_FOUND");

          const balanceBefore = user.walletBalance;
          const balanceAfter = round2(balanceBefore + opts.amount);
          const creditPaise = rupeesToPaise(opts.amount);

          await tx.user.update({
            where: { id: opts.userId },
            data: {
              walletBalance: { increment: opts.amount },
              walletBalancePaise: { increment: creditPaise },
            },
          });

          const walletTxn = await tx.walletTransaction.create({
            data: {
              transactionNumber: await nextWalletTxnNumber(tx),
              userId: opts.userId,
              amount: opts.amount,
              walletBalanceBefore: balanceBefore,
              walletBalanceAfter: balanceAfter,
              type: WalletTxnType.REFUND,
              description: `Booking cancellation refund`,
              referenceId: opts.bookingId,
              referenceType: "booking_cancel_refund",
              status: WalletTxnStatus.COMPLETED,
              idempotencyKey: walletKey,
            },
          });

          await tx.refundRequest.upsert({
            where: { idempotencyKey: opts.idempotencyKey },
            create: {
              paymentId: opts.paymentId,
              userId: opts.userId,
              amount: opts.amount,
              reason: opts.reason,
              status: RefundRequestStatus.COMPLETED,
              requestedBy: opts.actorUserId,
              idempotencyKey: opts.idempotencyKey,
              gatewayRefundId: `wallet:${walletTxn.id}`,
              processedAt: new Date(),
              audits: {
                create: { action: "COMPLETED", actorId: opts.actorUserId, details: "wallet_instant" },
              },
            },
            update: {
              status: RefundRequestStatus.COMPLETED,
              processedAt: new Date(),
              gatewayRefundId: `wallet:${walletTxn.id}`,
            },
          });

          await tx.payment.update({
            where: { id: opts.paymentId },
            data: {
              status: PaymentStatus.REFUNDED,
              refundedAmount: opts.amount,
              refundReason: opts.reason,
              refundStatus: "processed",
            },
          });

          return walletTxn;
        },
      });
    } catch (err) {
      recordFinancialMetric("refund_failure_total", 1);
      void AuditLogService.failure("BOOKING_CANCEL_REFUND", {
        userId: opts.actorUserId,
        bookingId: opts.bookingId,
        reason: err instanceof Error ? err.message : "wallet_refund_failed",
      });
      return { amount: opts.amount, status: "pending" };
    }

    void cashbackService.reverseOnRefund(opts.bookingId).catch(() => undefined);
    void AuditLogService.success("BOOKING_CANCEL_REFUND", {
      userId: opts.actorUserId,
      bookingId: opts.bookingId,
      details: { amount: opts.amount, channel: "wallet" },
    });
    void this.notifyCustomerRefund(opts.userId, opts.bookingId, opts.amount, "wallet");
    recordFinancialMetric("refund_success_total", 1);
    return { amount: opts.amount, status: "processed" };
  }

  private async markRefundPending(
    idempotencyKey: string,
    paymentId: string,
    userId: string,
    amount: number,
    reason: string,
    actorUserId: string,
  ) {
    await prisma.refundRequest.upsert({
      where: { idempotencyKey },
      create: {
        paymentId,
        userId,
        amount,
        reason,
        status: RefundRequestStatus.FAILED,
        requestedBy: actorUserId,
        idempotencyKey,
        audits: { create: { action: "FAILED", actorId: actorUserId, details: "awaiting_retry" } },
      },
      update: {
        status: RefundRequestStatus.FAILED,
        audits: { create: { action: "FAILED", actorId: actorUserId, details: "retry_scheduled" } },
      },
    });
  }

  async retryFailedRefunds(limit = 20): Promise<{ scanned: number; succeeded: number }> {
    const rows = await prisma.refundRequest.findMany({
      where: {
        status: RefundRequestStatus.FAILED,
        idempotencyKey: { startsWith: "cancel-refund:" },
      },
      take: limit,
      orderBy: { updatedAt: "asc" },
    });

    let succeeded = 0;
    for (const row of rows) {
      const retryCount = await prisma.refundAudit.count({
        where: { refundRequestId: row.id, action: "RETRY" },
      });
      if (retryCount >= MAX_REFUND_RETRIES) continue;

      const bookingId = row.idempotencyKey.replace("cancel-refund:", "");
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true, cancellationReason: true, cancelledBy: true },
      });
      if (!booking?.userId) continue;

      await prisma.refundAudit.create({
        data: { refundRequestId: row.id, action: "RETRY", actorId: "system", details: `attempt_${retryCount + 1}` },
      });

      const result = await this.processCancellationRefund({
        bookingId,
        userId: booking.userId,
        actorUserId: "system",
        reason: booking.cancellationReason ?? "Cancellation refund retry",
        cancelledBy: booking.cancelledBy === "provider" ? "provider" : "user",
        refundAmount: row.amount,
      });

      if (result.status === "processed" || result.status === "processing") {
        succeeded++;
        await prisma.booking.updateMany({
          where: { id: bookingId },
          data: { refundStatus: result.status, refundAmount: result.amount },
        });
      }
    }

    return { scanned: rows.length, succeeded };
  }

  private async notifyCustomerRefund(
    userId: string,
    bookingId: string,
    amount: number,
    channel: "wallet" | "gateway",
  ) {
    const body =
      channel === "wallet"
        ? `₹${amount} has been credited to your HOMEEIGO wallet instantly.`
        : `₹${amount} refund initiated — typically reflects in 5–7 business days on your original payment method.`;

    await notificationService.createForUser({
      userId,
      type: "refund_processed",
      title: "Refund processed",
      message: body,
      referenceId: bookingId,
      referenceType: "booking",
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const bookingRefundService = new BookingRefundService();
