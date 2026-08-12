import { PaymentStatus, ReconciliationStatus, RefundRequestStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { razorpayService } from "./razorpay.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

/**
 * Syncs Razorpay refund webhooks with ledger, cashback reversal, and audit trail.
 */
export class RefundLedgerSyncService {
  /**
   * Settles a refund the application could not confirm at the time it was attempted.
   *
   * The gateway has now told us the refund exists, which is the fact the INDETERMINATE record was
   * waiting for. Resolving it does three things that matter: it attaches the gateway id that was
   * missing, it releases the payment from REFUNDING so legitimate refunds are no longer blocked,
   * and it appends a RECONCILED_SUCCESS audit entry rather than editing the OUTCOME_UNKNOWN one.
   * The history has to keep both — "we did not know, and then we found out" is the record an
   * auditor needs, and a status field alone cannot express it.
   *
   * Matching is by amount within the payment. Razorpay echoes our `notes.homigo_operation`, which
   * is the exact identity, but the webhook payload is not guaranteed to carry notes, so the
   * operation key is used when present and the amount is the fallback.
   */
  private async resolveIndeterminateRefund(
    paymentId: string,
    gatewayRefundId: string,
    amount: number,
    operationKey?: string,
  ): Promise<void> {
    const pending = await prisma.refundRequest.findFirst({
      where: {
        paymentId,
        status: RefundRequestStatus.INDETERMINATE,
        ...(operationKey ? { idempotencyKey: operationKey } : { amount }),
      },
      orderBy: { createdAt: "asc" },
    });
    if (!pending) return;

    await prisma.refundRequest.update({
      where: { id: pending.id },
      data: {
        status: RefundRequestStatus.COMPLETED,
        gatewayRefundId,
        razorpayRefundId: gatewayRefundId,
        processedAt: new Date(),
        audits: {
          create: {
            action: "RECONCILED_SUCCESS",
            actorId: "system:reconciliation",
            details: `gateway confirmed ${gatewayRefundId}; outcome was previously unknown`,
          },
        },
      },
    });
    recordFinancialMetric("refund_indeterminate_resolved_total", 1);
  }

  /**
   * Settles an INDETERMINATE refund by asking the gateway what it actually holds.
   *
   * This is a pure read. It does not re-attempt the refund, which is the distinction that keeps
   * it inside the no-automatic-retry rule: the question asked is "what happened", never "do it
   * again". The operation identity travels in Razorpay's `notes` as `homigo_operation`, so a
   * refund found there is matched to the exact operation rather than guessed at by amount.
   *
   * When the gateway has the refund, the existing webhook path does the settling — journal,
   * payment state, audit — so there is one implementation of "a refund became real", not two.
   * When the gateway does not have it, the operation is resolved to FAILED and the payment is
   * released, because the refund provably never existed.
   */
  async reconcileIndeterminateRefund(refundRequestId: string): Promise<{
    resolved: boolean;
    outcome: "CONFIRMED" | "NOT_AT_GATEWAY" | "NOT_INDETERMINATE" | "PAYMENT_NOT_FOUND";
  }> {
    const rr = await prisma.refundRequest.findUnique({ where: { id: refundRequestId } });
    if (!rr || rr.status !== RefundRequestStatus.INDETERMINATE) {
      return { resolved: false, outcome: "NOT_INDETERMINATE" };
    }
    const payment = await prisma.payment.findUnique({ where: { id: rr.paymentId } });
    if (!payment?.razorpayPaymentId) return { resolved: false, outcome: "PAYMENT_NOT_FOUND" };

    const gatewayRefunds = await razorpayService.fetchRefundsForPayment(payment.razorpayPaymentId);
    const match = gatewayRefunds.find((g) => g.notes?.homigo_operation === rr.idempotencyKey);

    if (match) {
      await this.syncFromWebhook({
        razorpayPaymentId: payment.razorpayPaymentId,
        refundId: match.id,
        refundStatus: match.status ?? "processed",
        refundAmountPaise: match.amount,
        operationKey: rr.idempotencyKey,
      });
      return { resolved: true, outcome: "CONFIRMED" };
    }

    // Absent from the gateway means it was never created — the one case where an unknown
    // outcome can be safely downgraded to a definite failure.
    await prisma.$transaction([
      prisma.refundRequest.update({
        where: { id: rr.id },
        data: {
          status: RefundRequestStatus.FAILED,
          audits: {
            create: {
              action: "RECONCILED_NOT_FOUND",
              actorId: "system:reconciliation",
              details: "gateway holds no refund for this operation; outcome resolved to failed",
            },
          },
        },
      }),
      prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.REFUNDING },
        data: { status: PaymentStatus.SUCCESS },
      }),
    ]);
    recordFinancialMetric("refund_indeterminate_resolved_total", 1);
    return { resolved: true, outcome: "NOT_AT_GATEWAY" };
  }

  async syncFromWebhook(opts: {
    razorpayPaymentId: string;
    refundId: string;
    refundStatus: string;
    refundAmountPaise?: number;
    /** Our operation identity, when the caller knows it. Makes the match exact rather than by amount. */
    operationKey?: string;
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
      /**
       * The financial effect is already recorded — but an operation may still be sitting in
       * INDETERMINATE waiting to learn exactly that.
       *
       * This guard exists to stop a second ledger write, and it still does. What it must not do
       * is also swallow the state transition, which is what left a refund unresolved forever
       * when the webhook won the race against our own record of the attempt: the webhook
       * synchronised the payment before `markRefundIndeterminate` had written the row, so there
       * was nothing to resolve at the time, and every later reconciliation stopped here.
       *
       * Resolving costs nothing financially. `resolveIndeterminateRefund` writes only to
       * `refund_requests` — no journal, no ledger, no payment — so it cannot duplicate an
       * effect, and it matches on `status: INDETERMINATE`, so running it twice is a no-op.
       */
      await this.resolveIndeterminateRefund(payment.id, opts.refundId, amount, opts.operationKey);
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

    await this.resolveIndeterminateRefund(payment.id, opts.refundId, amount, opts.operationKey);
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
