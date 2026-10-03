import { rupeesToPaise } from "../lib/money-paise";
import { PaymentStatus, ReconciliationStatus, RefundRequestStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { razorpayService } from "./razorpay.service";
import { releaseRefundingPayment } from "./refund-orchestrator.service";
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
    outcome: "CONFIRMED" | "NOT_AT_GATEWAY" | "NOT_INDETERMINATE" | "PAYMENT_NOT_FOUND" | "LOOKUP_FAILED";
  }> {
    const rr = await prisma.refundRequest.findUnique({ where: { id: refundRequestId } });
    if (!rr || rr.status !== RefundRequestStatus.INDETERMINATE) {
      return { resolved: false, outcome: "NOT_INDETERMINATE" };
    }
    const payment = await prisma.payment.findUnique({ where: { id: rr.paymentId } });
    if (!payment?.razorpayPaymentId) return { resolved: false, outcome: "PAYMENT_NOT_FOUND" };

    const gatewayRefunds = await razorpayService.fetchRefundsForPayment(payment.razorpayPaymentId);
    // The gateway could not be read. That settles nothing: the refund stays INDETERMINATE and the
    // payment stays held, and the next sweep asks again.
    if (gatewayRefunds === null) return { resolved: false, outcome: "LOOKUP_FAILED" };
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
      releaseRefundingPayment(prisma, payment.id),
    ]);
    recordFinancialMetric("refund_indeterminate_resolved_total", 1);
    return { resolved: true, outcome: "NOT_AT_GATEWAY" };
  }

  /**
   * The gateway has finished a refund: say so on the payment and, for a cancellation refund, on the
   * booking the customer is looking at.
   *
   * A refund the gateway accepts as `pending` leaves `payments.refund_status = pending` and
   * `bookings.refund_status = processing`. Nothing else moved them — the ledger is written once, when
   * the refund is accepted, so this webhook normally lands on ALREADY_SYNCED — and a finished refund
   * read "in progress" forever (found by the coding-phase certification, 2026-09-27). Status only: no
   * amount, no journal. Every write is conditional, so a replayed webhook is a no-op. The booking rule
   * is the recovery sweep's (`cancel-refund:<bookingId>` only): an admin partial refund on a live
   * booking is not a cancellation refund and must not claim to be one.
   */
  private async markGatewayRefundProcessed(paymentId: string, refundId: string): Promise<void> {
    await prisma.payment.updateMany({
      where: {
        id: paymentId,
        razorpayRefundId: refundId,
        OR: [{ refundStatus: null }, { refundStatus: { not: "processed" } }],
      },
      data: { refundStatus: "processed" },
    });
    const request = await prisma.refundRequest.findFirst({
      where: {
        paymentId,
        OR: [{ gatewayRefundId: refundId }, { razorpayRefundId: refundId }],
        idempotencyKey: { startsWith: "cancel-refund:" },
      },
      select: { idempotencyKey: true },
    });
    if (!request) return;
    await prisma.booking.updateMany({
      where: { id: request.idempotencyKey.slice("cancel-refund:".length), refundStatus: { in: ["pending", "processing"] } },
      data: { refundStatus: "processed" },
    });
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
    // The journal keyed by THIS refund id is the idempotency authority: it is written in the same
    // transaction as the refundedAmount change (here and in the refund orchestrator). The previous
    // extra condition `payment.razorpayRefundId === refundId` only held for the LATEST refund, so a
    // replayed or out-of-order webhook for an earlier partial refund added its amount a second time.
    if (existingJournal) {
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
      if (opts.refundStatus === "processed") await this.markGatewayRefundProcessed(payment.id, opts.refundId);
      return { handled: true, reason: "ALREADY_SYNCED" };
    }

    const applied = await financialTransactionManager.executeWithLedger({
      journal: financialLedgerService.journalForRefund(payment.id, amount, opts.refundId),
      mutate: async (tx) => {
        /**
         * This branch only runs for a refund id that has no journal yet (see ALREADY_SYNCED
         * above), so the gateway amount is a NEW refund and must ADD to what was already refunded.
         * `max(prev, amount)` collapsed two partial refunds into one, and the unconditional
         * REFUNDED mislabelled a half-refunded payment.
         */
        await tx.$executeRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
        // Re-checked under the payment lock: two concurrent deliveries of the same refund both
        // passed the pre-check above, and executeWithLedger only dedupes the JOURNAL after mutate —
        // so without this the second delivery added the amount again.
        if (await tx.journalEntry.findUnique({ where: { idempotencyKey } })) return { paymentId: payment.id, duplicate: true };
        const locked = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          select: { amount: true, amountPaid: true, refundedAmount: true },
        });
        const paid = locked.amountPaid || locked.amount;
        const newRefundedTotal = Math.min(paid, Math.round(((locked.refundedAmount ?? 0) + amount) * 100) / 100);
        const fullyRefunded = newRefundedTotal >= paid - 0.005;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            razorpayRefundId: opts.refundId,
            refundStatus: opts.refundStatus,
            refundedAmount: newRefundedTotal,
            refundedAmountPaise: rupeesToPaise(newRefundedTotal),
          },
        });
        return { paymentId: payment.id, duplicate: false };
      },
    });
    if (applied.duplicate) {
      await this.resolveIndeterminateRefund(payment.id, opts.refundId, amount, opts.operationKey);
      if (opts.refundStatus === "processed") await this.markGatewayRefundProcessed(payment.id, opts.refundId);
      return { handled: true, reason: "ALREADY_SYNCED" };
    }

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
    if (opts.refundStatus === "processed") await this.markGatewayRefundProcessed(payment.id, opts.refundId);
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
