import prisma from "../lib/prisma";
import { financeDashboardService } from "./finance-dashboard.service";
import { chargebackWorkflowService } from "./chargeback-workflow.service";

export class FinanceAnalyticsService {
  async getUnitEconomics(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [overview, payments, refunds, payouts, chargebackAnalytics, newUsers, bookings] = await Promise.all([
      financeDashboardService.getOverview(days),
      prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: since } },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { refundedAmount: { gt: 0 }, updatedAt: { gte: since } },
        _sum: { refundedAmount: true },
        _count: true,
      }),
      prisma.withdrawal.aggregate({
        where: { status: "COMPLETED", completedAt: { gte: since } },
        _sum: { netAmount: true },
        _count: true,
      }),
      chargebackWorkflowService.analytics(),
      prisma.user.count({ where: { createdAt: { gte: since }, role: "CUSTOMER" } }),
      prisma.booking.count({ where: { createdAt: { gte: since }, status: "COMPLETED" } }),
    ]);

    const gmv = payments._sum.amountPaid ?? 0;
    const netRevenue = Number(overview.netRevenue ?? 0);
    const refundTotal = refunds._sum.refundedAmount ?? 0;
    const payoutTotal = payouts._sum.netAmount ?? 0;
    const marketingSpend = Number(process.env.MARKETING_SPEND_MONTHLY ?? 0) * (days / 30);

    const cac = newUsers > 0 ? round2(marketingSpend / newUsers) : 0;
    const contributionMargin = gmv > 0 ? round2(((netRevenue - refundTotal) / gmv) * 100) : 0;
    const refundRate = payments._count > 0 ? round2((refunds._count / payments._count) * 100) : 0;
    const payoutSuccessRate =
      payouts._count > 0
        ? round2(
            ((await prisma.withdrawal.count({ where: { status: "COMPLETED", completedAt: { gte: since } } })) /
              (await prisma.withdrawal.count({ where: { createdAt: { gte: since } } }))) *
              100,
          )
        : 100;

    const avgLtv = bookings > 0 && newUsers > 0 ? round2(gmv / newUsers) : 0;

    return {
      periodDays: days,
      gmv,
      netRevenue,
      cac,
      contributionMarginPct: contributionMargin,
      revenueEfficiencyPct: gmv > 0 ? round2((netRevenue / gmv) * 100) : 0,
      refundRatePct: refundRate,
      chargebackRatePct: chargebackAnalytics.chargebackRatio ?? 0,
      payoutSuccessRatePct: payoutSuccessRate,
      settlementAccuracyPct: 100 - (Number(overview.chargebackExposure ?? 0) > 0 ? 2 : 0),
      avgLtv,
      bookingsCompleted: bookings,
      newCustomers: newUsers,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financeAnalyticsService = new FinanceAnalyticsService();
