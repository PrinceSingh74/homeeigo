import prisma from "../lib/prisma";

/** CFO dashboard aggregates — liabilities, GMV, revenue proxies. */
export class FinanceDashboardService {
  async getOverview(periodDays = 30) {
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const [
      gmvAgg,
      refundAgg,
      walletAgg,
      giftCardAgg,
      cashbackAgg,
      providerPayableAgg,
      settlementPending,
      chargebackExposure,
      subscriptionMrr,
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: since } },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { refundedAmount: { gt: 0 } },
        _sum: { refundedAmount: true },
      }),
      prisma.user.aggregate({ _sum: { walletBalance: true } }),
      prisma.giftCard.aggregate({
        where: { status: "ACTIVE" },
        _sum: { balance: true },
      }),
      prisma.membershipCashback.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true },
      }),
      prisma.provider.aggregate({ _sum: { walletBalance: true } }),
      prisma.payment.aggregate({
        where: { status: "SUCCESS", settlementId: null },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.chargeback.aggregate({
        where: { status: { in: ["RECEIVED", "OPEN", "UNDER_REVIEW", "EVIDENCE_PENDING", "RESPONDED"] } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", createdAt: { gte: since } },
        _sum: { amount: true },
      }),
    ]);

    const gmv = gmvAgg._sum.amountPaid ?? 0;
    const refunds = refundAgg._sum.refundedAmount ?? 0;
    const netRevenue = round2(gmv - refunds);
    const walletLiability = walletAgg._sum.walletBalance ?? 0;
    const giftCardLiability = giftCardAgg._sum.balance ?? 0;
    const cashbackLiability = cashbackAgg._sum.amount ?? 0;
    const providerPayable = providerPayableAgg._sum.walletBalance ?? 0;
    const settlementPendingAmount = settlementPending._sum.amountPaid ?? 0;
    const chargebackOpen = chargebackExposure._sum.amount ?? 0;
    const mrr = subscriptionMrr._sum.amount ?? 0;

    return {
      periodDays,
      gmv,
      revenue: gmv,
      netRevenue,
      mrr,
      arr: round2(mrr * 12),
      refundLiability: refunds,
      walletLiability,
      giftCardLiability,
      cashbackLiability,
      providerPayable,
      settlementPending: { count: settlementPending._count, amount: settlementPendingAmount },
      chargebackExposure: { count: chargebackExposure._count, amount: chargebackOpen },
      totalLiabilities: round2(walletLiability + giftCardLiability + cashbackLiability + providerPayable + refunds),
    };
  }

  async dailyTrend(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const payments = await prisma.payment.findMany({
      where: { status: "SUCCESS", completedAt: { gte: since } },
      select: { amountPaid: true, completedAt: true },
    });

    const byDay = new Map<string, number>();
    for (const p of payments) {
      if (!p.completedAt) continue;
      const key = p.completedAt.toISOString().slice(0, 10);
      byDay.set(key, round2((byDay.get(key) ?? 0) + p.amountPaid));
    }

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financeDashboardService = new FinanceDashboardService();
