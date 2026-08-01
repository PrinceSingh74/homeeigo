import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { providerService } from "./provider.service";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function periodKey(period: string, d = new Date()) {
  if (period === "DAILY") return d.toISOString().slice(0, 10);
  if (period === "WEEKLY") {
    const w = startOfDay(d);
    w.setDate(w.getDate() - w.getDay());
    return w.toISOString().slice(0, 10);
  }
  if (period === "MONTHLY") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.toISOString().slice(0, 10);
}

function compositeScore(p: {
  rating: number;
  completionRate: number;
  acceptanceRate: number;
  completedBookings: number;
}) {
  return round2(
    p.rating * 20 * 0.35 +
      p.completionRate * 0.3 +
      p.acceptanceRate * 0.2 +
      Math.min(100, p.completedBookings / 2) * 0.15,
  );
}

export class PartnerOsService {
  async ensureDefaultIncentiveRules() {
    const count = await prisma.partnerIncentiveRule.count();
    if (count > 0) return;
    await prisma.partnerIncentiveRule.createMany({
      data: [
        { code: "DAILY_3_JOBS", name: "Daily Bonus", period: "DAILY", metric: "completed_jobs", threshold: 3, bonusAmount: 150 },
        { code: "WEEKLY_18_JOBS", name: "Weekly Bonus", period: "WEEKLY", metric: "completed_jobs", threshold: 18, bonusAmount: 800 },
        { code: "MONTHLY_75_JOBS", name: "Monthly Bonus", period: "MONTHLY", metric: "completed_jobs", threshold: 75, bonusAmount: 3500 },
        { code: "STREAK_7_DAYS", name: "Streak Reward", period: "STREAK", metric: "active_days", threshold: 7, bonusAmount: 500 },
      ],
    });
  }

  async checkIn(providerId: string, source = "manual") {
    const open = await prisma.partnerAttendanceSession.findFirst({
      where: { providerId, checkOutAt: null },
      orderBy: { checkInAt: "desc" },
    });
    if (open) return { session: open, alreadyCheckedIn: true };

    const session = await prisma.partnerAttendanceSession.create({
      data: { providerId, checkInAt: new Date(), source },
    });
    await providerService.setOnline(providerId, true);
    return { session, alreadyCheckedIn: false };
  }

  async checkOut(providerId: string) {
    const open = await prisma.partnerAttendanceSession.findFirst({
      where: { providerId, checkOutAt: null },
      orderBy: { checkInAt: "desc" },
    });
    if (!open) return { session: null, error: "NO_OPEN_SESSION" as const };
    const session = await prisma.partnerAttendanceSession.update({
      where: { id: open.id },
      data: { checkOutAt: new Date() },
    });
    return { session, error: null };
  }

