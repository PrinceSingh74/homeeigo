import prisma from "../lib/prisma";
import { SubscriptionStatus, CashbackStatus } from "@prisma/client";
import { membershipAnalyticsService } from "./membership-analytics.service";

export class MembershipInsightsService {
  async adminInsights() {
    const dashboard = await membershipAnalyticsService.dashboard();

    const [topPlans, topBenefits, churnRisk, highValue] = await Promise.all([
      prisma.membershipPlan.findMany({
        where: { isActive: true },
        include: { _count: { select: { subscriptions: true } } },
        orderBy: { subscriptions: { _count: "desc" } },
        take: 5,
      }),
      prisma.membershipBenefitUsage.groupBy({
        by: ["benefitType"],
        _sum: { amount: true, count: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 8,
      }),
      prisma.userSubscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          expiresAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, plan: true },
        take: 20,
      }),
      prisma.membershipCashback.groupBy({
        by: ["userId"],
        where: { status: CashbackStatus.CREDITED },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

    const hvUserIds = highValue.map((h) => h.userId);
    const hvUsers = await prisma.user.findMany({
      where: { id: { in: hvUserIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const userMap = new Map(hvUsers.map((u) => [u.id, u]));

    const upgradeRecommendations = await prisma.user.findMany({
      where: {
        subscriptions: { none: { status: SubscriptionStatus.ACTIVE } },
        totalSpent: { gte: 5000 },
      },
      select: { id: true, email: true, firstName: true, lastName: true, totalSpent: true },
      take: 15,
      orderBy: { totalSpent: "desc" },
    });

    return {
      analytics: dashboard,
      topPlans: topPlans.map((p) => ({
        id: p.id,
        name: p.name,
        tier: p.tier,
        subscribers: p._count.subscriptions,
        price: p.price,
      })),
      topBenefits: topBenefits.map((b) => ({
        benefitType: b.benefitType,
        totalAmount: b._sum.amount ?? 0,
        usageCount: b._sum.count ?? 0,
      })),
      churnRiskUsers: churnRisk.map((s) => ({
        userId: s.userId,
        email: s.user.email,
        name: `${s.user.firstName} ${s.user.lastName}`,
        plan: s.plan.name,
        expiresAt: s.expiresAt,
      })),
      highValueMembers: highValue.map((h) => ({
        userId: h.userId,
        email: userMap.get(h.userId)?.email,
        name: userMap.get(h.userId)
          ? `${userMap.get(h.userId)!.firstName} ${userMap.get(h.userId)!.lastName}`
          : "Unknown",
        totalCashback: h._sum.amount ?? 0,
      })),
      upgradeRecommendations: upgradeRecommendations.map((u) => ({
        userId: u.id,
        email: u.email,
        name: `${u.firstName} ${u.lastName}`,
        totalSpent: u.totalSpent,
      })),
    };
  }
}

export const membershipInsightsService = new MembershipInsightsService();
