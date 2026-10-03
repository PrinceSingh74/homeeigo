import { analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import prisma from "../lib/prisma";
import { financeDashboardService } from "./finance-dashboard.service";
import { chargebackWorkflowService } from "./chargeback-workflow.service";

export class FinanceAnalyticsService {
  async getUnitEconomics(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [overview, payments, refunds, chargebackAnalytics, newUsers, bookings] = await Promise.all([
      financeDashboardService.getOverview(days),
      /**
       * GMV and the refund total are scoped through the booking each payment belongs to.
       *
       * `payments` has no `data_origin` column, but leaving it unscoped while the booking and
       * customer counts below ARE scoped would be worse than leaving everything unscoped: GMV would
       * still include fixture payments while the completed-booking count excluded the very bookings
       * those payments were made against, so contribution margin and refund rate would be wrong in
       * a way that no longer shows up as an obviously inflated total.
       */
      prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: since }, ...analyticsWhereVia("payment") },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { refundedAmount: { gt: 0 }, updatedAt: { gte: since }, ...analyticsWhereVia("payment") },
        _sum: { refundedAmount: true },
        _count: true,
      }),
      chargebackWorkflowService.analytics(),
      prisma.user.count({ where: { createdAt: { gte: since }, role: "CUSTOMER", ...analyticsWhere() } }),
      prisma.booking.count({ where: { createdAt: { gte: since }, status: "COMPLETED", ...analyticsWhere() } }),
    ]);

    const gmv = payments._sum.amountPaid ?? 0;
    const netRevenue = Number(overview.netRevenue ?? 0);
    const refundTotal = refunds._sum.refundedAmount ?? 0;
    const marketingSpend = Number(process.env.MARKETING_SPEND_MONTHLY ?? 0) * (days / 30);

    const cac = newUsers > 0 ? round2(marketingSpend / newUsers) : 0;
    const contributionMargin = gmv > 0 ? round2(((netRevenue - refundTotal) / gmv) * 100) : 0;
    const refundRate = payments._count > 0 ? round2((refunds._count / payments._count) * 100) : 0;
    // No payouts in the window means the success rate is undefined, not perfect.
    const payoutsRaised = await prisma.withdrawal.count({ where: { createdAt: { gte: since } } });
    const payoutsCompleted = await prisma.withdrawal.count({
      where: { status: "COMPLETED", completedAt: { gte: since } },
    });
    const payoutSuccessRate = payoutsRaised > 0 ? round2((payoutsCompleted / payoutsRaised) * 100) : null;

    /**
     * Settlement accuracy is a MEASURED value recorded on each completed settlement sync run.
     * It was previously reported here as `100 - (chargebackExposure > 0 ? 2 : 0)` -- a number that
     * never touched a settlement, could only ever be 98 or 100, and moved on an unrelated signal.
     * That is a fabricated accuracy metric on a finance dashboard. It now reads the recorded
     * measurement, and reports null when no sync run has ever completed.
     */
    const accuracyAgg = await prisma.settlementSyncRun.aggregate({
      where: { status: "COMPLETED" },
      _avg: { accuracyPct: true },
    });
    const settlementAccuracy =
      accuracyAgg._avg.accuracyPct == null ? null : round2(Number(accuracyAgg._avg.accuracyPct));

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
      settlementAccuracyPct: settlementAccuracy,
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