  async getAttendance(providerId: string) {
    const now = new Date();
    const weekStart = startOfDay(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [sessions, openSession, weeklySessions, monthlySessions, provider] = await Promise.all([
      prisma.partnerAttendanceSession.findMany({
        where: { providerId },
        orderBy: { checkInAt: "desc" },
        take: 30,
      }),
      prisma.partnerAttendanceSession.findFirst({
        where: { providerId, checkOutAt: null },
        orderBy: { checkInAt: "desc" },
      }),
      prisma.partnerAttendanceSession.count({
        where: { providerId, checkInAt: { gte: weekStart } },
      }),
      prisma.partnerAttendanceSession.count({
        where: { providerId, checkInAt: { gte: monthStart } },
      }),
      prisma.provider.findUnique({
        where: { id: providerId },
        select: { workingHoursStart: true, workingHoursEnd: true, onlineSince: true, isOnline: true },
      }),
    ]);

    const workingHoursMs = sessions
      .filter((s) => s.checkOutAt)
      .reduce((sum, s) => sum + (s.checkOutAt!.getTime() - s.checkInAt.getTime()), 0);

    return {
      checkIn: openSession?.checkInAt ?? null,
      checkOut: openSession ? null : sessions.find((s) => s.checkOutAt)?.checkOutAt ?? null,
      isCheckedIn: Boolean(openSession),
      workingHoursToday: round2(workingHoursMs / (1000 * 60 * 60)),
      weeklyAttendance: weeklySessions,
      monthlyAttendance: monthlySessions,
      workingHoursStart: provider?.workingHoursStart,
      workingHoursEnd: provider?.workingHoursEnd,
      sessions: sessions.map((s) => ({
        id: s.id,
        checkInAt: s.checkInAt,
        checkOutAt: s.checkOutAt,
        source: s.source,
        durationHours: s.checkOutAt
          ? round2((s.checkOutAt.getTime() - s.checkInAt.getTime()) / (1000 * 60 * 60))
          : null,
      })),
    };
  }

  async getIncentives(providerId: string) {
    await this.ensureDefaultIncentiveRules();
    const rules = await prisma.partnerIncentiveRule.findMany({
      where: { isActive: true },
      orderBy: { bonusAmount: "asc" },
    });

    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfDay(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const streakStart = new Date(now.getTime() - 7 * DAY_MS);

    const [completedToday, completedWeek, completedMonth, activeDays, payouts] = await Promise.all([
      prisma.booking.count({
        where: { providerId, status: BookingStatus.COMPLETED, completedAt: { gte: todayStart } },
      }),
      prisma.booking.count({
        where: { providerId, status: BookingStatus.COMPLETED, completedAt: { gte: weekStart } },
      }),
      prisma.booking.count({
        where: { providerId, status: BookingStatus.COMPLETED, completedAt: { gte: monthStart } },
      }),
      prisma.partnerAttendanceSession.findMany({
        where: { providerId, checkInAt: { gte: streakStart } },
        select: { checkInAt: true },
      }),
      prisma.partnerIncentivePayout.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { rule: { select: { name: true, code: true } } },
      }),
    ]);

    const uniqueActiveDays = new Set(activeDays.map((s) => s.checkInAt.toISOString().slice(0, 10))).size;

    const progressFor = (metric: string) => {
      if (metric === "completed_jobs") {
        return { daily: completedToday, weekly: completedWeek, monthly: completedMonth };
      }
      if (metric === "active_days") return { streak: uniqueActiveDays };
      return {};
    };

    const enriched = rules.map((rule) => {
      const prog = progressFor(rule.metric);
      let current = 0;
      if (rule.period === "DAILY") current = prog.daily ?? 0;
      else if (rule.period === "WEEKLY") current = prog.weekly ?? 0;
      else if (rule.period === "MONTHLY") current = prog.monthly ?? 0;
      else if (rule.period === "STREAK") current = prog.streak ?? 0;

      return {
        id: rule.id,
        code: rule.code,
        name: rule.name,
        period: rule.period,
        metric: rule.metric,
        threshold: rule.threshold,
        bonusAmount: rule.bonusAmount,
        current,
        eligible: current >= rule.threshold,
        progressPct: Math.min(100, Math.round((current / rule.threshold) * 100)),
      };
    });

    return { rules: enriched, payouts, streakDays: uniqueActiveDays };
  }

  async getForecast(providerId: string) {
    const [dashboard, earnings, demand] = await Promise.all([
      providerService.myDashboard(providerId),
      providerService.myEarningsSummary(providerId, 30),
      geoIntelligenceService.demandForecast(24),
    ]);

    const avgPerJob = earnings.averagePerJob || 0;
    const todayEarnings = dashboard?.earnings.today ?? 0;
    const weekEarnings = dashboard?.earnings.thisWeek ?? 0;
    const monthEarnings = dashboard?.earnings.thisMonth ?? 0;

    const demandJobs = Math.max(0, Math.round(((demand.data as { totalPredicted?: number })?.totalPredicted ?? 0) / 10));
    const todayProjection = Math.round(Math.max(todayEarnings, demandJobs * avgPerJob));
    const weeklyProjection = Math.round(weekEarnings > 0 ? weekEarnings * 1.05 : todayProjection * 7);
    const monthlyProjection = Math.round(monthEarnings > 0 ? monthEarnings * 1.08 : todayProjection * 30);

    return {
      todayProjection,
      weeklyProjection,
      monthlyProjection,
      inputs: {
        todayEarnings,
        weekEarnings,
        monthEarnings,
        avgPerJob,
        demandPredicted: (demand.data as { totalPredicted?: number })?.totalPredicted ?? 0,
        confidence: demand.confidence,
      },
    };
  }

  async getProviderIntelligence(providerId: string, days = 90) {
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await prisma.$queryRaw<Array<{ total: number; repeaters: number }>>`
      SELECT COUNT(DISTINCT user_id)::int AS total,
             COUNT(DISTINCT user_id) FILTER (
               WHERE user_id IN (
                 SELECT user_id FROM bookings
                 WHERE provider_id = ${providerId} AND status = 'COMPLETED' AND user_id IS NOT NULL
                 GROUP BY user_id HAVING COUNT(*) > 1
               )
             )::int AS repeaters
      FROM bookings
      WHERE provider_id = ${providerId} AND status = 'COMPLETED' AND created_at >= ${since} AND user_id IS NOT NULL`;

    const total = rows[0]?.total ?? 0;
    const repeaters = rows[0]?.repeaters ?? 0;
    return {
      periodDays: days,
      uniqueCustomers: total,
      returningCustomers: repeaters,
      repeatCustomerRatePct: total > 0 ? round2((repeaters / total) * 100) : 0,
    };
  }

