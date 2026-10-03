import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { providerService } from "./provider.service";
import { filterAcademyModulesForCategories } from "./partner-academy-requirements";
import { partnerIncentivePayoutService } from "./partner-incentive-payout.service";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
    void partnerIncentivePayoutService.evaluateAndCreditIncentives(providerId).catch(() => undefined);
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
    /**
     * One incentive read, not two. This called `computeRuleProgress` and `loadProgressSnapshot`
     * separately, so every partner request built the progress snapshot twice — and from two
     * independent `new Date()` values, meaning the streak shown beside the rules was not guaranteed
     * to be the streak those rules were judged against.
     */
    const [view, payouts] = await Promise.all([
      partnerIncentivePayoutService.computeIncentiveView(providerId),
      prisma.partnerIncentivePayout.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { rule: { select: { name: true, code: true } } },
      }),
    ]);

    return { rules: view.rules, payouts, streakDays: view.progress.streak };
  }

  async getForecast(providerId: string) {
    /**
     * Demand forecast is BigQuery ARIMA. When GCP/BQ is down, `intel()` rethrows.
     * Trailing actuals must still load — a warehouse outage must not erase realised
     * earnings or report INSUFFICIENT_HISTORY for a partner who has jobs on file.
     */
    const [dashboard, earnings, demand] = await Promise.all([
      providerService.myDashboard(providerId),
      providerService.myEarningsSummary(providerId, 30),
      geoIntelligenceService.demandForecast(24).catch(() => ({
        data: null,
        confidence: null as number | null,
        freshness: new Date().toISOString(),
        source: null as string | null,
        cached: false,
        generatedAt: new Date().toISOString(),
      })),
    ]);

    /**
     * NET per job, deliberately.
     *
     * `todayEarnings` below is `_sum.netEarning` — what the partner actually received — while
     * `earnings.averagePerJob` is GROSS. Blending them made `todayProjection` compare a net figure
     * against a gross one (~19% apart on live data), overstating the opportunity. Both sides of the
     * comparison are now net.
     */
    const avgPerJob = earnings.averageNetPerJob || 0;
    const todayEarnings = dashboard?.earnings.today ?? 0;
    const weekEarnings = dashboard?.earnings.thisWeek ?? 0;
    const monthEarnings = dashboard?.earnings.thisMonth ?? 0;

    const demandJobs = Math.max(0, Math.round(((demand.data as { totalPredicted?: number })?.totalPredicted ?? 0) / 10));
    const todayProjection = Math.round(Math.max(todayEarnings, demandJobs * avgPerJob));
    /**
     * Weekly and monthly are TRAILING ACTUALS — deliberately not forecasts.
     *
     * They previously read `weekEarnings * 1.05` and `monthEarnings * 1.08`. Those growth factors
     * had no basis anywhere: no comment, no document, no model, and no separate reasoning commit —
     * they arrived inside one bulk staging-RC commit. They were also applied to the wrong kind of
     * number: `myDashboard` computes `thisWeek` from `daysAgo(6)` and `thisMonth` from
     * `daysAgo(29)`, so both are COMPLETE trailing windows, not week-to-date. Multiplying a
     * finished trailing total by 1.05 asserts 5% growth from nothing — and both figures are shown
     * to partners as "Weekly/Monthly Projection" on mobile and web.
     *
     * Absent any model of partner-level earnings growth, the honest estimate of the next 7 or 30
     * days is what the partner actually earned in the last 7 or 30. That is what is returned, with
     * no growth applied and a `basis` block stating exactly what the number is.
     *
     * The old fallbacks (`todayProjection * 7`, `* 30`) are gone as well: extrapolating a single
     * day across a month is the same fabrication in another form. With no trailing history the
     * answer is INSUFFICIENT_HISTORY, not a number.
     */
    const hasWeekHistory = weekEarnings > 0;
    const hasMonthHistory = monthEarnings > 0;
    const weeklyProjection = Math.round(weekEarnings);
    const monthlyProjection = Math.round(monthEarnings);

    const nowIso = new Date().toISOString();

    return {
      todayProjection,
      weeklyProjection,
      monthlyProjection,
      /**
       * What each figure actually IS. Nothing is presented as a model output unless a model
       * produced it, and no figure carries a growth assumption.
       */
      basis: {
        todayProjection: {
          method: "REALISED_TODAY_OR_DEMAND_PRICED_AT_AVG_PER_JOB",
          predictive: true,
          source: demand.source ?? "bigquery:arima_plus",
          freshness: "FORECAST" as const,
          confidence: demand.confidence ?? null,
          asOf: nowIso,
        },
        weeklyProjection: {
          method: "TRAILING_7D_ACTUALS",
          predictive: false,
          growthAssumptionApplied: false,
          source: "db:earnings",
          freshness: "HISTORICAL" as const,
          state: hasWeekHistory ? ("OK" as const) : ("INSUFFICIENT_HISTORY" as const),
          asOf: nowIso,
        },
        monthlyProjection: {
          method: "TRAILING_30D_ACTUALS",
          predictive: false,
          growthAssumptionApplied: false,
          source: "db:earnings",
          freshness: "HISTORICAL" as const,
          state: hasMonthHistory ? ("OK" as const) : ("INSUFFICIENT_HISTORY" as const),
          asOf: nowIso,
        },
      },
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

  /**
   * The partner's actual performance — ratings, acceptance, completion, cancellation, response.
   *
   * Added because `read.partner.getPartnerPerformance` was bound to `getProviderIntelligence`,
   * which returns REPEAT-CUSTOMER stats. A partner asking the copilot "how is my performance?"
   * would have been answered with retention numbers stated as performance. The tool now has a
   * method that matches its name, and retention is returned alongside under its own key rather
   * than impersonating performance.
   *
   * Every rate here is a stored counter on the provider row, so it is realised history, not a
   * model output. `sampleSize` is returned with it: a completion rate computed over three jobs is
   * not comparable to one over three hundred, and any caller presenting a trend must be able to
   * see that for itself rather than inferring it.
   */
  async getPerformanceSummary(providerId: string, days = 90) {
    const [provider, retention, completedInWindow] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: {
          rating: true, completionRate: true, acceptanceRate: true,
          cancellationRate: true, responseRate: true, avgResponseTime: true,
          avgCompletionTime: true, cancelledBookings: true,
          // Rating count comes from the relation — there is no denormalised counter to trust.
          _count: { select: { reviews: true } },
        },
      }),
      this.getProviderIntelligence(providerId, days),
      prisma.booking.count({
        where: {
          providerId,
          status: "COMPLETED",
          createdAt: { gte: new Date(Date.now() - days * DAY_MS) },
        },
      }),
    ]);
    if (!provider) return null;

    const asOf = new Date().toISOString();
    return {
      periodDays: days,
      performance: {
        rating: provider.rating,
        totalRatings: provider._count.reviews,
        completionRate: provider.completionRate,
        acceptanceRate: provider.acceptanceRate,
        cancellationRate: provider.cancellationRate,
        responseRate: provider.responseRate,
        avgResponseTimeMinutes: provider.avgResponseTime,
        avgCompletionTimeMinutes: provider.avgCompletionTime,
      },
      volume: {
        completedInWindow,
        cancelledLifetime: provider.cancelledBookings,
      },
      /** Retention, clearly separated — this is what the tool used to return on its own. */
      retention,
      basis: {
        source: "db:provider_counters",
        freshness: "HISTORICAL" as const,
        predictive: false,
        /** Jobs completed in the window. Callers must gate trend language on this. */
        sampleSize: completedInWindow,
        asOf,
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

    const filtered = filterAcademyModulesForCategories(modules, provider?.serviceCategories);

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
      completedCount: filtered.filter((m) => progressByModule.get(m.id)?.completedAt).length,
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

    const academy = await this.getAcademy(providerId);
    const requiredModules = academy.modules.length;
    const completedModules = academy.modules.filter((m) => m.completedAt).length;
    if (requiredModules > 0 && completedModules >= requiredModules) {
      await partnerAcquisitionEvents.emitTrainingCompleted(providerId).catch(() => undefined);
      const { partnerReferralService } = await import("./partner-referral.service");
      void partnerReferralService.onTraining(providerId).catch(() => undefined);
    }

    return { progress: row };
  }

  async getCompliance(providerId: string) {
    const { complianceExpiryService } = await import("./compliance-expiry.service");
    const summary = await complianceExpiryService.partnerSummary(providerId);
    const verifiedDocs = summary.documents.filter((d) => d.isVerified).length;
    const complianceScore =
      summary.documents.length === 0
        ? summary.kyc.isVerified
          ? 50
          : 0
        : Math.round((verifiedDocs / summary.documents.length) * 100);

    return {
      status: summary.status,
      explanation: summary.explanation,
      restricted: summary.restricted,
      restrictionReason: summary.restrictionReason,
      documents: summary.documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        documentName: d.documentName,
        issuer: d.issuer,
        issueDate: d.issueDate,
        isVerified: d.isVerified,
        expiryDate: d.expiryDate,
        expiryState: d.expiryState,
        daysToExpiry: d.daysToExpiry,
        cta: d.cta,
        category: d.category,
        expiringSoon: d.expiryState === "EXPIRING_SOON" || d.expiryState === "EXPIRING_URGENT",
      })),
      verification: {
        isVerified: summary.kyc.isVerified,
        kycStatus: summary.kyc.status,
        backgroundCheckStatus: summary.backgroundCheck.status,
        backgroundCheck: summary.backgroundCheck.status,
      },
      complianceScore,
      expiringSoon: summary.documents.filter((d) => d.expiryState === "EXPIRING_SOON" || d.expiryState === "EXPIRING_URGENT").length,
      certifications: summary.certifications,
      insurance: summary.insurance,
    };
  }

  async getWellbeing(providerId?: string) {
    let config = await prisma.platformWellbeingConfig.findUnique({ where: { id: "default" } });
    if (!config) {
      config = await prisma.platformWellbeingConfig.create({
        data: { id: "default", sosPhone: "112" },
      });
    }
    if (!providerId) return config;
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { emergencyContactName: true, emergencyContactPhone: true },
    });
    return {
      ...config,
      emergencyContactName: provider?.emergencyContactName ?? null,
      emergencyContactPhone: provider?.emergencyContactPhone ?? null,
    };
  }

  async updateEmergencyContact(
    providerId: string,
    input: { emergencyContactName?: string; emergencyContactPhone?: string },
  ) {
    const { sanitizeUserInput } = await import("../utils/sanitizer");
    return prisma.provider.update({
      where: { id: providerId },
      data: {
        emergencyContactName:
          input.emergencyContactName != null ? sanitizeUserInput(input.emergencyContactName, 100) : undefined,
        emergencyContactPhone:
          input.emergencyContactPhone != null ? sanitizeUserInput(input.emergencyContactPhone, 20) : undefined,
      },
      select: { emergencyContactName: true, emergencyContactPhone: true },
    });
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
    const rangeStart = startOfDay(new Date(todayStart.getTime() - 13 * DAY_MS));
    const activeStatuses = ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as const;

    const [
      online,
      attendanceToday,
      providers,
      rates,
      openSessions,
      busyRows,
      jobsByStatus,
      attendanceRows,
      topPartners,
      cityRows,
    ] = await Promise.all([
      prisma.provider.count({ where: { isOnline: true, isApproved: true } }),
      prisma.partnerAttendanceSession.count({ where: { checkInAt: { gte: todayStart } } }),
      prisma.provider.count({ where: { isApproved: true, isActive: true } }),
      prisma.provider.aggregate({
        where: { isApproved: true },
        _avg: { acceptanceRate: true, completionRate: true, cancellationRate: true, onTimeRate: true, rating: true },
      }),
      prisma.partnerAttendanceSession.count({ where: { checkOutAt: null } }),
      prisma.booking.findMany({
        where: { status: { in: [...activeStatuses] }, providerId: { not: null } },
        select: { providerId: true },
        distinct: ["providerId"],
      }),
      prisma.booking.groupBy({
        by: ["status"],
        where: { status: { in: [...activeStatuses] } },
        _count: { _all: true },
      }),
      prisma.partnerAttendanceSession.findMany({
        where: { checkInAt: { gte: rangeStart } },
        select: { checkInAt: true },
      }),
      prisma.provider.findMany({
        where: { isApproved: true, isActive: true },
        orderBy: [{ completionRate: "desc" }, { rating: "desc" }],
        take: 8,
        select: {
          id: true,
          city: true,
          isOnline: true,
          rating: true,
          acceptanceRate: true,
          completionRate: true,
          completedBookings: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.provider.groupBy({
        by: ["city"],
        where: { isApproved: true, isActive: true },
        _count: { _all: true },
      }),
    ]);

    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayCounts = new Map<string, number>();
    const hourCounts = Array.from({ length: 24 }, () => 0);
    for (const row of attendanceRows) {
      const at = row.checkInAt;
      dayCounts.set(dayKey(at), (dayCounts.get(dayKey(at)) ?? 0) + 1);
      if (at >= todayStart) hourCounts[at.getHours()] += 1;
    }

    const checkInsByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(rangeStart.getTime() + i * DAY_MS);
      const date = dayKey(d);
      return { date, count: dayCounts.get(date) ?? 0 };
    });
    const checkInsByHour = Array.from({ length: now.getHours() + 1 }, (_, hour) => ({
      hour,
      count: hourCounts[hour] ?? 0,
    }));

    const busyProviders = busyRows.length;
    const idleOnline = Math.max(0, online - busyProviders);

    return {
      onlineProviders: online,
      totalProviders: providers,
      activeJobs: jobsByStatus.reduce((sum, row) => sum + row._count._all, 0),
      attendanceCheckInsToday: attendanceToday,
      avgAcceptanceRate: round2(rates._avg.acceptanceRate ?? 0),
      avgCompletionRate: round2(rates._avg.completionRate ?? 0),
      avgCancellationRate: round2(rates._avg.cancellationRate ?? 0),
      avgOnTimeRate: round2(rates._avg.onTimeRate ?? 0),
      avgRating: round2(rates._avg.rating ?? 0),
      busyProviders,
      idleOnline,
      offlineProviders: Math.max(0, providers - online),
      openSessions,
      jobsByStatus: jobsByStatus
        .map((row) => ({ status: row.status, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      checkInsByDay,
      checkInsByHour,
      topPartners: topPartners.map((p) => ({
        id: p.id,
        name: `${p.user.firstName} ${p.user.lastName}`.trim() || "Partner",
        city: p.city,
        online: p.isOnline,
        rating: round2(p.rating),
        acceptanceRate: round2(p.acceptanceRate),
        completionRate: round2(p.completionRate),
        completedBookings: p.completedBookings,
      })),
      cities: cityRows
        .map((row) => ({ city: row.city?.trim() || "Unassigned", count: row._count._all }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
      generatedAt: now.toISOString(),
    };
  }
}

export const partnerOsService = new PartnerOsService();
