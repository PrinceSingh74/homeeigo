import { ChargebackStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { financialLedgerService } from "./financial-ledger.service";
import { settlementService } from "./settlement.service";
import { chargebackWorkflowService } from "./chargeback-workflow.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

export class SettlementChargebackService {
  async recordSettlementFromWebhook(payload: {
    settlementId?: string;
    amount?: number;
    fee?: number;
    tax?: number;
    status?: string;
    settledAt?: Date;
    gatewayReference?: string;
    raw?: unknown;
  }) {
    return settlementService.recordFromWebhook(payload);
  }

  async recordChargebackFromWebhook(payload: {
    disputeId?: string;
    paymentId?: string;
    amount?: number;
    reason?: string;
    status?: string;
    raw?: unknown;
  }) {
    if (!payload.disputeId) return { handled: false, reason: "NO_DISPUTE_ID" };

    const payment = payload.paymentId
      ? await prisma.payment.findFirst({ where: { razorpayPaymentId: payload.paymentId } })
      : null;

    const statusMap: Record<string, ChargebackStatus> = {
      open: ChargebackStatus.RECEIVED,
      under_review: ChargebackStatus.UNDER_REVIEW,
      won: ChargebackStatus.WON,
      lost: ChargebackStatus.LOST,
      closed: ChargebackStatus.CLOSED,
    };
    const status = statusMap[payload.status?.toLowerCase() ?? ""] ?? ChargebackStatus.RECEIVED;

    const chargeback = await prisma.$transaction(async (tx) => {
      const row = await tx.chargeback.upsert({
        where: { razorpayDisputeId: payload.disputeId },
        create: {
          razorpayDisputeId: payload.disputeId,
          paymentId: payment?.id,
          razorpayPaymentId: payload.paymentId,
          amount: payload.amount ?? payment?.amountPaid ?? 0,
          status,
          reason: payload.reason,
          metadata: payload.raw ? JSON.stringify(payload.raw) : undefined,
        },
        update: {
          status,
          reason: payload.reason,
          resolvedAt: status === ChargebackStatus.WON || status === ChargebackStatus.LOST ? new Date() : undefined,
          metadata: payload.raw ? JSON.stringify(payload.raw) : undefined,
        },
      });

      if (status === ChargebackStatus.LOST || status === ChargebackStatus.RECEIVED) {
        await financialLedgerService.recordJournalInTransaction(
          tx,
          financialLedgerService.journalForChargeback(row.id, row.amount),
        );
      }
      return row;
    });

    recordFinancialMetric("chargeback_total", 1);
    recordFinancialMetric("chargeback_amount_total", chargeback.amount);
    if (status === ChargebackStatus.RECEIVED || status === ChargebackStatus.UNDER_REVIEW) {
      recordFinancialMetric("chargeback_open_total", 1);
    }

    void chargebackWorkflowService.ensureDeadlineFromWebhook(chargeback.id).catch(() => undefined);

    await prisma.chargebackTimeline.create({
      data: {
        chargebackId: chargeback.id,
        action: `WEBHOOK_${status}`,
        details: payload.reason,
      },
    });

    void AuditLogService.success("CHARGEBACK_WEBHOOK", {
      userId: payment?.userId,
      details: { disputeId: payload.disputeId, status },
    });

    return { handled: true, reason: "CHARGEBACK_RECORDED" };
  }

  async listSettlements(limit = 50) {
    return settlementService.listBatches(limit);
  }

  async listChargebacks(limit = 50) {
    return prisma.chargeback.findMany({ orderBy: { receivedAt: "desc" }, take: limit });
  }

  async settlementOverview() {
    const [batches, paymentsSettled, openChargebacks] = await Promise.all([
      prisma.settlementBatch.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.payment.count({ where: { settledAt: { not: null } } }),
      prisma.chargeback.count({ where: { status: { in: ["RECEIVED", "UNDER_REVIEW"] } } }),
    ]);
    return {
      totalSettledAmount: batches._sum.amount ?? 0,
      settlementBatches: batches._count,
      paymentsMarkedSettled: paymentsSettled,
      openChargebacks,
    };
  }
}

export const settlementChargebackService = new SettlementChargebackService();