  async getRankings(providerId: string) {
    const me = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: { select: { preferredCity: true } } },
    });
    if (!me) return null;

    const city = me.user.preferredCity ?? me.city ?? "Unknown";
    const peers = await prisma.provider.findMany({
      where: {
        isApproved: true,
        isActive: true,
        user: { preferredCity: city },
      },
      select: {
        id: true,
        rating: true,
        completionRate: true,
        acceptanceRate: true,
        completedBookings: true,
        serviceCategories: true,
      },
    });

    const scored = peers
      .map((p) => ({ ...p, score: compositeScore(p) }))
      .sort((a, b) => b.score - a.score);

    const cityRank = scored.findIndex((p) => p.id === providerId) + 1;
    const cityTotal = scored.length;

    const myCategories = me.serviceCategories ?? [];
    const categoryRanks = myCategories.map((cat) => {
      const inCat = scored.filter((p) => p.serviceCategories.includes(cat));
      const rank = inCat.findIndex((p) => p.id === providerId) + 1;
      return { category: cat, rank: rank || inCat.length, total: inCat.length, score: compositeScore(me) };
    });

    const loc = await prisma.location.findUnique({ where: { providerId } });
    let areaRank = cityRank;
    let areaTotal = cityTotal;
    let areaName = city;
    if (loc) {
      try {
        const density = await geoIntelligenceService.providerDensity();
        const zones = (density.data as Array<{ zoneId: string; name: string; centerLat: number; centerLng: number }>) ?? [];
        const nearest = [...zones].sort((a, b) => {
          const da = Math.hypot(a.centerLat - loc.latitude, a.centerLng - loc.longitude);
          const db = Math.hypot(b.centerLat - loc.latitude, b.centerLng - loc.longitude);
          return da - db;
        })[0];
        if (nearest) {
          areaName = nearest.name;
          const zoneProviders = peers.filter(() => true);
          areaTotal = zoneProviders.length;
          areaRank = cityRank;
        }
      } catch {
        /* optional */
      }
    }

    return {
      cityRank,
      cityTotal,
      areaRank,
      areaTotal,
      areaName,
      categoryRanks,
      compositeScore: compositeScore(me),
      city,
    };
  }

  async getAcademy(providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { serviceCategories: true, certifications: true },
    });
    const modules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: "asc" },
    });
    const progress = await prisma.partnerAcademyProgress.findMany({ where: { providerId } });
    const progressByModule = new Map(progress.map((p) => [p.moduleId, p]));

    const filtered = modules.filter(
      (m) =>
        m.categoryIds.length === 0 ||
        m.categoryIds.some((c) => provider?.serviceCategories.includes(c)),
    );

    return {
      modules: filtered.map((m) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        contentType: m.contentType,
        contentUrl: m.contentUrl,
        body: m.body,
        completedAt: progressByModule.get(m.id)?.completedAt ?? null,
        score: progressByModule.get(m.id)?.score ?? null,
      })),
      certifications: provider?.certifications ?? [],
      completedCount: progress.filter((p) => p.completedAt).length,
    };
  }

  async completeAcademyModule(providerId: string, moduleId: string, score?: number) {
    const module = await prisma.partnerAcademyModule.findFirst({
      where: { id: moduleId, isPublished: true },
    });
    if (!module) return { error: "NOT_FOUND" as const };

    const row = await prisma.partnerAcademyProgress.upsert({
      where: { providerId_moduleId: { providerId, moduleId } },
      create: { providerId, moduleId, completedAt: new Date(), score: score ?? null },
      update: { completedAt: new Date(), score: score ?? undefined },
    });
    return { progress: row };
  }

  async getCompliance(providerId: string) {
    const [provider, documents, bgCheck] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: {
          isVerified: true,
          backgroundCheckStatus: true,
          certifications: true,
          user: { select: { kycStatus: true } },
        },
      }),
      prisma.providerDocument.findMany({
        where: { providerId },
        orderBy: { uploadedAt: "desc" },
      }),
      prisma.partnerBackgroundCheck.findUnique({ where: { providerId } }),
    ]);

    const expiringSoon = documents.filter(
      (d) => d.expiryDate && d.expiryDate.getTime() - Date.now() < 30 * DAY_MS,
    );

    const verifiedDocs = documents.filter((d) => d.isVerified).length;
    const complianceScore =
      documents.length === 0
        ? provider?.isVerified
          ? 50
          : 0
        : Math.round((verifiedDocs / documents.length) * 100);

    return {
      documents: documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        documentName: d.documentName,
        isVerified: d.isVerified,
        expiryDate: d.expiryDate,
        uploadedAt: d.uploadedAt,
        expiringSoon: Boolean(d.expiryDate && d.expiryDate.getTime() - Date.now() < 30 * DAY_MS),
      })),
      verification: {
        isVerified: provider?.isVerified ?? false,
        kycStatus: provider?.user.kycStatus ?? "NOT_STARTED",
        backgroundCheckStatus: provider?.backgroundCheckStatus ?? "NOT_DONE",
        backgroundCheck: bgCheck?.status ?? null,
      },
      complianceScore,
      expiringSoon: expiringSoon.length,
      certifications: provider?.certifications ?? [],
    };
  }

  async getWellbeing() {
    let config = await prisma.platformWellbeingConfig.findUnique({ where: { id: "default" } });
    if (!config) {
      config = await prisma.platformWellbeingConfig.create({
        data: { id: "default", sosPhone: "112" },
      });
    }
    return config;
  }

  async getRewards(providerId: string) {
    const [provider, referrals, incentivePayouts] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: { badges: true, completedBookings: true, totalEarnings: true, rating: true },
      }),
      prisma.user.findFirst({
        where: { provider: { id: providerId } },
        select: { referralCount: true, referralCode: true },
      }),
      prisma.partnerIncentivePayout.aggregate({
        where: { providerId },
        _sum: { amount: true },
      }),
    ]);

    const milestones = [
      { label: "50 jobs", target: 50, current: provider?.completedBookings ?? 0 },
      { label: "100 jobs", target: 100, current: provider?.completedBookings ?? 0 },
      { label: "₹1L earnings", target: 100_000, current: Math.round(provider?.totalEarnings ?? 0) },
      { label: "4.8+ rating", target: 4.8, current: provider?.rating ?? 0 },
    ].map((m) => ({
      ...m,
      achieved: m.current >= m.target,
      progressPct: Math.min(100, Math.round((m.current / m.target) * 100)),
    }));

    return {
      badges: provider?.badges ?? [],
      milestones,
      referralCount: referrals?.referralCount ?? 0,
      referralCode: referrals?.referralCode ?? null,
      incentiveEarnings: incentivePayouts._sum.amount ?? 0,
    };
  }

  async getServiceHistory(providerId: string) {
    const bookings = await prisma.booking.findMany({
      where: { providerId },
      select: { status: true, startedAt: true, scheduledDate: true },
      take: 500,
      orderBy: { scheduledDate: "desc" },
    });

    return {
      completed: bookings.filter((b) => b.status === BookingStatus.COMPLETED).length,
      cancelled: bookings.filter((b) => String(b.status).includes("CANCELLED")).length,
      rescheduled: bookings.filter((b) => b.status === BookingStatus.ASSIGNED && !b.startedAt).length,
      upcoming: bookings.filter((b) =>
        ["PENDING", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "ASSIGNED"].includes(b.status),
      ).length,
    };
  }

  async getWorkforceAnalytics() {
    const now = new Date();
    const todayStart = startOfDay(now);
    const [online, activeJobs, attendanceToday, providers, acceptanceAvg] = await Promise.all([
      prisma.provider.count({ where: { isOnline: true, isApproved: true } }),
      prisma.booking.count({
        where: { status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
      }),
      prisma.partnerAttendanceSession.count({ where: { checkInAt: { gte: todayStart } } }),
      prisma.provider.count({ where: { isApproved: true, isActive: true } }),
      prisma.provider.aggregate({
        where: { isApproved: true },
        _avg: { acceptanceRate: true, completionRate: true },
      }),
    ]);

    return {
      onlineProviders: online,
      totalProviders: providers,
      activeJobs,
      attendanceCheckInsToday: attendanceToday,
      avgAcceptanceRate: round2(acceptanceAvg._avg.acceptanceRate ?? 0),
      avgCompletionRate: round2(acceptanceAvg._avg.completionRate ?? 0),
      generatedAt: now.toISOString(),
    };
  }
}

export const partnerOsService = new PartnerOsService();
