import prisma from "../lib/prisma";
import { financeAnalyticsService } from "./finance-analytics.service";
import { financeIntelligenceService } from "./finance-intelligence.service";
import { campaignService } from "./campaign.service";
import { referralService } from "./referral.service";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readMarketingSpend(days: number): number {
  const monthly = Number(process.env.MARKETING_SPEND_MONTHLY ?? 0);
  return monthly * (days / 30);
}

export class GrowthIntelligenceService {
  async getIntelligence(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);

    const [unit, fi, campaigns, referrals, touches, referralGmv] = await Promise.all([
      financeAnalyticsService.getUnitEconomics(days),
      financeIntelligenceService.getFinanceIntelligence(days),
      campaignService.adminAnalytics(),
      referralService.adminAnalytics(),
      prisma.marketingAttributionTouch.groupBy({
        by: ["channel"],
        where: { createdAt: { gte: since } },
        _sum: { revenue: true },
        _count: true,
      }),
      prisma.$queryRaw<Array<{ gmv: number }>>`
        SELECT COALESCE(SUM(b.total_amount), 0)::float AS gmv
        FROM referral_transactions rt
        JOIN bookings b ON b.user_id = rt.referee_id AND b.status = 'COMPLETED' AND b.created_at >= ${since}`,
    ]);

    const cac = unit.cac;
    const ltv = unit.avgLtv;
    const ltvCac = cac > 0 ? round2(ltv / cac) : null;

    const marketingSpend = readMarketingSpend(days);
    const attributedRevenue = fi.revenue.netRevenue;
    const roas = marketingSpend > 0 ? round2(attributedRevenue / marketingSpend) : null;

    const grossMarginPct = fi.grossMargin.grossMarginPct ?? 0;
    const monthlyArpu = fi.revenue.netRevenue > 0 ? round2((fi.revenue.netRevenue / days) * 30 / Math.max(unit.newCustomers, 1)) : 0;
    const paybackMonths =
      cac > 0 && monthlyArpu > 0 && grossMarginPct > 0
        ? round2(cac / (monthlyArpu * (grossMarginPct / 100)))
        : null;

    const campaignRows = await prisma.campaign.findMany({
      select: { id: true, code: true, name: true, cost: true },
    });
    const campData = campaigns as {
      byCampaign?: Array<{ code?: string; name?: string; campaignId: string; revenue: number; redemptions: number }>;
    };
    const campaignRoi = campaignRows
      .map((c) => {
        const campAnalytics = campData.byCampaign?.find((x) => x.code === c.code || x.campaignId === c.id);
        const revenue = Number(campAnalytics?.revenue ?? 0);
        const redemptions = campAnalytics?.redemptions ?? 0;
        const cost = c.cost ?? 0;
        const roi = cost > 0 ? round2(((revenue - cost) / cost) * 100) : null;
        return { code: c.code, name: c.name, revenue, cost, redemptions, roi, costConfigured: cost > 0 };
      })
      .filter((c) => c.redemptions > 0 || c.costConfigured);

    const referralCommission = Number((referrals as { totalCommission?: number }).totalCommission ?? 0);
    const referredGmv = referralGmv[0]?.gmv ?? 0;
    const referralRoi =
      referralCommission > 0 ? round2(((referredGmv - referralCommission) / referralCommission) * 100) : null;

    const attributionChannels = touches.map((t) => ({
      channel: t.channel,
      revenue: round2(t._sum.revenue ?? 0),
      touches: t._count,
    }));

    const organicReferral = {
      channel: "referral",
      touches: Number((referrals as { qualified?: number }).qualified ?? 0),
      revenue: round2(referredGmv),
    };

    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      cac,
      ltv,
      ltvCacRatio: ltvCac,
      roas: {
        value: roas,
        marketingSpend,
        attributedRevenue,
        spendSource: marketingSpend > 0 ? "MARKETING_SPEND_MONTHLY" : "missing",
      },
      paybackMonths: {
        value: paybackMonths,
        monthlyArpu,
        grossMarginPct,
      },
      campaignRoi,
      referralRoi: {
        roiPct: referralRoi,
        referredGmv,
        commissionPaid: referralCommission,
      },
      attribution: {
        channels: [...attributionChannels, ...(organicReferral.touches > 0 ? [organicReferral] : [])],
        touchTablePopulated: touches.length > 0,
        note: touches.length === 0 ? "First/last/multi-touch from marketing_attribution_touches when ingested; referral/coupon channels shown from live transactions." : undefined,
      },
      newCustomers: unit.newCustomers,
    };
  }
}

export const growthIntelligenceService = new GrowthIntelligenceService();
