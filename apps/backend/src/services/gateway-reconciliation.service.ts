import { ReconciliationStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { razorpayService } from "./razorpay.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

export class GatewayReconciliationService {
  async runGatewayReconciliation(): Promise<{
    runId: string;
    matchPct: number;
    issues: number;
    gatewayPaymentsFetched: number;
    gatewayRefundsFetched: number;
    gatewaySettlementsFetched: number;
  }> {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [gatewayPayments, gatewayRefunds, gatewaySettlements] = await Promise.all([
      razorpayService.fetchPayments(100, Math.floor(since / 1000)),
      razorpayService.fetchRefunds(100),
      razorpayService.fetchSettlements(50),
    ]);

    const localPayments = await prisma.payment.findMany({
      where: { createdAt: { gte: new Date(since) } },
      select: {
        id: true,
        razorpayPaymentId: true,
        razorpayOrderId: true,
        amountPaid: true,
        amount: true,
        status: true,
        refundedAmount: true,
      },
    });

    const localByRzpId = new Map(
      localPayments.filter((p) => p.razorpayPaymentId).map((p) => [p.razorpayPaymentId!, p]),
    );
    const gatewayById = new Map(gatewayPayments.map((p) => [p.id, p]));

    const issues: Array<{
      issueType: ReconciliationStatus;
      gatewayReference?: string;
      localReference?: string;
      expectedAmount?: number;
      actualAmount?: number;
      details?: string;
    }> = [];

    let matched = 0;

    for (const gp of gatewayPayments) {
      const local = localByRzpId.get(gp.id);
      const amountInr = gp.amount / 100;
      if (!local) {
        issues.push({
          issueType: ReconciliationStatus.MISSING_LOCAL,
          gatewayReference: gp.id,
          expectedAmount: amountInr,
          details: `Gateway payment ${gp.id} (${gp.status}) not found locally`,
        });
        continue;
      }
      const localAmount = local.amountPaid || local.amount;
      if (Math.abs(localAmount - amountInr) > 0.01) {
        issues.push({
          issueType: ReconciliationStatus.MISMATCH,
          gatewayReference: gp.id,
          localReference: local.id,
          expectedAmount: amountInr,
          actualAmount: localAmount,
          details: "Payment amount mismatch",
        });
        continue;
      }
      if (gp.status === "captured" && local.status !== "SUCCESS") {
        issues.push({
          issueType: ReconciliationStatus.MISMATCH,
          gatewayReference: gp.id,
          localReference: local.id,
          details: `Status mismatch gateway=${gp.status} local=${local.status}`,
        });
        continue;
      }
      matched += 1;
    }

    for (const lp of localPayments) {
      if (lp.razorpayPaymentId && !gatewayById.has(lp.razorpayPaymentId) && lp.status === "SUCCESS") {
        issues.push({
          issueType: ReconciliationStatus.MISSING_GATEWAY,
          localReference: lp.id,
          gatewayReference: lp.razorpayPaymentId,
          actualAmount: lp.amountPaid || lp.amount,
          details: "Local success payment missing from gateway fetch window",
        });
      }
    }

    for (const gr of gatewayRefunds) {
      const local = await prisma.payment.findFirst({
        where: { razorpayPaymentId: gr.payment_id },
        select: { id: true, refundedAmount: true, razorpayRefundId: true },
      });
      const amountInr = gr.amount / 100;
      if (!local) {
        issues.push({
          issueType: ReconciliationStatus.MISSING_LOCAL,
          gatewayReference: gr.id,
          expectedAmount: amountInr,
          details: `Gateway refund ${gr.id} — payment ${gr.payment_id} not local`,
        });
        continue;
      }
      if (local.razorpayRefundId !== gr.id && (local.refundedAmount ?? 0) < amountInr - 0.01) {
        issues.push({
          issueType: ReconciliationStatus.REFUND_MISMATCH,
          gatewayReference: gr.id,
          localReference: local.id,
          expectedAmount: amountInr,
          actualAmount: local.refundedAmount ?? 0,
          details: "Refund amount/id mismatch",
        });
      }
    }

    for (const gs of gatewaySettlements) {
      const batch = await prisma.settlementBatch.findFirst({
        where: { settlementId: gs.id },
      });
      if (!batch) {
        issues.push({
          issueType: ReconciliationStatus.SETTLEMENT_MISMATCH,
          gatewayReference: gs.id,
          expectedAmount: gs.amount / 100,
          details: "Gateway settlement not linked to local batch",
        });
      }
    }

    const total = Math.max(gatewayPayments.length, 1);
    const matchPct = round2((matched / total) * 100);

    const run = await prisma.gatewayReconciliationRun.create({
      data: {
        matchedCount: matched,
        mismatchCount: issues.filter((i) => i.issueType === ReconciliationStatus.MISMATCH).length,
        missingLocal: issues.filter((i) => i.issueType === ReconciliationStatus.MISSING_LOCAL).length,
        missingGateway: issues.filter((i) => i.issueType === ReconciliationStatus.MISSING_GATEWAY).length,
        matchPct,
        gatewayPaymentsFetched: gatewayPayments.length,
        gatewayRefundsFetched: gatewayRefunds.length,
        gatewaySettlementsFetched: gatewaySettlements.length,
        report: JSON.stringify({ matched, issueCount: issues.length, at: new Date().toISOString() }),
        issues: {
          create: issues.map((i) => ({
            issueType: i.issueType,
            gatewayReference: i.gatewayReference,
            localReference: i.localReference,
            expectedAmount: i.expectedAmount,
            actualAmount: i.actualAmount,
            details: i.details,
          })),
        },
      },
    });

    if (issues.length > 0) {
      recordFinancialMetric("reconciliation_mismatch_total", issues.length);
    }

    return {
      runId: run.id,
      matchPct,
      issues: issues.length,
      gatewayPaymentsFetched: gatewayPayments.length,
      gatewayRefundsFetched: gatewayRefunds.length,
      gatewaySettlementsFetched: gatewaySettlements.length,
    };
  }

  async listRuns(limit = 30) {
    return prisma.gatewayReconciliationRun.findMany({
      orderBy: { runDate: "desc" },
      take: limit,
      include: { _count: { select: { issues: true } } },
    });
  }

  async listIssues(runId?: string, limit = 100) {
    return prisma.gatewayReconciliationIssue.findMany({
      where: runId ? { runId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const gatewayReconciliationService = new GatewayReconciliationService();
