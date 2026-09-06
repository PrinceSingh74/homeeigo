import prisma from "../lib/prisma";
import { maskProviderSensitive } from "./sensitive-data.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { formatKycStatus } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { userPiiService } from "./user-pii.service";
import { emailDeliveryService } from "./email-delivery.service";
import { RefreshTokenService } from "./refresh-token.service";
import { JWTService } from "./jwt.service";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import { partnerLeadService } from "./partner-lead.service";
import { partnerOnboardingService } from "./partner-onboarding.service";
import { onboardingStepLabel } from "./partner-lead-state-machine";
import { CREDITED_EARNING_WHERE } from "../lib/earning-settlement";

const refreshTokenService = new RefreshTokenService(prisma, new JWTService());

export class AdminService {
  async dashboard() {
    const days = 7;
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - (days - 1));
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date();
    rangeEnd.setHours(23, 59, 59, 999);

    const [
      totalUsers,
      totalProviders,
      totalBookings,
      completedBookings,
      revenueAgg,
      monthRevenue,
      ratingAgg,
      onlineProviders,
      recentBookings,
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
      prisma.booking.findMany({
        where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
        select: { createdAt: true, paymentStatus: true, finalAmount: true },
      }),
    ]);

    const bookingsByDay: { date: string; count: number }[] = [];
    const revenueByDay: { date: string; revenue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      /**
       * The label must be read off `d` before it is mutated into a UTC boundary, and from its
       * local calendar fields — not `start.toISOString()`. The server's process timezone is IST
       * (UTC+5:30): local midnight for "today" is 18:30 UTC the previous day, so slicing the ISO
       * string labelled every bucket one calendar day early. The counts underneath were always
       * correct — `start`/`end` genuinely bound the local day being queried — only the label was
       * wrong, which is exactly the failure mode that stays invisible until someone checks today's
       * date against the chart and finds today missing.
       */
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      const startMs = start.getTime();
      const endMs = end.getTime();
      let count = 0;
      let revenue = 0;
      for (const row of recentBookings) {
        const t = row.createdAt.getTime();
        if (t < startMs || t > endMs) continue;
        count += 1;
        if (row.paymentStatus === "SUCCESS") revenue += row.finalAmount ?? 0;
      }
      bookingsByDay.push({ date: dateStr, count });
      revenueByDay.push({ date: dateStr, revenue });
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
    if (query.kyc === "verified") where.kycStatus = "APPROVED";
    if (query.kyc === "pending") where.kycStatus = { in: ["NOT_STARTED", "PENDING", "IN_REVIEW"] };
    if (query.kyc === "rejected") where.kycStatus = "REJECTED";

    const orderBy =
      query.sort === "spend"
        ? { totalSpent: "desc" as const }
        : query.sort === "bookings"
          ? { bookings: { _count: "desc" as const } }
          : { createdAt: "desc" as const };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { _count: { select: { bookings: true } } },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        totalBookings: u._count.bookings,
        totalSpent: u.totalSpent,
        walletBalance: u.walletBalance,
        referralCount: u.referralCount,
        preferredCity: u.preferredCity,
        lastActivityAt: u.lastActivityAt?.toISOString() ?? null,
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
    if (query.status === "rejected") where.registrationStatus = "REJECTED";
    if (query.status === "applications") {
      where.registrationStatus = "PENDING";
      where.isApproved = false;
    }
    if (query.kyc === "verified") where.isVerified = true;
    if (query.kyc === "pending") where.isVerified = false;
    if (query.search) {
      const term = sanitizeUserInput(query.search, 200);
      where.user = {
        OR: [
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
        ],
      };
    }

    const orderBy =
      query.sort === "earnings"
        ? { totalEarnings: "desc" as const }
        : query.sort === "rating"
          ? { rating: "desc" as const }
          : query.sort === "jobs"
            ? { totalBookings: "desc" as const }
            : { createdAt: "desc" as const };

    const [rows, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        skip,
        take: limit,
        include: { user: true },
        orderBy,
      }),
      prisma.provider.count({ where }),
    ]);

    const providers = await Promise.all(
      rows.map(async (p) => {
        const masked = await userPiiService.withMaskedPii(p.user);
        const displayName = `${p.user.firstName} ${p.user.lastName}`.trim();
        return {
        id: p.id,
        name: p.businessName || displayName || "Partner",
        email: masked.email,
        phone: masked.phoneNumber,
        rating: p.rating,
        totalBookings: p.totalBookings,
        completedBookings: p.completedBookings,
        isVerified: p.isVerified,
        isApproved: p.isApproved,
        isOnline: p.isOnline,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        completionRate: p.completionRate,
        acceptanceRate: p.acceptanceRate,
        totalReviews: p.totalReviews,
        currentStatus: p.currentStatus,
        businessName: p.businessName,
        registrationStatus: p.registrationStatus,
        serviceCategories: p.serviceCategories,
        city: p.city,
        experienceYears: p.experienceYears,
        registeredAt: p.registeredAt?.toISOString() ?? p.createdAt.toISOString(),
        rejectionReason: p.rejectionReason,
        totalEarnings: p.totalEarnings,
        createdAt: p.createdAt.toISOString().slice(0, 10),
        kyc: maskProviderSensitive({
          panNumber: p.panNumber,
          aadharNumber: p.aadharNumber,
          bankAccountNumber: p.bankAccountNumber,
        }),
        };
      }),
    );

    return {
      providers,
      total,
      page,
    };
  }

  async listBookings(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};

    const LIVE_STATUSES = ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as const;
    const CANCELLED_STATUSES = ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED"] as const;
    const UNPAID = ["PENDING", "INITIATED", "PROCESSING"] as const;
    const REFUNDED = ["REFUNDED", "PARTIALLY_REFUNDED", "REFUNDING"] as const;

    if (query.status && query.status !== "all") {
      const lane = query.status.toLowerCase();
      if (lane === "live") where.status = { in: [...LIVE_STATUSES] };
      else if (lane === "cancelled" || lane === "canceled") where.status = { in: [...CANCELLED_STATUSES] };
      else where.status = query.status.toUpperCase();
    }

    if (query.payment && query.payment !== "all") {
      const pay = query.payment.toLowerCase();
      if (pay === "paid") where.paymentStatus = "SUCCESS";
      else if (pay === "unpaid" || pay === "open") where.paymentStatus = { in: [...UNPAID] };
      else if (pay === "refunded") where.paymentStatus = { in: [...REFUNDED] };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as { gte?: Date }).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as { lte?: Date }).lte = new Date(query.endDate);
    }

    if (query.search) {
      const term = sanitizeUserInput(query.search, 100);
      where.OR = [
        { bookingNumber: { contains: term, mode: "insensitive" } },
        { id: { contains: term, mode: "insensitive" } },
        { user: { firstName: { contains: term, mode: "insensitive" } } },
        { user: { lastName: { contains: term, mode: "insensitive" } } },
        { provider: { businessName: { contains: term, mode: "insensitive" } } },
        { provider: { user: { firstName: { contains: term, mode: "insensitive" } } } },
        { provider: { user: { lastName: { contains: term, mode: "insensitive" } } } },
        { service: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const sort = (query.sort ?? "recent").toLowerCase();
    const orderBy =
      sort === "amount"
        ? { finalAmount: "desc" as const }
        : sort === "scheduled"
          ? { scheduledDate: "asc" as const }
          : { createdAt: "desc" as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          bookingNumber: true,
          userId: true,
          providerId: true,
          status: true,
          paymentStatus: true,
          finalAmount: true,
          scheduledDate: true,
          createdAt: true,
          completedAt: true,
          cancelledAt: true,
          eta: true,
          premiumMatched: true,
          queuePriority: true,
          user: { select: { firstName: true, lastName: true } },
          provider: {
            select: {
              id: true,
              businessName: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
          service: { select: { name: true } },
          rating: { select: { stars: true } },
          address: { select: { city: true } },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        userId: b.userId,
        providerId: b.providerId,
        user: `${b.user.firstName} ${b.user.lastName}`.trim() || "Customer",
        provider: b.provider
          ? b.provider.businessName ||
            `${b.provider.user.firstName} ${b.provider.user.lastName}`.trim() ||
            "Partner"
          : "Unassigned",
        service: b.service.name,
        amount: b.finalAmount,
        status: b.status.toLowerCase(),
        paymentStatus: b.paymentStatus.toLowerCase(),
        rating: b.rating?.stars ?? null,
        scheduledDate: b.scheduledDate.toISOString(),
        createdAt: b.createdAt.toISOString(),
        completedAt: b.completedAt?.toISOString() ?? null,
        cancelledAt: b.cancelledAt?.toISOString() ?? null,
        city: b.address.city,
        eta: b.eta,
        premiumMatched: b.premiumMatched,
        queuePriority: b.queuePriority.toLowerCase(),
      })),
      total,
      page,
    };
  }

  async verifyProvider(
    id: string,
    action: "approve" | "reject" | "request_changes",
    notes?: string,
    adminUserId?: string,
    options?: { targetStep?: string },
  ) {
    const existing = await prisma.provider.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!existing) throw new Error("Provider not found");

    const safeNotes = notes ? sanitizeUserInput(notes, 2000) : undefined;

    if (action === "request_changes") {
      const { targetStep } = await partnerOnboardingService.requestProviderChanges(
        id,
        adminUserId ?? "system",
        safeNotes ?? "",
        options?.targetStep,
      );

      const p = await prisma.provider.findUniqueOrThrow({ where: { id } });

      const partnerEmail = await userPiiService.resolveEmail(existing.user, {
        actorId: adminUserId,
        authorized: true,
      });
      if (partnerEmail) {
        emailDeliveryService.sendPartnerChangesRequested(
          partnerEmail,
          existing.user.firstName,
          onboardingStepLabel(targetStep),
          safeNotes,
        );
      }

      const lead = await prisma.partnerLead.findFirst({ where: { providerId: id } });
      if (lead && adminUserId) {
        await partnerLeadService
          .syncFromProviderDecision(lead.id, "request_changes", adminUserId, safeNotes, {
            targetStep,
          })
          .catch(() => undefined);
      }

      await partnerAcquisitionEvents.emitApplicationChangesRequested(
        id,
        adminUserId ?? "system",
        targetStep,
        safeNotes,
      );

      return p;
    }

    if (action === "approve" && !existing.isApproved) {
      await partnerOnboardingService.assertReadyForActivation(id);
    }

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
      await refreshTokenService.revokeAllUserTokens(existing.userId, "SUSPICIOUS_ACTIVITY", "SYSTEM");
    }

    const partnerEmail = await userPiiService.resolveEmail(existing.user, {
      actorId: adminUserId,
      authorized: true,
    });
    if (partnerEmail) {
      if (action === "approve") {
        emailDeliveryService.sendPartnerApproval(partnerEmail, existing.user.firstName, safeNotes);
      } else {
        emailDeliveryService.sendPartnerRejection(partnerEmail, existing.user.firstName, safeNotes);
      }
    }

    const lead = await prisma.partnerLead.findFirst({ where: { providerId: id } });
    if (lead && adminUserId) {
      await partnerLeadService.syncFromProviderDecision(lead.id, action, adminUserId, safeNotes).catch(() => undefined);
    }

    if (action === "approve") {
      await partnerAcquisitionEvents.emitApplicationApproved(id, adminUserId ?? "system");
      await partnerAcquisitionEvents.emitPartnerActivated(id, lead?.id);
      const { partnerLifecycleService } = await import("./partner-lifecycle.service");
      await partnerLifecycleService.onApplicationApproved(id, adminUserId).catch(() => undefined);
    } else {
      await partnerAcquisitionEvents.emitApplicationRejected(id, adminUserId ?? "system", safeNotes);
    }

    return p;
  }

  /**
   * Full partner command-center detail — everything about ONE provider composed
   * into a single payload: profile, KYC + documents, performance metrics,
   * accept/reject history, recent bookings, earnings/payouts, live location.
   * PII (email/phone) and KYC numbers are masked via the same services the list uses.
   */
  async getProviderDetail(id: string) {
    const p = await prisma.provider.findUnique({
      where: { id },
      include: {
        user: true,
        currentLocation: true,
        documents: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!p) return null;

    const masked = await userPiiService.withMaskedPii(p.user);
    const kyc = maskProviderSensitive({
      panNumber: p.panNumber,
      aadharNumber: p.aadharNumber,
      bankAccountNumber: p.bankAccountNumber,
    });

    // Recent bookings (accepted / completed / cancelled / in-progress).
    const bookings = await prisma.booking.findMany({
      where: { providerId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        bookingNumber: true,
        status: true,
        finalAmount: true,
        scheduledDate: true,
        completedAt: true,
        createdAt: true,
        service: { select: { name: true } },
      },
    });

    // Accept / reject / timeout history from the dispatch engine.
    const attempts = await prisma.assignmentAttempt.findMany({
      where: { providerId: id },
      orderBy: { dispatchedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        dispatchedAt: true,
        respondedAt: true,
        responseMs: true,
        job: { select: { booking: { select: { bookingNumber: true, service: { select: { name: true } } } } } },
      },
    });

    // Pending payouts (money owed but not yet paid out).
    const pending = await prisma.withdrawal
      .aggregate({
        where: { providerId: id, status: { in: ["REQUESTED", "PROCESSING", "APPROVED"] } },
        _sum: { amount: true },
        _count: true,
      })
      .catch(() => ({ _sum: { amount: null }, _count: 0 }));

    return {
      id: p.id,
      userId: p.userId,
      profile: {
        name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        email: masked.email,
        phone: masked.phoneNumber,
        businessName: p.businessName,
        bio: p.bio,
        profileImage: p.profileImage,
        serviceCategories: p.serviceCategories,
        serviceRegions: p.serviceRegions,
        city: p.city,
        experienceYears: p.experienceYears,
        certifications: p.certifications,
        badges: p.badges,
        registeredAt: p.registeredAt?.toISOString() ?? p.createdAt.toISOString(),
        memberSince: p.createdAt.toISOString(),
      },
      status: {
        isOnline: p.isOnline,
        onlineSince: p.onlineSince?.toISOString() ?? null,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        currentStatus: p.currentStatus,
        lifecycleState: p.lifecycleState,
        careerLevel: p.careerLevel,
        isActive: p.isActive,
        isBanned: p.isBanned,
        bannedReason: p.bannedReason,
        workingHours: p.workingHoursStart != null && p.workingHoursEnd != null
          ? { start: p.workingHoursStart, end: p.workingHoursEnd, days: p.workingDays }
          : null,
      },
      verification: {
        isApproved: p.isApproved,
        isVerified: p.isVerified,
        registrationStatus: p.registrationStatus,
        verificationDate: p.verificationDate?.toISOString() ?? null,
        verificationNotes: p.verificationNotes,
        approvalNotes: p.approvalNotes,
        rejectionReason: p.rejectionReason,
        backgroundCheckStatus: p.backgroundCheckStatus,
        backgroundCheckDate: p.backgroundCheckDate?.toISOString() ?? null,
        kyc,
        documents: p.documents.map((d) => ({
          id: d.id,
          type: d.documentType,
          name: d.documentName,
          isVerified: d.isVerified,
          uploadStatus: d.uploadStatus,
          expiryDate: d.expiryDate?.toISOString() ?? null,
          verifiedAt: d.verifiedAt?.toISOString() ?? null,
        })),
      },
      metrics: {
        rating: p.rating,
        totalReviews: p.totalReviews,
        ratingBreakdown: p.ratingBreakdown,
        totalBookings: p.totalBookings,
        completedBookings: p.completedBookings,
        cancelledBookings: p.cancelledBookings,
        rejectedBookings: p.rejectedBookings,
        completionRate: p.completionRate,
        acceptanceRate: p.acceptanceRate,
        responseRate: p.responseRate,
        cancellationRate: p.cancellationRate,
        onTimeRate: p.onTimeRate,
        avgResponseTime: p.avgResponseTime,
        avgCompletionTime: p.avgCompletionTime,
      },
      earnings: {
        totalEarnings: p.totalEarnings,
        thisMonthEarnings: p.thisMonthEarnings,
        thisWeekEarnings: p.thisWeekEarnings,
        walletBalance: p.walletBalance,
        commissionRate: p.commissionRate,
        pendingPayoutAmount: pending._sum.amount ?? 0,
        pendingPayoutCount: pending._count ?? 0,
        bank: {
          holder: p.bankAccountHolder,
          bankName: p.bankName,
          accountNumberMasked: kyc.bankAccountNumber,
          ifsc: p.bankIfscCode,
          upiId: p.upiId,
          preference: p.paymentMethodPreference,
        },
      },
      location: p.currentLocation
        ? {
            latitude: p.currentLocation.latitude,
            longitude: p.currentLocation.longitude,
            updatedAt: p.currentLocation.lastUpdated?.toISOString() ?? null,
          }
        : null,
      recentBookings: bookings.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        status: b.status,
        serviceName: b.service?.name ?? null,
        amount: b.finalAmount,
        scheduledDate: b.scheduledDate?.toISOString() ?? null,
        completedAt: b.completedAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      dispatchHistory: attempts.map((a) => ({
        id: a.id,
        status: a.status,
        dispatchedAt: a.dispatchedAt?.toISOString() ?? null,
        respondedAt: a.respondedAt?.toISOString() ?? null,
        responseMs: a.responseMs,
        bookingNumber: a.job?.booking?.bookingNumber ?? null,
        serviceName: a.job?.booking?.service?.name ?? null,
      })),
    };
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
      await refreshTokenService.revokeAllUserTokens(id, "SUSPICIOUS_ACTIVITY", "SYSTEM");
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
        where: { createdAt: { gte: start, lte: end }, ...CREDITED_EARNING_WHERE },
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
      where: { createdAt: { gte: start, lte: end }, bookingId: { not: null }, ...CREDITED_EARNING_WHERE },
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

class AdminReviewService {
  /** All platform reviews for the admin moderation console. Filters: status
   *  (all|public|hidden|flagged), rating, free-text search on the review body. */
  async list(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (query.status === "public") where.isPublic = true;
    else if (query.status === "hidden") where.isPublic = false;
    else if (query.status === "flagged") where.isFlagged = true;
    if (query.rating && query.rating !== "all") where.stars = Number(query.rating);
    if (query.search?.trim()) {
      where.reviewText = { contains: query.search.trim(), mode: "insensitive" };
    }

    const [rows, total, agg] = await Promise.all([
      prisma.rating.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          provider: { select: { businessName: true, user: { select: { firstName: true, lastName: true } } } },
          booking: { select: { bookingNumber: true, service: { select: { name: true } } } },
        },
      }),
      prisma.rating.count({ where }),
      prisma.rating.aggregate({ _avg: { stars: true }, _count: true }),
    ]);

    return {
      reviews: rows.map((r) => ({
        id: r.id,
        customer: `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || "Customer",
        customerEmail: r.user.email,
        provider: r.provider?.businessName
          || `${r.provider?.user?.firstName ?? ""} ${r.provider?.user?.lastName ?? ""}`.trim()
          || "—",
        service: r.booking?.service?.name ?? "—",
        bookingNumber: r.booking?.bookingNumber ?? "—",
        rating: r.stars,
        reviewText: r.reviewText,
        providerResponse: r.providerResponse,
        isPublic: r.isPublic,
        isFlagged: r.isFlagged,
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
      stats: { averageRating: agg._avg.stars != null ? round2(agg._avg.stars) : null, totalReviews: agg._count },
    };
  }

  /** Moderate a review: show/hide (isPublic) and/or flag/unflag (isFlagged). */
  async moderate(id: string, patch: { isPublic?: boolean; isFlagged?: boolean }) {
    const existing = await prisma.rating.findUnique({ where: { id } });
    if (!existing) return null;
    return prisma.rating.update({
      where: { id },
      data: {
        ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
        ...(patch.isFlagged !== undefined ? { isFlagged: patch.isFlagged } : {}),
      },
      select: { id: true, isPublic: true, isFlagged: true },
    });
  }

  async remove(id: string) {
    const existing = await prisma.rating.findUnique({ where: { id }, select: { providerId: true } });
    if (!existing) return null;
    await prisma.rating.delete({ where: { id } });
    return { id, providerId: existing.providerId };
  }
}

export const adminReviewService = new AdminReviewService();
