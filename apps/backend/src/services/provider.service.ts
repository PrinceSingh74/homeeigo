import { AssignmentAttemptStatus, BookingStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";
import { parsePagination } from "../lib/pagination";
import { bookingStatusApi, paymentStatusApi } from "../lib/format";
import { commissionRateForVolume } from "./earnings.service";
import { addressPiiService } from "./address-pii.service";
import { encryptionService } from "./encryption.service";
import { partnerOperationsService } from "./partner-operations.service";

function startOfDayUtc(d = new Date()): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** First day of the current calendar month (matches earnings.service tier logic). */
function calendarMonthStart(d = new Date()): Date {
  const c = new Date(d);
  c.setDate(1);
  c.setHours(0, 0, 0, 0);
  return c;
}

function daysAgo(days: number, from = new Date()): Date {
  const c = startOfDayUtc(from);
  c.setDate(c.getDate() - days);
  return c;
}

/** Accepted jobs the partner is working on (excludes unaccepted dispatches). */
const ACCEPTED_TAB_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
];

/** Provider is busy — includes dispatched-but-not-yet-accepted requests. */
const BUSY_STATUSES: BookingStatus[] = [BookingStatus.PENDING, ...ACCEPTED_TAB_STATUSES];

const STATUS_MAP: Record<string, BookingStatus[]> = {
  pending: [BookingStatus.PENDING],
  accepted: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE],
  in_progress: [BookingStatus.IN_PROGRESS],
  completed: [BookingStatus.COMPLETED],
  cancelled: [
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    BookingStatus.REJECTED,
  ],
  active: ACCEPTED_TAB_STATUSES,
};

export class ProviderService {
  private providerName(p: { user: { firstName: string; lastName: string }; businessName: string | null }) {
    return p.businessName || `${p.user.firstName} ${p.user.lastName}`.trim();
  }

