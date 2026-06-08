import { SubscriptionStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { cacheService } from "./cache.service";

export type AnalyticsPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

const INTERVAL_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/**
 * Enterprise membership analytics — MRR, ARR, churn, retention, cohorts, LTV, funnels.
 */
export class MembershipAnalyticsService {
  async dashboard(period: AnalyticsPeriod = "monthly") {
    const cacheKey = `membership:analytics:dashboard:${period}`;
    return cacheService.getOrFetch(cacheKey, 60, () => this.computeDashboard(period));
  }

  private async computeDashboard(period: AnalyticsPeriod) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const activeSubs = await prisma.userSubscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: now } },
      include: { plan: true },
    });

    const mrr = activeSubs.reduce((sum, s) => {
      const months = INTERVAL_MONTHS[s.plan.interval] ?? 1;
      return sum + s.plan.price / months;
    }, 0);

    const arr = Math.round(mrr * 12);

    const [newThisMonth, churnedThisMonth, activeLastMonth, invoices, planDist, benefitUsage] =
      await Promise.all([
        prisma.userSubscription.count({
          where: { status: SubscriptionStatus.ACTIVE, startsAt: { gte: monthStart } },
        }),
        prisma.userSubscription.count({
          where: {
            status: { in: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED] },
            cancelledAt: { gte: monthStart },
          },
        }),
        prisma.userSubscription.count({
          where: {
            status: SubscriptionStatus.ACTIVE,
            startsAt: { lte: lastMonthEnd },
            OR: [{ expiresAt: { gt: lastMonthEnd } }, { expiresAt: null }],
          },
        }),
        prisma.subscriptionInvoice.aggregate({
          where: { createdAt: { gte: monthStart }, status: "paid" },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.userSubscription.groupBy({
          by: ["planId"],
          where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: now } },
          _count: true,
        }),
        prisma.membershipBenefitUsage.groupBy({
          by: ["benefitType"],
          _sum: { count: true, amount: true },
        }),
      ]);

    const churnRate =
      activeLastMonth > 0 ? Math.round((churnedThisMonth / activeLastMonth) * 1000) / 10 : 0;
    const retentionRate = Math.round((100 - churnRate) * 10) / 10;

    const planIds = planDist.map((p) => p.planId);
    const plans = await prisma.membershipPlan.findMany({ where: { id: { in: planIds } } });
    const planMap = new Map(plans.map((p) => [p.id, p]));

    const avgLtv =
      activeSubs.length > 0
        ? Math.round(
            activeSubs.reduce((sum, s) => {
              const months = INTERVAL_MONTHS[s.plan.interval] ?? 1;
              return sum + (s.plan.price / months) * 6;
            }, 0) / activeSubs.length,
          )
        : 0;

    const cohorts = await this.buildCohorts(6);
    const upgradeFunnel = await this.upgradeFunnel();
    const forecast = this.forecastMrr(mrr, newThisMonth, churnedThisMonth);
    const trends = await this.trends(period);

    return {
      period,
      mrr: Math.round(mrr),
      arr,
      activeSubscribers: activeSubs.length,
      newThisMonth,
      churnedThisMonth,
      churnRatePct: churnRate,
      retentionRatePct: retentionRate,
      revenueThisMonth: invoices._sum.amount ?? 0,
      invoicesThisMonth: invoices._count,
      planDistribution: planDist.map((p) => ({
        planId: p.planId,
        planName: planMap.get(p.planId)?.name ?? "Unknown",
        tier: planMap.get(p.planId)?.tier,
        count: p._count,
        sharePct:
          activeSubs.length > 0 ? Math.round((p._count / activeSubs.length) * 1000) / 10 : 0,
      })),
      benefitUsage: benefitUsage.map((b) => ({
        benefitType: b.benefitType,
        totalUses: b._sum.count ?? 0,
        totalValue: b._sum.amount ?? 0,
      })),
      avgLtv,
      cohorts,
      upgradeFunnel,
      downgradeFunnel: {
        cancelledThisMonth: churnedThisMonth,
        expiredThisMonth: await prisma.userSubscription.count({
          where: { status: SubscriptionStatus.EXPIRED, updatedAt: { gte: monthStart } },
        }),
      },
      revenueForecast: forecast,
      trends,
    };
  }

  /** Time-series metrics for charts — MRR, churn, retention, revenue growth. */
  async trends(period: AnalyticsPeriod) {
    const cacheKey = `membership:analytics:trends:${period}`;
    return cacheService.getOrFetch(cacheKey, 120, () => this.computeTrends(period));
  }

  private async computeTrends(period: AnalyticsPeriod) {
    const buckets = this.periodBuckets(period, 12);
    const points = await Promise.all(
      buckets.map(async (b) => {
        const activeSubs = await prisma.userSubscription.findMany({
          where: {
            status: SubscriptionStatus.ACTIVE,
            startsAt: { lte: b.end },
            OR: [{ expiresAt: { gt: b.end } }, { expiresAt: null }],
          },
          include: { plan: true },
        });
        const mrr = activeSubs.reduce((sum, s) => {
          const months = INTERVAL_MONTHS[s.plan.interval] ?? 1;
          return sum + s.plan.price / months;
        }, 0);
        const churned = await prisma.userSubscription.count({
          where: {
            status: { in: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED] },
            cancelledAt: { gte: b.start, lte: b.end },
          },
        });
        const joined = await prisma.userSubscription.count({
          where: { startsAt: { gte: b.start, lte: b.end } },
        });
        const revenue = await prisma.subscriptionInvoice.aggregate({
          where: { createdAt: { gte: b.start, lte: b.end }, status: "paid" },
          _sum: { amount: true },
        });
        const prevActive = Math.max(1, activeSubs.length + churned - joined);
        const churnRate = Math.round((churned / prevActive) * 1000) / 10;
        const retentionRate = Math.round((100 - churnRate) * 10) / 10;
        const ltv =
          activeSubs.length > 0
            ? Math.round(
                activeSubs.reduce((sum, s) => {
                  const months = INTERVAL_MONTHS[s.plan.interval] ?? 1;
                  return sum + (s.plan.price / months) * 6;
                }, 0) / activeSubs.length,
              )
            : 0;

        return {
          label: b.label,
          mrr: Math.round(mrr),
          arr: Math.round(mrr * 12),
          revenue: revenue._sum.amount ?? 0,
          churnRatePct: churnRate,
          retentionRatePct: retentionRate,
          newSubscribers: joined,
          churned,
          avgLtv: ltv,
        };
      }),
    );

    const revenueGrowth =
      points.length >= 2 && points[points.length - 2]!.revenue > 0
        ? Math.round(
            ((points[points.length - 1]!.revenue - points[points.length - 2]!.revenue) /
              points[points.length - 2]!.revenue) *
              1000,
          ) / 10
        : 0;

    return { period, points, revenueGrowthPct: revenueGrowth };
  }

  private periodBuckets(period: AnalyticsPeriod, count: number) {
    const now = new Date();
    const buckets: { label: string; start: Date; end: Date }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      let start: Date;
      let end: Date;
      let label: string;
      if (period === "daily") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59);
        label = start.toISOString().slice(0, 10);
      } else if (period === "weekly") {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59);
        label = `W${start.toISOString().slice(5, 10)}`;
      } else if (period === "quarterly") {
        const q = Math.floor(now.getMonth() / 3) - i;
        const year = now.getFullYear() + Math.floor(q / 4);
        const quarter = ((q % 4) + 4) % 4;
        start = new Date(year, quarter * 3, 1);
        end = new Date(year, quarter * 3 + 3, 0, 23, 59, 59);
        label = `Q${quarter + 1} ${year}`;
      } else if (period === "yearly") {
        start = new Date(now.getFullYear() - i, 0, 1);
        end = new Date(now.getFullYear() - i, 11, 31, 23, 59, 59);
        label = String(start.getFullYear());
      } else {
        start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      }
      buckets.push({ label, start, end });
    }
    return buckets;
  }

  async exportCsv(period: AnalyticsPeriod = "monthly"): Promise<string> {
    const data = await this.dashboard(period);
    const trends = data.trends as { points: Array<Record<string, unknown>> };
    const header = "label,mrr,arr,revenue,churn_rate,retention_rate,new_subscribers,churned,avg_ltv";
    const rows = (trends?.points ?? []).map(
      (p) =>
        `${p.label},${p.mrr},${p.arr},${p.revenue},${p.churnRatePct},${p.retentionRatePct},${p.newSubscribers},${p.churned},${p.avgLtv}`,
    );
    return [header, ...rows].join("\n");
  }

  private async buildCohorts(months: number) {
    const cohorts = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const joined = await prisma.userSubscription.count({
        where: { startsAt: { gte: start, lte: end } },
      });
      const stillActive = await prisma.userSubscription.count({
        where: {
          startsAt: { gte: start, lte: end },
          status: SubscriptionStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });
      cohorts.push({
        month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
        joined,
        retained: stillActive,
        retentionPct: joined > 0 ? Math.round((stillActive / joined) * 1000) / 10 : 0,
      });
    }
    return cohorts;
  }

  private async upgradeFunnel() {
    const [totalUsers, everSubscribed, activeNow, withBenefitUsage] = await Promise.all([
      prisma.user.count({ where: { role: "CUSTOMER", isBanned: false } }),
      prisma.userSubscription.groupBy({ by: ["userId"] }).then((r) => r.length),
      prisma.userSubscription.count({
        where: { status: SubscriptionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      }),
      prisma.membershipBenefitUsage.groupBy({ by: ["userId"] }).then((r) => r.length),
    ]);

    return {
      totalCustomers: totalUsers,
      everSubscribed,
      activeSubscribers: activeNow,
      usedBenefits: withBenefitUsage,
      conversionToSubscribePct:
        totalUsers > 0 ? Math.round((everSubscribed / totalUsers) * 1000) / 10 : 0,
      activationPct:
        everSubscribed > 0 ? Math.round((activeNow / everSubscribed) * 1000) / 10 : 0,
      benefitEngagementPct:
        activeNow > 0 ? Math.round((withBenefitUsage / activeNow) * 1000) / 10 : 0,
    };
  }

  private forecastMrr(currentMrr: number, newSubs: number, churned: number) {
    const avgNewMrr = newSubs > 0 ? currentMrr / Math.max(1, newSubs) : 199;
    const churnImpact = churned * (currentMrr / Math.max(1, newSubs + churned));
    return {
      nextMonthMrr: Math.round(currentMrr + avgNewMrr * newSubs - churnImpact),
      threeMonthMrr: Math.round(currentMrr * 1.05),
      sixMonthMrr: Math.round(currentMrr * 1.12),
    };
  }
}

export const membershipAnalyticsService = new MembershipAnalyticsService();
