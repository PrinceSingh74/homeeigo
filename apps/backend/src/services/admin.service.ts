import prisma from "../lib/prisma";
import { maskProviderSensitive } from "./sensitive-data.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { formatKycStatus } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { RefreshTokenService } from "./refresh-token.service";
import { JWTService } from "./jwt.service";

const refreshTokenService = new RefreshTokenService(prisma, new JWTService());

export class AdminService {
  async dashboard() {
    const [
      totalUsers,
      totalProviders,
      totalBookings,
      completedBookings,
      revenueAgg,
      monthRevenue,
      ratingAgg,
      onlineProviders,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.provider.count(),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: "COMPLETED" } }),
      prisma.booking.aggregate({ where: { paymentStatus: "SUCCESS" }, _sum: { finalAmount: true } }),
      prisma.booking.aggregate({
        where: {
          paymentStatus: "SUCCESS",
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { finalAmount: true },
      }),
      prisma.provider.aggregate({ _avg: { rating: true } }),
      prisma.provider.count({ where: { isOnline: true } }),
    ]);

    const days = 7;
    const bookingsByDay: { date: string; count: number }[] = [];
    const revenueByDay: { date: string; revenue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.setHours(0, 0, 0, 0));
      const end = new Date(d.setHours(23, 59, 59, 999));
      const dateStr = start.toISOString().slice(0, 10);
      const [count, rev] = await Promise.all([
        prisma.booking.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.booking.aggregate({
          where: { createdAt: { gte: start, lte: end }, paymentStatus: "SUCCESS" },
          _sum: { finalAmount: true },
        }),
      ]);
      bookingsByDay.push({ date: dateStr, count });
      revenueByDay.push({ date: dateStr, revenue: rev._sum.finalAmount ?? 0 });
    }

    return {
      stats: {
        totalUsers,
        totalProviders,
        totalBookings,
        completedBookings,
        totalRevenue: revenueAgg._sum.finalAmount ?? 0,
        thisMonthRevenue: monthRevenue._sum.finalAmount ?? 0,
        averageRating: Math.round((ratingAgg._avg.rating ?? 0) * 10) / 10,
        activeNow: onlineProviders,
      },
      charts: { bookingsByDay, revenueByDay },
    };
  }

  async listUsers(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = { role: "CUSTOMER" };
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { firstName: { contains: query.search, mode: "insensitive" } },
        { lastName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.status === "banned") where.isBanned = true;
    if (query.status === "active") where.isBanned = false;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { bookings: true } } },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        totalBookings: u._count.bookings,
        totalSpent: u.totalSpent,
        kycStatus: formatKycStatus(u.kycStatus),
        isActive: u.isActive && !u.isBanned,
        createdAt: u.createdAt.toISOString().slice(0, 10),
      })),
      total,
      page,
    };
  }

  async listProviders(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (query.status === "verified") where.isVerified = true;
    if (query.status === "pending") where.isApproved = false;
    if (query.status === "applications") {
      where.registrationStatus = "PENDING";
      where.isApproved = false;
    }
    if (query.search) {
      const term = sanitizeUserInput(query.search, 200);
      where.user = {
        OR: [
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        skip,
        take: limit,
        include: { user: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.provider.count({ where }),
    ]);

    return {
      providers: rows.map((p) => ({
        id: p.id,
        name: `${p.user.firstName} ${p.user.lastName}`,
        email: p.user.email,
        phone: p.user.phoneNumber,
        rating: p.rating,
        totalBookings: p.totalBookings,
        completedBookings: p.completedBookings,
        isVerified: p.isVerified,
        isApproved: p.isApproved,
        registrationStatus: p.registrationStatus,
        serviceCategories: p.serviceCategories,
        city: p.city,
        experienceYears: p.experienceYears,
        registeredAt: p.registeredAt.toISOString(),
        rejectionReason: p.rejectionReason,
        totalEarnings: p.totalEarnings,
        createdAt: p.createdAt.toISOString().slice(0, 10),
        kyc: maskProviderSensitive({
          panNumber: p.panNumber,
          aadharNumber: p.aadharNumber,
          bankAccountNumber: p.bankAccountNumber,
        }),
      })),
      total,
      page,
    };
  }

  async listBookings(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (query.status && query.status !== "all") {
      where.status = query.status.toUpperCase();
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as { gte?: Date }).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as { lte?: Date }).lte = new Date(query.endDate);
    }

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: true,
          provider: { include: { user: true } },
          service: true,
          rating: true,
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        user: `${b.user.firstName} ${b.user.lastName}`,
        provider: b.provider ? `${b.provider.user.firstName} ${b.provider.user.lastName}` : "—",
        service: b.service.name,
        amount: b.finalAmount,
        status: b.status.toLowerCase(),
        rating: b.rating?.stars,
        completedAt: b.completedAt,
      })),
      total,
      page,
    };
  }

  async verifyProvider(id: string, action: "approve" | "reject", notes?: string, adminUserId?: string) {
    const existing = await prisma.provider.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!existing) throw new Error("Provider not found");

    const safeNotes = notes ? sanitizeUserInput(notes, 2000) : undefined;

    const data =
      action === "approve"
        ? {
            isApproved: true,
            isVerified: true,
            verificationDate: new Date(),
            approvalNotes: safeNotes,
            registrationStatus: "APPROVED" as const,
            partnerApprovedAt: new Date(),
            rejectedAt: null,
            rejectionReason: null,
            adminApprovedBy: adminUserId,
            backgroundCheckStatus: "CLEARED" as const,
            backgroundCheckDate: new Date(),
          }
        : {
            isApproved: false,
            approvalNotes: safeNotes,
            registrationStatus: "REJECTED" as const,
            rejectedAt: new Date(),
            rejectionReason: safeNotes ?? "Application not approved",
          };

    const p = await prisma.provider.update({ where: { id }, data });

    if (action === "approve") {
      await prisma.partnerBackgroundCheck.upsert({
        where: { providerId: id },
        create: {
          providerId: id,
          status: "APPROVED",
          approvedBy: adminUserId,
          approvalNotes: notes,
          approvedAt: new Date(),
        },
        update: {
          status: "APPROVED",
          approvedBy: adminUserId,
          approvalNotes: notes,
          approvedAt: new Date(),
        },
      });
    } else {
      await prisma.partnerBackgroundCheck.upsert({
        where: { providerId: id },
        create: { providerId: id, status: "REJECTED", approvalNotes: notes },
        update: { status: "REJECTED", approvalNotes: notes },
      });
      await refreshTokenService.revokeAllUserTokens(existing.userId);
    }

    await prisma.emailLog.create({
      data: {
        to: existing.user.email,
        emailType: action === "approve" ? "approval" : "rejection",
        subject:
          action === "approve"
            ? "Welcome! Your HOMIGO Partner Application is Approved"
            : "HOMIGO Partner Application Status",
        content: JSON.stringify({
          name: existing.user.firstName,
          reason: notes,
          message:
            action === "approve"
              ? "You can now log in to your partner dashboard."
              : "Unfortunately we cannot approve your application at this time.",
        }),
        status: "logged",
      },
    });

    return p;
  }

  async banUser(id: string, action: "ban" | "unban", reason?: string) {
    const user = await prisma.user.update({
      where: { id },
      data:
        action === "ban"
          ? { isBanned: true, bannedReason: reason, bannedAt: new Date() }
          : { isBanned: false, bannedReason: null, bannedAt: null },
    });
    if (action === "ban") {
      await refreshTokenService.revokeAllUserTokens(id);
      await prisma.booking.updateMany({
        where: {
          userId: id,
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE"] },
        },
        data: { status: "CANCELLED_BY_USER", cancelledAt: new Date() },
      });
    }
    return user;
  }

  async analytics(query: { startDate?: string; endDate?: string }) {
    const start = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 86400000);
    const end = query.endDate ? new Date(query.endDate) : new Date();
    const where = { createdAt: { gte: start, lte: end } };

    const [totalBookings, completed, cancelled, revenue, earningsAgg] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.count({ where: { ...where, status: "COMPLETED" } }),
      prisma.booking.count({
        where: { ...where, status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] } },
      }),
      prisma.booking.aggregate({
        where: { ...where, paymentStatus: "SUCCESS" },
        _sum: { finalAmount: true },
      }),
      prisma.earning.aggregate({
        where: { createdAt: { gte: start, lte: end } },
        _sum: { commission: true, netEarning: true, grossAmount: true },
      }),
    ]);

    const totalRevenue = revenue._sum.finalAmount ?? 0;
    const platformCommission = round2(earningsAgg._sum.commission ?? 0);
    const providerPayouts = round2(earningsAgg._sum.netEarning ?? 0);
    // Effective take rate = commission as a % of the gross revenue that actually
    // generated it (Earning.grossAmount), NOT of unrelated SUCCESS-payment totals.
    const commissionableGross = earningsAgg._sum.grossAmount ?? 0;

    const topServices = await prisma.booking.groupBy({
      by: ["serviceId"],
      where,
      _count: true,
      _sum: { finalAmount: true },
      orderBy: { _count: { serviceId: "desc" } },
      take: 5,
    });
    const serviceNames = await prisma.service.findMany({
      where: { id: { in: topServices.map((s) => s.serviceId) } },
    });
    const nameMap = Object.fromEntries(serviceNames.map((s) => [s.id, s.name]));

    // Real per-service commission/net from Earning rows (Earning has no serviceId,
    // so map earning -> booking -> serviceId). This replaces the frontend's
    // previous `revenue * 0.18` estimate with the actual recorded commission.
    const periodEarnings = await prisma.earning.findMany({
      where: { createdAt: { gte: start, lte: end }, bookingId: { not: null } },
      select: { bookingId: true, commission: true, netEarning: true },
    });
    const earningBookingIds = periodEarnings
      .map((e) => e.bookingId)
      .filter((id): id is string => id !== null);
    const earningBookings = await prisma.booking.findMany({
      where: { id: { in: earningBookingIds } },
      select: { id: true, serviceId: true },
    });
    const serviceIdByBooking = new Map(earningBookings.map((b) => [b.id, b.serviceId]));
    const commissionByService = new Map<string, { commission: number; netEarning: number }>();
    for (const e of periodEarnings) {
      const serviceId = e.bookingId ? serviceIdByBooking.get(e.bookingId) : undefined;
      if (!serviceId) continue;
      const agg = commissionByService.get(serviceId) ?? { commission: 0, netEarning: 0 };
      agg.commission += e.commission;
      agg.netEarning += e.netEarning;
      commissionByService.set(serviceId, agg);
    }

    const newUsers = await prisma.user.count({ where: { ...where, role: "CUSTOMER" } });

    return {
      period: { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
      overview: {
        totalBookings,
        completedBookings: completed,
        cancelledBookings: cancelled,
        totalRevenue,
        platformCommission,
        providerPayouts,
        // Platform take rate as a percentage, computed server-side (single source of
        // truth) against the commissionable gross — yields the true ~tier rate.
        commissionPercentage:
          commissionableGross > 0 ? round2((platformCommission / commissionableGross) * 100) : 0,
      },
      topServices: topServices.map((s) => ({
        name: nameMap[s.serviceId] ?? s.serviceId,
        bookings: s._count,
        revenue: s._sum.finalAmount ?? 0,
        commission: round2(commissionByService.get(s.serviceId)?.commission ?? 0),
        netEarning: round2(commissionByService.get(s.serviceId)?.netEarning ?? 0),
      })),
      topProviders: [],
      userMetrics: {
        newUsers,
        activeUsers: await prisma.user.count({ where: { lastActivityAt: { gte: start } } }),
        repeatBookingRate: 0.65,
      },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const adminService = new AdminService();
