import { ReconciliationStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { recordFinancialMetric } from "../lib/financial-metrics";

/**
 * Compares local payment records against gateway expectations.
 * Gateway API fetch is optional — local integrity checks always run.
 */
export class PaymentReconciliationService {
  async runDailyReconciliation(): Promise<{ reconciliationId: string; matchPct: number; issues: number }> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [payments, refunds, unsettled, walletTopUps] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          amount: true,
          amountPaid: true,
          status: true,
          razorpayOrderId: true,
          razorpayPaymentId: true,
          refundedAmount: true,
          settlementId: true,
        },
      }),
      prisma.payment.findMany({
        where: { refundedAmount: { gt: 0 }, updatedAt: { gte: since } },
        select: { id: true, amountPaid: true, refundedAmount: true, refundStatus: true, razorpayRefundId: true },
      }),
      prisma.payment.count({ where: { status: "SUCCESS", settlementId: null, completedAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } } }),
      prisma.walletTransaction.count({
        where: { type: WalletTxnType.CREDIT, status: "COMPLETED", createdAt: { gte: since } },
      }),
    ]);

    const issues: Array<{
      issueType: ReconciliationStatus;
      referenceId?: string;
      referenceType?: string;
      expectedAmount?: number;
      actualAmount?: number;
      details?: string;
    }> = [];

    let matched = 0;

    for (const p of payments) {
      if (p.status === "SUCCESS" && p.razorpayPaymentId && p.amountPaid === p.amount) {
        matched += 1;
        continue;
      }
      if (p.status === "SUCCESS" && p.amountPaid !== p.amount) {
        issues.push({
          issueType: ReconciliationStatus.MISMATCH,
          referenceId: p.id,
          referenceType: "payment",
          expectedAmount: p.amount,
          actualAmount: p.amountPaid,
          details: "SUCCESS payment amountPaid != amount",
        });
        continue;
      }
      if (p.status === "SUCCESS" && !p.razorpayPaymentId) {
        issues.push({
          issueType: ReconciliationStatus.MISSING_GATEWAY,
          referenceId: p.id,
          referenceType: "payment",
          details: "SUCCESS without razorpayPaymentId",
        });
      }
    }

    for (const r of refunds) {
      if (r.refundedAmount > r.amountPaid) {
        issues.push({
          issueType: ReconciliationStatus.REFUND_MISMATCH,
          referenceId: r.id,
          referenceType: "payment",
          expectedAmount: r.amountPaid,
          actualAmount: r.refundedAmount,
          details: "refundedAmount exceeds amountPaid",
        });
      }
    }

    if (unsettled > 0) {
      issues.push({
        issueType: ReconciliationStatus.SETTLEMENT_MISMATCH,
        referenceType: "payment",
        details: `${unsettled} SUCCESS payments unsettled >3 days`,
        actualAmount: unsettled,
      });
    }

    const totalChecked = payments.length + refunds.length;
    const mismatchCount = issues.filter((i) => i.issueType === ReconciliationStatus.MISMATCH).length;
    const missingLocal = issues.filter((i) => i.issueType === ReconciliationStatus.MISSING_LOCAL).length;
    const missingGateway = issues.filter((i) => i.issueType === ReconciliationStatus.MISSING_GATEWAY).length;
    const matchPct = totalChecked > 0 ? round2((matched / totalChecked) * 100) : 100;

    const overallStatus =
      issues.length === 0
        ? ReconciliationStatus.MATCHED
        : mismatchCount > 0
          ? ReconciliationStatus.MISMATCH
          : missingGateway > 0
            ? ReconciliationStatus.MISSING_GATEWAY
            : ReconciliationStatus.SETTLEMENT_MISMATCH;

    const run = await prisma.paymentReconciliation.create({
      data: {
        status: overallStatus,
        matchedCount: matched,
        mismatchCount: issues.length,
        missingLocal,
        missingGateway,
        matchPct,
        metadata: JSON.stringify({ walletTopUps, totalChecked }),
        issues: { create: issues },
      },
      include: { issues: true },
    });

    if (issues.length > 0) {
      recordFinancialMetric("reconciliation_mismatch_total", issues.length);
    }

    return { reconciliationId: run.id, matchPct, issues: run.issues.length };
  }

  async listRuns(limit = 30) {
    return prisma.paymentReconciliation.findMany({
      orderBy: { runDate: "desc" },
      take: limit,
      include: { _count: { select: { issues: true } } },
    });
  }

  async listIssues(reconciliationId?: string, limit = 100) {
    return prisma.reconciliationIssue.findMany({
      where: reconciliationId ? { reconciliationId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { reconciliation: { select: { runDate: true, matchPct: true } } },
    });
  }

  async metricsSummary() {
    const [latest, issueCount, avgMatch] = await Promise.all([
      prisma.paymentReconciliation.findFirst({ orderBy: { runDate: "desc" } }),
      prisma.reconciliationIssue.count(),
      prisma.paymentReconciliation.aggregate({ _avg: { matchPct: true } }),
    ]);
    return {
      latestRun: latest,
      totalIssues: issueCount,
      avgMatchPct: round2(avgMatch._avg.matchPct ?? 100),
      mismatchPct: round2(100 - (avgMatch._avg.matchPct ?? 100)),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const paymentReconciliationService = new PaymentReconciliationService();
