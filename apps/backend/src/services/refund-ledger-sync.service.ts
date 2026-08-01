import { PaymentStatus, ReconciliationStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

/**
 * Syncs Razorpay refund webhooks with ledger, cashback reversal, and audit trail.
 */
export class RefundLedgerSyncService {
  async syncFromWebhook(opts: {
    razorpayPaymentId: string;
    refundId: string;
    refundStatus: string;
    refundAmountPaise?: number;
  }): Promise<{ handled: boolean; reason: string }> {
    const payment = await prisma.payment.findFirst({
      where: { razorpayPaymentId: opts.razorpayPaymentId },
    });
    if (!payment) return { handled: false, reason: "PAYMENT_NOT_FOUND" };

    const amount =
      opts.refundAmountPaise != null ? opts.refundAmountPaise / 100 : payment.amountPaid || payment.amount;

    if (opts.refundStatus === "failed") {
      recordFinancialMetric("refund_failure_total", 1);
      recordFinancialMetric("refund_failed_total", 1);
      return { handled: true, reason: "REFUND_FAILED" };
    }

    const idempotencyKey = `refund:${opts.refundId}`;
    const existingJournal = await prisma.journalEntry.findUnique({ where: { idempotencyKey } });
    if (existingJournal && payment.razorpayRefundId === opts.refundId) {
      return { handled: true, reason: "ALREADY_SYNCED" };
    }

    await financialTransactionManager.executeWithLedger({
      journal: financialLedgerService.journalForRefund(payment.id, amount, opts.refundId),
      mutate: async (tx) => {
        const newRefundedTotal = Math.max(payment.refundedAmount ?? 0, amount);
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            razorpayRefundId: opts.refundId,
            refundStatus: opts.refundStatus,
            refundedAmount: newRefundedTotal,
          },
        });
        return { paymentId: payment.id };
      },
    });

    if (payment.bookingId) {
      await cashbackService.reverseOnRefund(payment.bookingId);
    }

    void AuditLogService.success("WEBHOOK_REFUND_SYNCED", {
      userId: payment.userId,
      bookingId: payment.bookingId ?? undefined,
      details: { paymentId: payment.id, refundId: opts.refundId, amount },
    });

    recordFinancialMetric("refund_success_total", 1);
    recordFinancialMetric("refund_total", 1);
    recordFinancialMetric("refund_amount_total", amount);

    await this.markReconciliationMatched(payment.id);

    return { handled: true, reason: "REFUND_LEDGER_SYNCED" };
  }

  private async markReconciliationMatched(paymentId: string) {
    const issue = await prisma.reconciliationIssue.findFirst({
      where: { referenceId: paymentId, issueType: ReconciliationStatus.REFUND_MISMATCH },
      orderBy: { createdAt: "desc" },
    });
    if (!issue) return;
    await prisma.reconciliationIssue.update({
      where: { id: issue.id },
      data: { details: `${issue.details ?? ""} — resolved via webhook ledger sync`.trim() },
    });
  }
}

export const refundLedgerSyncService = new RefundLedgerSyncService();
