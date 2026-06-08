import { CommissionStatus, FraudAlertStatus, FraudRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { parsePagination } from "../lib/pagination";

export class FraudAdminService {
  async overview() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalReferrals,
      qualified,
      fraudBlocked,
      frozenCommissions,
      reviewQueue,
      openAlerts,
      highRiskUsers,
      riskDistribution,
      alertsByCategory,
      commissionAgg,
      rejectedAgg,
      monthAlerts,
    ] = await Promise.all([
      prisma.referralTransaction.count(),
      prisma.referralTransaction.count({ where: { status: "QUALIFIED" } }),
      prisma.referralTransaction.count({ where: { status: "FRAUD_BLOCKED" } }),
      prisma.referralCommission.count({ where: { status: CommissionStatus.FROZEN } }),
      prisma.referralCommission.count({
        where: { status: { in: [CommissionStatus.REVIEW, CommissionStatus.FROZEN] } },
      }),
      prisma.fraudAlert.count({ where: { status: FraudAlertStatus.OPEN } }),
      prisma.fraudRiskScore.count({
        where: { level: { in: [FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL] } },
      }),
      prisma.fraudRiskScore.groupBy({ by: ["level"], _count: true }),
      prisma.fraudAlert.groupBy({ by: ["category"], _count: true, orderBy: { _count: { category: "desc" } } }),
      prisma.referralCommission.aggregate({
        where: { status: CommissionStatus.APPROVED },
        _sum: { amount: true },
      }),
      prisma.referralCommission.aggregate({
        where: { status: CommissionStatus.REJECTED },
        _sum: { amount: true },
      }),
      prisma.fraudAlert.count({ where: { createdAt: { gte: monthStart } } }),
    ]);

    const fraudRate =
      totalReferrals > 0 ? Math.round(((fraudBlocked + frozenCommissions) / totalReferrals) * 1000) / 10 : 0;
    const conversionRate =
      totalReferrals > 0 ? Math.round((qualified / totalReferrals) * 1000) / 10 : 0;
    const lossPrevented = rejectedAgg._sum.amount ?? 0;

    return {
      totalReferrals,
      qualified,
      fraudBlocked,
      frozenCommissions,
      reviewQueue,
      openAlerts,
      highRiskUsers,
      fraudRatePct: fraudRate,
      referralConversionPct: conversionRate,
      commissionApproved: commissionAgg._sum.amount ?? 0,
      commissionLossPrevented: lossPrevented,
      alertsThisMonth: monthAlerts,
      riskDistribution: Object.fromEntries(riskDistribution.map((r) => [r.level.toLowerCase(), r._count])),
      alertsByCategory: alertsByCategory.map((a) => ({ category: a.category, count: a._count })),
    };
  }

  async highRiskUsers(limit = 20) {
    const rows = await prisma.fraudRiskScore.findMany({
      where: { level: { in: [FraudRiskLevel.HIGH, FraudRiskLevel.CRITICAL, FraudRiskLevel.MEDIUM] } },
      orderBy: { score: "desc" },
      take: limit,
      include: { user: { select: { firstName: true, lastName: true, email: true, isBanned: true } } },
    });
    return rows.map((r) => ({
      userId: r.userId,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      email: r.user.email,
      score: r.score,
      level: r.level.toLowerCase(),
      factors: r.factors ? JSON.parse(r.factors) : [],
      isBanned: r.user.isBanned,
      lastEvaluatedAt: r.lastEvaluatedAt,
    }));
  }

  async reviewQueue(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = { status: { in: [CommissionStatus.FROZEN, CommissionStatus.REVIEW, CommissionStatus.PENDING] } };
    const [rows, total] = await Promise.all([
      prisma.referralCommission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          referrer: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.referralCommission.count({ where }),
    ]);
    return {
      commissions: rows.map((c) => ({
        id: c.id,
        referrerId: c.referrerId,
        referrer: `${c.referrer.firstName} ${c.referrer.lastName}`.trim(),
        email: c.referrer.email,
        amount: c.amount,
        status: c.status.toLowerCase(),
        riskScore: c.riskScore,
        frozenAt: c.frozenAt,
        createdAt: c.createdAt,
      })),
      total,
      page,
    };
  }

  async alerts(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: { status?: FraudAlertStatus } = {};
    if (query.status) where.status = query.status.toUpperCase() as FraudAlertStatus;

    const [rows, total] = await Promise.all([
      prisma.fraudAlert.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      prisma.fraudAlert.count({ where }),
    ]);

    return {
      alerts: rows.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user ? `${a.user.firstName} ${a.user.lastName}`.trim() : null,
        email: a.user?.email,
        category: a.category,
        severity: a.severity.toLowerCase(),
        title: a.title,
        description: a.description,
        status: a.status.toLowerCase(),
        createdAt: a.createdAt,
      })),
      total,
      page,
    };
  }

  async monthlyReport() {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const [referrals, alerts, blocked, approved] = await Promise.all([
        prisma.referralTransaction.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.fraudAlert.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.referralCommission.count({
          where: { status: CommissionStatus.REJECTED, createdAt: { gte: start, lte: end } },
        }),
        prisma.referralCommission.count({
          where: { status: CommissionStatus.APPROVED, createdAt: { gte: start, lte: end } },
        }),
      ]);
      months.push({
        month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
        referrals,
        alerts,
        commissionsBlocked: blocked,
        commissionsApproved: approved,
      });
    }
    return { months };
  }

  async decisionLog(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const [rows, total] = await Promise.all([
      prisma.fraudDecisionLog.findMany({ skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.fraudDecisionLog.count(),
    ]);
    return { logs: rows, total, page };
  }
}

export const fraudAdminService = new FraudAdminService();
