import { PaymentStatus, RefundRequestStatus, type Payment, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { razorpayService } from "./razorpay.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { AuditLogService } from "./audit-log.service";
import { cashbackService } from "./cashback.service";
import { financialRiskService } from "./financial-risk.service";

export type RefundResult =
  | { refundId: string; status: string; amount: number; idempotencyKey: string }
  /**
   * `indeterminate` marks the one failure that is not a failure: the gateway outcome is unknown
   * and the refund may already exist. Callers must not treat it as "nothing happened" — no
   * automatic retry, no compensation, reconcile first.
   */
  | { error: string; blocked?: boolean; indeterminate?: boolean; idempotencyKey?: string };

export class RefundOrchestratorService {
  buildIdempotencyKey(paymentId: string, amount: number, source: string, actorUserId: string): string {
    return `refund:${paymentId}:${amount}:${source}:${actorUserId}`;
  }

  async executeRefund(opts: {
    paymentId: string;
    amount: number;
    reason: string;
    actorUserId: string;
    isAdmin: boolean;
    source: "admin" | "cancellation" | "workflow";
    idempotencyKey?: string;
    bookingId?: string;
  }): Promise<RefundResult> {
    if (!opts.isAdmin && opts.source !== "cancellation") {
      return { error: "FORBIDDEN" };
    }

    const idempotencyKey =
      opts.idempotencyKey ?? this.buildIdempotencyKey(opts.paymentId, opts.amount, opts.source, opts.actorUserId);

    recordFinancialMetric("refund_attempt_total", 1);

    const existing = await prisma.refundRequest.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.status === RefundRequestStatus.COMPLETED && existing.gatewayRefundId) {
        return {
          refundId: existing.gatewayRefundId,
          status: "processed",
          amount: existing.amount,
          idempotencyKey,
        };
      }
      if (existing.status === RefundRequestStatus.REFUNDING || existing.status === RefundRequestStatus.PROCESSING) {
        recordFinancialMetric("refund_race_blocked_total", 1);
        return { error: "REFUND_IN_PROGRESS", blocked: true };
      }
      /**
       * An unknown outcome is terminal for automatic purposes. Replaying it returns the same
       * unknown state and never reaches the gateway a second time — re-calling is exactly the
       * double-refund path this status exists to prevent. FAILED still falls through below, so a
       * genuine retry after a genuine, definite failure continues to work.
       */
      if (existing.status === RefundRequestStatus.INDETERMINATE) {
        recordFinancialMetric("refund_indeterminate_replay_total", 1);
        return { error: "REFUND_OUTCOME_UNKNOWN", indeterminate: true, idempotencyKey };
      }
    }

    type LockResult =
      | { proceed: false; result: RefundResult }
      | { proceed: true; payment: Payment; refundRequestId: string };

    const lockResult = await prisma.$transaction(async (tx): Promise<LockResult> => {
      await tx.$executeRaw`SELECT id FROM payments WHERE id = ${opts.paymentId} FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id: opts.paymentId } });
      if (!payment) return { proceed: false, result: { error: "NOT_FOUND" } };

      const validation = validateAdminRefundAmount(opts.amount, payment);
      if (!validation.ok) {
        return { proceed: false, result: { error: validation.reason ?? "NOT_REFUNDABLE" } };
      }

      if (!payment.razorpayPaymentId) {
        return { proceed: false, result: { error: "NOT_REFUNDABLE" } };
      }

      if (payment.status === PaymentStatus.REFUNDING) {
        recordFinancialMetric("refund_race_blocked_total", 1);
        return { proceed: false, result: { error: "REFUND_IN_PROGRESS", blocked: true } };
      }

      const dup = await tx.refundRequest.findUnique({ where: { idempotencyKey } });
      if (dup) {
        if (dup.status === RefundRequestStatus.COMPLETED && dup.gatewayRefundId) {
          return {
            proceed: false,
            result: {
              refundId: dup.gatewayRefundId,
              status: "processed",
              amount: dup.amount,
              idempotencyKey,
            },
          };
        }
        if (dup.status === RefundRequestStatus.REFUNDING || dup.status === RefundRequestStatus.PROCESSING) {
          recordFinancialMetric("refund_race_blocked_total", 1);
          return { proceed: false, result: { error: "REFUND_IN_PROGRESS", blocked: true } };
        }
        // Same guard as the pre-lock check, repeated inside the lock so a racing caller that
        // slipped past it cannot re-enter the gateway either.
        if (dup.status === RefundRequestStatus.INDETERMINATE) {
          return {
            proceed: false,
            result: { error: "REFUND_OUTCOME_UNKNOWN", indeterminate: true, idempotencyKey },
          };
        }
      }

      const refundRequest = await tx.refundRequest.upsert({
        where: { idempotencyKey },
        create: {
          paymentId: payment.id,
          userId: payment.userId,
          amount: opts.amount,
          reason: opts.reason,
          status: RefundRequestStatus.REFUNDING,
          requestedBy: opts.actorUserId,
          idempotencyKey,
          audits: {
            create: { action: "REFUNDING", actorId: opts.actorUserId, details: opts.source },
          },
        },
        update: {
          status: RefundRequestStatus.REFUNDING,
          audits: {
            create: { action: "REFUNDING", actorId: opts.actorUserId, details: "retry" },
          },
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDING },
      });

      return { proceed: true, payment, refundRequestId: refundRequest.id };
    });

    if (!lockResult.proceed) return lockResult.result;

    const { payment, refundRequestId } = lockResult;

    const outcome = await razorpayService.executeGatewayRefund({
      paymentId: payment.razorpayPaymentId!,
      amountInr: opts.amount,
      // The operation identity, not the payment: two separately authorised refunds of the same
      // amount are two operations and must reach the gateway as two distinct idempotency keys.
      operationKey: idempotencyKey,
    });

    if (outcome.kind === "REJECTED") {
      await this.markRefundFailed(refundRequestId, payment.id, opts.actorUserId, new Error(outcome.detail));
      recordFinancialMetric("refund_failure_total", 1);
      return { error: "GATEWAY_REFUND_FAILED" };
    }

    if (outcome.kind === "INDETERMINATE" || outcome.kind === "ALREADY_SUBMITTED") {
      /**
       * The refund may exist at Razorpay. Everything from here is shaped to stop a second one.
       *
       * The payment is deliberately left in REFUNDING rather than reverted to SUCCESS. That is
       * not an oversight — it makes the existing race guard do the work: any further refund of
       * this payment, from any caller, is refused with REFUND_IN_PROGRESS until reconciliation
       * settles what actually happened. Uncertainty should block, and blocking through a control
       * that already exists is better than inventing a second one.
       */
      await this.markRefundIndeterminate(refundRequestId, opts.actorUserId, outcome);
      recordFinancialMetric("refund_indeterminate_total", 1);
      return {
        error: "REFUND_OUTCOME_UNKNOWN",
        indeterminate: true,
        idempotencyKey,
      };
    }

    const gatewayRefund = { refundId: outcome.refundId, status: outcome.status };

    const newRefundedTotal = (payment.refundedAmount ?? 0) + opts.amount;
    const fullyRefunded = newRefundedTotal >= (payment.amountPaid || payment.amount);

    try {
      await financialTransactionManager.executeWithLedger({
        journal: financialLedgerService.journalForRefund(payment.id, opts.amount, gatewayRefund.refundId),
        mutate: async (tx) => {
          await tx.refundRequest.update({
            where: { id: refundRequestId },
            data: {
              status: RefundRequestStatus.COMPLETED,
              gatewayRefundId: gatewayRefund.refundId,
              razorpayRefundId: gatewayRefund.refundId,
              processedAt: new Date(),
              audits: {
                create: {
                  action: "COMPLETED",
                  actorId: opts.actorUserId,
                  details: gatewayRefund.refundId,
                },
              },
            },
          });

          return tx.payment.update({
            where: { id: payment.id },
            data: {
              status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.SUCCESS,
              refundedAmount: newRefundedTotal,
              refundReason: opts.reason,
              razorpayRefundId: gatewayRefund.refundId,
              refundStatus: gatewayRefund.status,
            },
          });
        },
      });
    } catch (err) {
      await this.markRefundFailed(refundRequestId, payment.id, opts.actorUserId, err);
      return { error: "LEDGER_UPDATE_FAILED" };
    }

    const auditAction = opts.source === "cancellation" ? "BOOKING_CANCEL_REFUND" : "PAYMENT_REFUND";
    void AuditLogService.success(auditAction, {
      userId: opts.actorUserId,
      bookingId: opts.bookingId ?? payment.bookingId,
      reason: opts.reason,
      details: {
        paymentId: payment.id,
        amount: opts.amount,
        refundId: gatewayRefund.refundId,
        idempotencyKey,
      },
    });

    if (payment.bookingId) void cashbackService.reverseOnRefund(payment.bookingId).catch(() => {});
    recordFinancialMetric("refund_success_total", 1);
    recordFinancialMetric("refund_total", 1);
    recordFinancialMetric("refund_amount_total", opts.amount);
    void financialRiskService.detectRefundAbuse(payment.userId, payment.id).catch(() => undefined);

    return {
      refundId: gatewayRefund.refundId,
      status: gatewayRefund.status,
      amount: opts.amount,
      idempotencyKey,
    };
  }

  /**
   * Records an unknown outcome without asserting one.
   *
   * Deliberately unlike {@link markRefundFailed}: the payment is NOT returned to SUCCESS. It stays
   * REFUNDING so the existing guard blocks any further refund of it until a human or the
   * reconciler establishes what the gateway actually did. The audit keeps the original reason, so
   * a later RECONCILED_* entry sits next to it rather than overwriting it.
   */
  private async markRefundIndeterminate(
    refundRequestId: string,
    actorUserId: string,
    outcome: { kind: string; reason?: string; detail?: string },
  ): Promise<void> {
    await prisma.refundRequest.update({
      where: { id: refundRequestId },
      data: {
        status: RefundRequestStatus.INDETERMINATE,
        audits: {
          create: {
            action: "OUTCOME_UNKNOWN",
            actorId: actorUserId,
            details: `${outcome.kind}${outcome.reason ? `:${outcome.reason}` : ""} — reconciliation required`,
          },
        },
      },
    });
  }

  private async markRefundFailed(
    refundRequestId: string,
    paymentId: string,
    actorUserId: string,
    err: unknown,
  ): Promise<void> {
    const detail = err instanceof Error ? err.message : "unknown";
    await prisma.$transaction([
      prisma.refundRequest.update({
        where: { id: refundRequestId },
        data: {
          status: RefundRequestStatus.FAILED,
          audits: { create: { action: "FAILED", actorId: actorUserId, details: detail } },
        },
      }),
      prisma.payment.updateMany({
        where: { id: paymentId, status: PaymentStatus.REFUNDING },
        data: { status: PaymentStatus.SUCCESS },
      }),
    ]);
  }

  cancellationIdempotencyKey(bookingId: string): string {
    return `cancel-refund:${bookingId}`;
  }
}

export const refundOrchestratorService = new RefundOrchestratorService();
