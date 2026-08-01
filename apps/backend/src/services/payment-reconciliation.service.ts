import { ReconciliationStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { recordFinancialMetric } from "../lib/financial-metrics";

const SETTLEMENT_GRACE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type IssueInput = {
  issueType: ReconciliationStatus;
  referenceId?: string;
  referenceType?: string;
  expectedAmount?: number;
  actualAmount?: number;
  details?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function paymentAgeDays(p: { completedAt: Date | null; createdAt: Date }): number {
  const anchor = p.completedAt ?? p.createdAt;
  return (Date.now() - anchor.getTime()) / MS_PER_DAY;
}

function isPaymentMatched(p: {
  status: string;
  amount: number;
  amountPaid: number;
  razorpayPaymentId: string | null;
  settlementId: string | null;
  hasPaymentSettlement: boolean;
}): boolean {
  return (
    p.status === "SUCCESS" &&
    !!p.razorpayPaymentId &&
    Math.abs(p.amountPaid - p.amount) <= 0.01 &&
    (!!p.settlementId || p.hasPaymentSettlement)
  );
}

/**
 * Enterprise payment reconciliation — per-payment trace, deduped issues,
 * correct match-rate denominator (SUCCESS payments only).
 */
export class PaymentReconciliationService {
  async runDailyReconciliation(): Promise<{ reconciliationId: string; matchPct: number; issues: number }> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const payments = await prisma.payment.findMany({
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
        completedAt: true,
        createdAt: true,
        settlements: { select: { id: true }, take: 1 },
      },
    });

    const refunds = await prisma.payment.findMany({
      where: { refundedAmount: { gt: 0 }, updatedAt: { gte: since } },
      select: { id: true, amountPaid: true, refundedAmount: true, refundStatus: true, razorpayRefundId: true },
    });

    const walletTopUps = await prisma.walletTransaction.count({
      where: { type: WalletTxnType.CREDIT, status: "COMPLETED", createdAt: { gte: since } },
    });

    const issues: IssueInput[] = [];
    const successPayments = payments.filter((p) => p.status === "SUCCESS");
    let matched = 0;
    let pendingGrace = 0;

    for (const p of payments) {
      const hasSettlement = !!p.settlementId || p.settlements.length > 0;
      const days = paymentAgeDays(p);

      if (p.status === "SUCCESS" && p.razorpayPaymentId && Math.abs(p.amountPaid - p.amount) <= 0.01 && hasSettlement) {
        matched += 1;
        continue;
      }

      if (p.status === "SUCCESS" && !hasSettlement && days < SETTLEMENT_GRACE_DAYS) {
        pendingGrace += 1;
      }

      if (p.status === "SUCCESS" && Math.abs(p.amountPaid - p.amount) > 0.01) {
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
        continue;
      }

      if (p.status === "SUCCESS" && !hasSettlement) {
        const days = paymentAgeDays(p);
        if (days >= SETTLEMENT_GRACE_DAYS) {
          issues.push({
            issueType: ReconciliationStatus.SETTLEMENT_MISMATCH,
            referenceId: p.id,
            referenceType: "payment",
            expectedAmount: p.amountPaid,
            details: `Unsettled ${Math.floor(days)}d — settlement_id NULL, no PaymentSettlement`,
          });
        } else {
          issues.push({
            issueType: ReconciliationStatus.SETTLEMENT_PENDING,
            referenceId: p.id,
            referenceType: "payment",
            expectedAmount: p.amountPaid,
            details: `Settlement pending (${Math.floor(days)}d < ${SETTLEMENT_GRACE_DAYS}d grace)`,
          });
        }
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

    const deduped = await this.dedupeIssues(issues);
    const totalEligible = Math.max(successPayments.length, 1);
    // Pending-in-grace payments are on-track — do not penalize match rate.
    const matchPct = round2(((matched + pendingGrace) / totalEligible) * 100);

    const mismatchCount = deduped.filter((i) => i.issueType === ReconciliationStatus.MISMATCH).length;
    const missingGateway = deduped.filter((i) => i.issueType === ReconciliationStatus.MISSING_GATEWAY).length;
    const settlementMismatch = deduped.filter((i) => i.issueType === ReconciliationStatus.SETTLEMENT_MISMATCH).length;

    const overallStatus =
      deduped.length === 0
        ? ReconciliationStatus.MATCHED
        : mismatchCount > 0
          ? ReconciliationStatus.MISMATCH
          : missingGateway > 0
            ? ReconciliationStatus.MISSING_GATEWAY
            : settlementMismatch > 0
              ? ReconciliationStatus.SETTLEMENT_MISMATCH
              : ReconciliationStatus.SETTLEMENT_PENDING;

    const run = await prisma.paymentReconciliation.create({
      data: {
        status: overallStatus,
        matchedCount: matched,
        mismatchCount: deduped.length,
        missingLocal: 0,
        missingGateway,
        matchPct,
        metadata: JSON.stringify({
          walletTopUps,
          totalChecked: payments.length,
          successEligible: successPayments.length,
          pendingGrace,
          settlementPending: deduped.filter((i) => i.issueType === ReconciliationStatus.SETTLEMENT_PENDING).length,
        }),
        issues: { create: deduped },
      },
      include: { issues: true },
    });

    if (deduped.length > 0) {
      recordFinancialMetric("reconciliation_mismatch_total", deduped.length);
      recordFinancialMetric(
        "settlement_mismatch_total",
        deduped.filter((i) => i.issueType === ReconciliationStatus.SETTLEMENT_MISMATCH).length,
      );
    }

    return { reconciliationId: run.id, matchPct, issues: run.issues.length };
  }

  /** Skip issues that already have an open row for the same payment + type. */
  private async dedupeIssues(issues: IssueInput[]): Promise<IssueInput[]> {
    if (issues.length === 0) return [];
    const refIds = issues.map((i) => i.referenceId).filter(Boolean) as string[];
    const existing = refIds.length
      ? await prisma.reconciliationIssue.findMany({
          where: {
            referenceId: { in: refIds },
            issueType: {
              in: [
                ReconciliationStatus.MISMATCH,
                ReconciliationStatus.MISSING_GATEWAY,
                ReconciliationStatus.SETTLEMENT_MISMATCH,
                ReconciliationStatus.SETTLEMENT_PENDING,
                ReconciliationStatus.REFUND_MISMATCH,
              ],
            },
          },
          select: { referenceId: true, issueType: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        })
      : [];
    const seen = new Set(existing.map((e) => `${e.referenceId}:${e.issueType}`));
    return issues.filter((i) => {
      if (!i.referenceId) return true;
      const key = `${i.referenceId}:${i.issueType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
    const [
      latest,
      issueCount,
      avgMatch,
      successTotal,
      settledTotal,
      pendingTotal,
      mismatchTotal,
      revenueAgg,
      integrityScore,
    ] = await Promise.all([
      prisma.paymentReconciliation.findFirst({ orderBy: { runDate: "desc" } }),
      prisma.reconciliationIssue.count({
        where: {
          issueType: {
            in: [
              ReconciliationStatus.MISMATCH,
              ReconciliationStatus.MISSING_GATEWAY,
              ReconciliationStatus.SETTLEMENT_MISMATCH,
              ReconciliationStatus.REFUND_MISMATCH,
            ],
          },
        },
      }),
      prisma.paymentReconciliation.aggregate({ _avg: { matchPct: true } }),
      prisma.payment.count({ where: { status: "SUCCESS" } }),
      prisma.payment.count({ where: { status: "SUCCESS", settlementId: { not: null } } }),
      prisma.reconciliationIssue.count({ where: { issueType: ReconciliationStatus.SETTLEMENT_PENDING } }),
      prisma.reconciliationIssue.count({ where: { issueType: ReconciliationStatus.SETTLEMENT_MISMATCH } }),
      prisma.payment.aggregate({ _sum: { amountPaid: true }, where: { status: "SUCCESS" } }),
      prisma.financialIntegrityRun.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);

    const gatewayIssues = await prisma.gatewayReconciliationIssue.count({
      where: {
        issueType: {
          in: [
            ReconciliationStatus.MISMATCH,
            ReconciliationStatus.MISSING_LOCAL,
            ReconciliationStatus.MISSING_GATEWAY,
            ReconciliationStatus.SETTLEMENT_MISMATCH,
          ],
        },
      },
    });

    const pendingGraceRows = await prisma.$queryRawUnsafe<{ n: number }[]>(`
      SELECT count(*)::int n FROM payments
      WHERE status = 'SUCCESS' AND settlement_id IS NULL
        AND EXTRACT(day FROM now() - COALESCE(completed_at, created_at)) < ${SETTLEMENT_GRACE_DAYS}
    `);
    const overdueUnsettledRows = await prisma.$queryRawUnsafe<{ n: number }[]>(`
      SELECT count(*)::int n FROM payments
      WHERE status = 'SUCCESS' AND settlement_id IS NULL
        AND EXTRACT(day FROM now() - COALESCE(completed_at, created_at)) >= ${SETTLEMENT_GRACE_DAYS}
    `);
    const pendingGraceN = pendingGraceRows[0]?.n ?? 0;
    const overdueUnsettled = overdueUnsettledRows[0]?.n ?? 0;
    const settlementEffectivePct =
      successTotal > 0 ? round2(((settledTotal + pendingGraceN) / successTotal) * 100) : 100;

    const matchPct = latest?.matchPct ?? round2(avgMatch._avg.matchPct ?? 100);

    return {
      latestRun: latest,
      totalIssues: issueCount,
      avgMatchPct: round2(avgMatch._avg.matchPct ?? 100),
      mismatchPct: round2(100 - (avgMatch._avg.matchPct ?? 100)),
      matchPct,
      totalRevenue: round2(Number(revenueAgg._sum.amountPaid ?? 0)),
      matchedPayments: settledTotal,
      successPayments: successTotal,
      settlementPending: pendingGraceN,
      settlementMismatch: overdueUnsettled,
      settlementEffectivePct,
      localIssues: issueCount,
      gatewayIssues,
      integrityScore:
        integrityScore?.status === "PASS" && (integrityScore?.issuesCount ?? 0) === 0
          ? 100
          : Math.max(0, 100 - (integrityScore?.issuesCount ?? 0)),
    };
  }

  async commandCenterSnapshot() {
    const metrics = await this.metricsSummary();
    const [runs, localIssues, gatewayIssues] = await Promise.all([
      this.listRuns(50),
      this.listIssues(undefined, 200),
      prisma.gatewayReconciliationIssue.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return { metrics, runs, localIssues, gatewayIssues };
  }
}

export const paymentReconciliationService = new PaymentReconciliationService();