  async search(body: {
    serviceId: string;
    latitude: number;
    longitude: number;
    radius?: number;
    minRating?: number;
    minCompletionRate?: number;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = parsePagination({ page: body.page, limit: body.limit });
    const radius = body.radius ?? 10;
    const providers = await prisma.provider.findMany({
      where: {
        isActive: true,
        isApproved: true,
        serviceCategories: { has: body.serviceId },
        rating: body.minRating ? { gte: body.minRating } : undefined,
        completionRate: body.minCompletionRate ? { gte: body.minCompletionRate } : undefined,
      },
      include: { user: true, currentLocation: true },
    });

    const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
    const filtered = providers
      .map((p) => {
        const loc = p.currentLocation;
        const dist = loc
          ? distanceKm(body.latitude, body.longitude, loc.latitude, loc.longitude)
          : 99;
        return { p, dist };
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);

    const slice = filtered.slice(skip, skip + limit);
    return {
      providers: slice.map(({ p, dist }) => ({
        id: p.id,
        name: this.providerName(p),
        rating: p.rating,
        reviewCount: p.totalReviews,
        profileImage: p.profileImage ?? p.user.profileImage,
        completionRate: p.completionRate,
        responseRate: p.responseRate,
        isOnline: p.isOnline,
        distance: Math.round(dist * 10) / 10,
        eta: etaMinutes(dist),
        basePrice: service?.basePrice ?? 0,
      })),
      total: filtered.length,
      page,
    };
  }

  async byId(id: string) {
    const p = await prisma.provider.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!p) return null;
    const services = await prisma.service.findMany({
      where: { id: { in: p.serviceCategories } },
      select: { id: true, name: true },
    });
    return {
      id: p.id,
      name: this.providerName(p),
      bio: p.bio,
      profileImage: p.profileImage ?? p.user.profileImage,
      rating: p.rating,
      totalReviews: p.totalReviews,
      totalBookings: p.totalBookings,
      completedBookings: p.completedBookings,
      completionRate: p.completionRate,
      responseRate: p.responseRate,
      onTimeRate: p.onTimeRate,
      avgResponseTime: p.avgResponseTime,
      isOnline: p.isOnline,
      onlineSince: p.onlineSince,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      workingDays: p.workingDays,
      services,
      certifications: p.certifications,
      isVerified: p.isVerified,
      verificationDate: p.verificationDate?.toISOString().slice(0, 10),
    };
  }

  async reviews(providerId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: { providerId: string; stars?: number } = { providerId };
    if (query.rating) where.stars = Number(query.rating);

    const [rows, total, breakdown] = await Promise.all([
      prisma.rating.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { firstName: true, profileImage: true } } },
      }),
      prisma.rating.count({ where }),
      prisma.rating.groupBy({
        by: ["stars"],
        where: { providerId },
        _count: true,
      }),
    ]);

    const ratingBreakdown: Record<string, number> = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
    for (const b of breakdown) ratingBreakdown[String(b.stars)] = b._count;

    return {
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.stars,
        reviewText: r.reviewText,
        user: { firstName: r.user.firstName, profileImage: r.user.profileImage },
        photos: r.photos,
        tipAmount: r.tipAmount,
        helpfulCount: r.helpfulCount,
        providerResponse: r.providerResponse,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      ratingBreakdown,
    };
  }

  async availability(providerId: string, date: string, serviceId: string) {
    const dayStart = new Date(`${date}T00:00:00`);
    const cap = await partnerOperationsService.loadCapacityFor(providerId, dayStart);
    const snap = await partnerOperationsService.snapshot(providerId);
    const isAvailable = cap.availableSlots > 0 && snap.operationalStatus !== "suspended" && snap.operationalStatus !== "paused";
    const start = snap.workingHoursStart ?? "09:00";
    const end = snap.workingHoursEnd ?? "18:00";
    const slots =
      isAvailable && snap.breakWindows.length === 0
        ? [{ startTime: start, endTime: end }]
        : isAvailable
          ? [
              { startTime: start, endTime: snap.breakWindows[0]!.start },
              { startTime: snap.breakWindows[0]!.end, endTime: end },
            ]
          : [];
    return {
      isAvailable,
      availableSlots: slots.filter((s) => s.startTime < s.endTime),
      nextAvailableDate: date,
      capacity: cap,
      serviceId,
    };
  }

  async nearby(query: {
    latitude: number;
    longitude: number;
    radius?: number;
    serviceId?: string;
    limit?: number;
  }) {
    const limit = Math.min(50, Number(query.limit) || 10);
    const radius = query.radius ?? 10;
    const where: Record<string, unknown> = { isActive: true, isApproved: true, isOnline: true };
    if (query.serviceId) where.serviceCategories = { has: query.serviceId };

    const providers = await prisma.provider.findMany({
      where,
      include: { user: true, currentLocation: true },
    });

    const list = providers
      .map((p) => {
        const loc = p.currentLocation;
        const dist = loc
          ? distanceKm(query.latitude, query.longitude, loc.latitude, loc.longitude)
          : 99;
        return { p, dist };
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit);

    return {
      providers: list.map(({ p, dist }) => ({
        id: p.id,
        name: this.providerName(p),
        distance: Math.round(dist * 10) / 10,
        rating: p.rating,
        isOnline: p.isOnline,
        eta: etaMinutes(dist),
      })),
      total: list.length,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Partner-self ("me") read endpoints                                  */
  /* ------------------------------------------------------------------ */

  async me(providerId: string) {
    const p = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!p) return null;
    const services = await prisma.service.findMany({
      where: { id: { in: p.serviceCategories } },
      select: { id: true, name: true },
    });
    return {
      id: p.id,
      name: this.providerName(p),
      firstName: p.user.firstName,
      lastName: p.user.lastName,
      email: p.user.email,
      phoneNumber: p.user.phoneNumber,
      profileImage: p.profileImage ?? p.user.profileImage,
      businessName: p.businessName,
      bio: p.bio,
      city: p.city || p.user.preferredCity,
      rating: p.rating,
      totalReviews: p.totalReviews,
      totalBookings: p.totalBookings,
      completedBookings: p.completedBookings,
      completionRate: p.completionRate,
      responseRate: p.responseRate,
      onTimeRate: p.onTimeRate,
      avgResponseTime: p.avgResponseTime,
      cancellationRate: p.cancellationRate,
      acceptanceRate: p.acceptanceRate,
      walletBalance: p.walletBalance,
      totalEarnings: p.totalEarnings,
      isOnline: p.isOnline,
      onlineSince: p.onlineSince,
      currentStatus: p.currentStatus,
      pausedAt: p.pausedAt,
      pauseReason: p.pauseReason,
      timezone: p.timezone,
      workingHoursStart: p.workingHoursStart,
      workingHoursEnd: p.workingHoursEnd,
      workingDays: p.workingDays,
      maxJobsPerDay: p.maxJobsPerDay,
      maxConcurrentJobs: p.maxConcurrentJobs,
      breakWindows: p.breakWindows,
      serviceRadiusKm: p.serviceRadiusKm,
      baseLatitude: p.baseLatitude,
      baseLongitude: p.baseLongitude,
      services,
      serviceCategories: p.serviceCategories,
      certifications: p.certifications,
      serviceRegions: p.serviceRegions,
      paymentMethodPreference: p.paymentMethodPreference,
      upiId: p.upiId,
      bankName: p.bankName,
      isApproved: p.isApproved,
      isVerified: p.isVerified,
      isActive: p.isActive,
      isBanned: p.isBanned,
      kycStatus: p.user.kycStatus,
      badges: p.badges,
      backgroundCheckStatus: p.backgroundCheckStatus,
    };
  }

  async updateSettings(
    providerId: string,
    patch: {
      workingHoursStart?: string;
      workingHoursEnd?: string;
      workingDays?: string[];
      breakWindows?: Array<{ start: string; end: string }>;
      maxJobsPerDay?: number | null;
      maxConcurrentJobs?: number;
      paymentMethodPreference?: string;
      upiId?: string;
      bio?: string;
    },
  ) {
    const opsPatch = {
      workingHoursStart: patch.workingHoursStart,
      workingHoursEnd: patch.workingHoursEnd,
      workingDays: patch.workingDays,
      breakWindows: patch.breakWindows,
      maxJobsPerDay: patch.maxJobsPerDay,
      maxConcurrentJobs: patch.maxConcurrentJobs,
    };
    const hasOps = Object.values(opsPatch).some((v) => v !== undefined);
    if (hasOps) {
      await partnerOperationsService.updateAvailabilityConfig(providerId, opsPatch);
    }

    const data: Prisma.ProviderUpdateInput = {};
    if (patch.paymentMethodPreference !== undefined) {
      data.paymentMethodPreference = patch.paymentMethodPreference;
    }
    if (patch.upiId !== undefined) data.upiId = patch.upiId;
    if (patch.bio !== undefined) data.bio = patch.bio;

    if (Object.keys(data).length > 0) {
      await prisma.provider.update({ where: { id: providerId }, data });
    }

    return prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        workingDays: true,
        breakWindows: true,
        maxJobsPerDay: true,
        maxConcurrentJobs: true,
        paymentMethodPreference: true,
        upiId: true,
        bio: true,
      },
    });
  }

  async setOnline(providerId: string, online: boolean) {
    const snap = await partnerOperationsService.setOnline(providerId, online);
    return {
      id: providerId,
      isOnline: snap.isOnline,
      onlineSince: snap.onlineSince,
      operationalStatus: snap.operationalStatus,
      operations: snap,
    };
  }

  async myBookings(
    providerId: string,
    query: { status?: string; page?: string | number; limit?: string | number; sortBy?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);
    let where: Prisma.BookingWhereInput = { providerId };

    if (query.status === "pending") {
      // Only live dispatches waiting for accept/reject — not already-accepted jobs.
      const openAttempts = await prisma.assignmentAttempt.findMany({
        where: {
          providerId,
          status: AssignmentAttemptStatus.SENT,
          job: { booking: { status: BookingStatus.PENDING } },
        },
        select: { job: { select: { bookingId: true } } },
      });
      const openBookingIds = [...new Set(openAttempts.map((a) => a.job.bookingId))];
      where = { id: { in: openBookingIds }, status: BookingStatus.PENDING };
    } else if (query.status && query.status !== "all") {
      where = {
        providerId,
        status: {
          in: STATUS_MAP[query.status] ?? [query.status.toUpperCase() as BookingStatus],
        },
      };
    }
    const orderBy =
      query.sortBy === "upcoming"
        ? { scheduledDate: "asc" as const }
        : { createdAt: "desc" as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          user: { select: { firstName: true, lastName: true, profileImage: true, phoneNumber: true, phoneEncrypted: true } },
          service: { select: { id: true, name: true, icon: true, basePrice: true } },
          address: {
            select: {
              label: true,
              addressLine1: true,
              addressLine1Encrypted: true,
              addressLine2: true,
              addressLine2Encrypted: true,
              fullAddress: true,
              fullAddressEncrypted: true,
              buildingName: true,
              flatNumber: true,
              landmark: true,
              landmarkEncrypted: true,
              specialInstructions: true,
              specialInstructionsEncrypted: true,
              city: true,
              state: true,
              zipCode: true,
              latitude: true,
              longitude: true,
            },
          },
          rating: { select: { stars: true } },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings: await Promise.all(
        rows.map(async (b) => {
          // The provider is assigned to this booking, so they are authorized to see the
          // customer's full address + contact to deliver the service. Address PII is stored
          // encrypted (plaintext columns are blank) — decrypt it here.
          const address = b.address ? await addressPiiService.viewForFulfilment(b.address) : null;
          const rawPhone =
            b.user.phoneNumber ||
            (b.user.phoneEncrypted ? await encryptionService.decrypt(b.user.phoneEncrypted, "PHONE") : null);
          // Google-login users can carry a non-phone identifier (e.g. "oauth_…") — only
          // surface something that actually looks like a callable number.
          const phoneNumber = rawPhone && /^\+?\d[\d\s-]{6,}$/.test(rawPhone) ? rawPhone : null;
          const { maskPhoneForPartner } = await import("../lib/pii-normalize");
          return {
            id: b.id,
            bookingNumber: b.bookingNumber,
            status: bookingStatusApi(b.status),
            scheduledDate: b.scheduledDate,
            completedAt: b.completedAt,
            // Lifecycle anchors — arrival does not change `status`, so the partner UI
            // needs these to know whether to offer "On my way", "I've arrived" or
            // "Start job". Omitting them locked the card on "I've arrived" forever.
            enRouteAt: b.enRouteAt,
            arrivedAt: b.arrivedAt,
            startedAt: b.startedAt,
            amount: b.baseAmount,
            finalAmount: b.finalAmount,
            addons: b.addons ?? undefined,
            paymentStatus: paymentStatusApi(b.paymentStatus),
            description: b.description,
            eta: b.eta,
            customer: {
              firstName: b.user.firstName,
              lastName: b.user.lastName,
              profileImage: b.user.profileImage,
              // List payloads never include raw phone — Call Customer reveals dial URI once.
              phoneMasked: phoneNumber ? maskPhoneForPartner(phoneNumber) : null,
            },
            service: b.service,
            address,
            ratingGiven: !!b.rating,
            rating: b.rating?.stars ?? null,
          };
        }),
      ),
      total,
      page,
      limit,
    };
  }

  async myDashboard(providerId: string) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) return null;

    const todayStart = startOfDayUtc();
    const weekStart = daysAgo(6);
    const monthStart = daysAgo(29);
    const yesterdayStart = daysAgo(1);

    const [
      todayEarningAgg,
      yesterdayEarningAgg,
      weekEarningAgg,
      monthEarningAgg,
      completedToday,
      completedYesterday,
      pendingRequests,
      activeBookings,
      weekdayEarnings,
      monthlyCompletedForTier,
    ] = await Promise.all([
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: todayStart } },
        _sum: { netEarning: true, commission: true },
      }),
      prisma.earning.aggregate({
        where: {
          providerId,
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { netEarning: true },
      }),
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: weekStart } },
        _sum: { netEarning: true, commission: true, grossAmount: true },
      }),
      prisma.earning.aggregate({
        where: { providerId, createdAt: { gte: monthStart } },
        _sum: { netEarning: true },
      }),
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: todayStart },
        },
      }),
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: yesterdayStart, lt: todayStart },
        },
      }),
      prisma.assignmentAttempt.count({
        where: {
          providerId,
          status: AssignmentAttemptStatus.SENT,
          job: { booking: { status: BookingStatus.PENDING } },
        },
      }),
      prisma.booking.count({
        where: { providerId, status: { in: ACCEPTED_TAB_STATUSES } },
      }),
      prisma.earning.findMany({
        where: { providerId, createdAt: { gte: weekStart } },
        select: { createdAt: true, netEarning: true },
        orderBy: { createdAt: "asc" },
      }),
      // Calendar-month completed bookings — drives the commission tier
      // (same definition earnings.service uses when charging commission).
      prisma.booking.count({
        where: {
          providerId,
          status: BookingStatus.COMPLETED,
          completedAt: { gte: calendarMonthStart() },
        },
      }),
    ]);

    // Bucket weekday earnings into the last 7 days
    const sparkline: { date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgo(i);
      const next = daysAgo(i - 1);
      const amount = weekdayEarnings
        .filter((e) => e.createdAt >= d && e.createdAt < next)
        .reduce((sum, e) => sum + e.netEarning, 0);
      sparkline.push({ date: d.toISOString().slice(0, 10), amount: Math.round(amount) });
    }

    const todayEarnings = Math.round(todayEarningAgg._sum.netEarning ?? 0);
    const yesterdayEarnings = Math.round(yesterdayEarningAgg._sum.netEarning ?? 0);
    const todayEarningsChange =
      yesterdayEarnings > 0
        ? Math.round(((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100)
        : todayEarnings > 0
          ? 100
          : 0;

    return {
      earnings: {
        today: todayEarnings,
        todayChange: todayEarningsChange,
        yesterday: yesterdayEarnings,
        thisWeek: Math.round(weekEarningAgg._sum.netEarning ?? 0),
        thisMonth: Math.round(monthEarningAgg._sum.netEarning ?? 0),
        lifetime: Math.round(provider.totalEarnings),
        sparkline,
        weeklyCommission: Math.round(weekEarningAgg._sum.commission ?? 0),
        weeklyGross: Math.round(weekEarningAgg._sum.grossAmount ?? 0),
        // Net take-home % of gross this week — computed server-side so the UI
        // never derives commission percentages itself.
        weeklyTakeHomePct:
          (weekEarningAgg._sum.grossAmount ?? 0) > 0
            ? Math.round(
                ((weekEarningAgg._sum.netEarning ?? 0) /
                  (weekEarningAgg._sum.grossAmount ?? 1)) *
                  100,
              )
            : 0,
        // The provider's CURRENT commission tier (20/18/15/12), as a percentage.
        commissionRate: Math.round(commissionRateForVolume(monthlyCompletedForTier) * 100),
      },
      counts: {
        completedToday,
        completedTodayDelta: completedToday - completedYesterday,
        pendingRequests,
        activeBookings,
        completedLifetime: provider.completedBookings,
        totalBookings: provider.totalBookings,
        totalReviews: provider.totalReviews,
      },
      rates: {
        acceptanceRate: provider.acceptanceRate,
        completionRate: provider.completionRate,
        responseRate: provider.responseRate,
        onTimeRate: provider.onTimeRate,
        cancellationRate: provider.cancellationRate,
      },
      rating: provider.rating,
      walletBalance: provider.walletBalance,
      isOnline: provider.isOnline,
      onlineSince: provider.onlineSince,
    };
  }

  async myEarningsSummary(providerId: string, days = 30) {
    const start = daysAgo(days - 1);
    const earnings = await prisma.earning.findMany({
      where: { providerId, createdAt: { gte: start } },
      select: {
        grossAmount: true,
        commission: true,
        netEarning: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const totalGross = earnings.reduce((s, e) => s + e.grossAmount, 0);
    const totalCommission = earnings.reduce((s, e) => s + e.commission, 0);
    const totalNet = earnings.reduce((s, e) => s + e.netEarning, 0);

    // Daily series
    const byDay = new Map<string, number>();
    for (const e of earnings) {
      const key = e.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + e.netEarning);
    }
    const series: { date: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, amount: Math.round(byDay.get(key) ?? 0) });
    }

    return {
      period: `Last ${days} days`,
      totalJobs: earnings.length,
      totalGross: Math.round(totalGross),
      totalCommission: Math.round(totalCommission),
      totalNet: Math.round(totalNet),
      /** GROSS per job — the customer-facing job value. Unchanged; existing consumers rely on it. */
      averagePerJob:
        earnings.length > 0 ? Math.round(totalGross / earnings.length) : 0,
      /**
       * NET per job — what the partner actually receives after commission.
       *
       * Added because the two are ~19% apart on live data (gross 562 vs net 458) and every
       * REALISED figure in this service is net (`_sum.netEarning`). Any calculation that divides a
       * net amount by a per-job value must use this one; using the gross average understates the
       * jobs required to reach a target.
       */
      averageNetPerJob:
        earnings.length > 0 ? Math.round(totalNet / earnings.length) : 0,
      series,
    };
  }
}


export const providerService = new ProviderService();
