import { BookingStatus, TrackingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { nextBookingNumber } from "../lib/booking-number";
import { bookingStatusApi, paymentStatusApi } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { notificationService } from "./notification.service";
import { bookingValidationService } from "./booking-validation.service";
import { earningsService } from "./earnings.service";
import { referralService } from "./referral.service";
import { hcoinService } from "./hcoin.service";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { bookingPriorityService } from "./booking-priority.service";
import { assignmentEngine } from "./assignment-engine.service";
import { campaignService } from "./campaign.service";
import { membershipCouponService } from "./membership-coupon.service";
import { cashbackService } from "./cashback.service";
import { PLATFORM_VISIT_FEE_INR } from "../lib/membership-tiers";
import { sanitizeUserInput } from "../utils/sanitizer";
import { resolveBookingCancelActor } from "../lib/booking-cancel-auth";
import { paymentService } from "./payment.service";
import { financialLedgerService } from "./financial-ledger.service";
import { earningsLiveService } from "./earnings-live.service";
import { fraudContextForUser } from "../lib/fraud-context";

const TAX_RATE = 0.1;

export class BookingService {
  async create(
    userId: string,
    body: {
      serviceId: string;
      providerId?: string;
      scheduledDate: string;
      addressId: string;
      description?: string;
      paymentMethod?: string;
      couponCode?: string;
    },
  ) {
    const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
    if (!service) return { error: "VALIDATION_ERROR" as const };

    // Resolve the buyer's membership entitlements ONCE (server-side authority).
    const entitlements = await entitlementService.resolve(userId);

    // Phase 6 — premium-only gate. Backend-enforced; the client cannot bypass it.
    if (service.premiumOnly && !entitlements.premiumAccess) {
      return { error: "UPGRADE_REQUIRED" as const };
    }

    const scheduled = new Date(body.scheduledDate);
    const baseAmount = service.basePrice;
    // Phase 5 — membership discount, computed from the DB plan (tamper-proof).
    const discountAllowed =
      entitlements.discountPct > 0
        ? await entitlementService.canUseBenefit(userId, BENEFIT.DISCOUNT_PCT)
        : false;
    const membershipDiscount = discountAllowed
      ? Math.round((baseAmount * entitlements.discountPct) / 100)
      : 0;
    const freeDeliveryDiscount =
      entitlements.freeDelivery && (await entitlementService.canUseBenefit(userId, BENEFIT.FREE_DELIVERY))
        ? PLATFORM_VISIT_FEE_INR
        : 0;

    // Phase D — premium campaign/coupon discount (server-validated).
    let campaignDiscount = 0;
    let campaignId: string | undefined;
    let membershipCouponId: string | undefined;
    let couponCode: string | undefined;
    if (body.couponCode?.trim()) {
      const afterMembership = Math.max(0, baseAmount - membershipDiscount);
      const membershipCoupon = await membershipCouponService.validateForUser(
        userId,
        body.couponCode,
        afterMembership,
        { serviceCategory: service.category },
      );
      if (membershipCoupon.ok) {
        campaignDiscount = membershipCoupon.discount;
        couponCode = membershipCoupon.code;
        membershipCouponId = membershipCoupon.couponId;
      } else {
        const campaignResult = await campaignService.validateForUser(userId, body.couponCode, afterMembership);
        if (!campaignResult.ok) {
          const err = membershipCoupon.error !== "INVALID_CODE" ? membershipCoupon.error : campaignResult.error;
          return { error: err as string };
        }
        campaignDiscount = campaignResult.discount;
        campaignId = campaignResult.campaignId;
        couponCode = campaignResult.code;
      }
    }

    const discount = membershipDiscount + campaignDiscount + freeDeliveryDiscount;
    const discountedBase = Math.max(0, baseAmount - discount);
    const taxes = Math.round(discountedBase * TAX_RATE);
    const finalAmount = discountedBase + taxes;
    const queuePriority = bookingPriorityService.resolvePriority(userId, entitlements);
    const priorityScore = bookingPriorityService.resolvePriorityScore(entitlements);

    const validation = await bookingValidationService.validateBooking({
      userId,
      providerId: body.providerId ?? null,
      serviceId: body.serviceId,
      addressId: body.addressId,
      scheduledDate: scheduled,
      amount: finalAmount,
    });
    if (!validation.isValid) {
      const codes = new Set(validation.errors.map((e) => e.code));
      if (codes.has("OVERLAPPING_BOOKING")) return { error: "OVERLAPPING_BOOKING" as const };
      if (codes.has("PROVIDER_UNAVAILABLE") || codes.has("PROVIDER_INVALID")) {
        return { error: "PROVIDER_UNAVAILABLE" as const };
      }
      return { error: "VALIDATION_ERROR" as const };
    }

    const bookingNumber = await nextBookingNumber();
    const revenueBefore = baseAmount - membershipDiscount + taxes;

    const booking = await prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          bookingNumber,
          userId,
          providerId: body.providerId,
          serviceId: body.serviceId,
          addressId: body.addressId,
          scheduledDate: scheduled,
          description: body.description
            ? sanitizeUserInput(body.description, 1000)
            : undefined,
          baseAmount,
          discount,
          campaignDiscount,
          campaignId,
          couponCode,
          queuePriority,
          priorityScore,
          premiumMatched: entitlements.hasMembership,
          taxes,
          finalAmount,
          totalAmount: finalAmount,
          paymentMethod: body.paymentMethod,
          estimatedDuration: service.estimatedDuration,
        },
        include: {
          provider: { include: { user: true } },
          service: true,
        },
      });

      if (membershipCouponId && campaignDiscount > 0) {
        await membershipCouponService.consumeInTransaction(
          tx,
          membershipCouponId,
          userId,
          created.id,
          campaignDiscount,
          revenueBefore,
          finalAmount,
        );
      } else if (campaignId && campaignDiscount > 0) {
        await tx.couponUsage.create({
          data: {
            campaignId,
            userId,
            bookingId: created.id,
            discountApplied: campaignDiscount,
            revenueBefore,
            revenueAfter: finalAmount,
          },
        });
        await tx.campaign.update({
          where: { id: campaignId },
          data: { redemptionCount: { increment: 1 } },
        });
      }

      return created;
    });

    // Ledger the membership discount for quota/analytics (best-effort).
    if (membershipDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.DISCOUNT_PCT, { amount: membershipDiscount });
    }
    if (freeDeliveryDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.FREE_DELIVERY, { amount: freeDeliveryDiscount });
    }

    // Phase B — priority queue enqueue (server-side).
    await bookingPriorityService.enqueue(booking.id, queuePriority, priorityScore);

    // Phase 1 — assignment dispatch job (auto provider matching).
    if (!body.providerId) {
      await assignmentEngine.createJob(booking.id);
    }

    return { booking: this.summary(booking) };
  }

  private summary(b: {
    id: string;
    bookingNumber: string;
    status: BookingStatus;
    baseAmount: number;
    finalAmount: number;
    provider?: { id: string; rating: number; profileImage: string | null; user: { firstName: string; lastName: string } } | null;
    service: { name: string };
  }) {
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: bookingStatusApi(b.status),
      amount: b.baseAmount,
      finalAmount: b.finalAmount,
      provider: b.provider
        ? {
            id: b.provider.id,
            name: `${b.provider.user.firstName} ${b.provider.user.lastName}`,
            rating: b.provider.rating,
            profileImage: b.provider.profileImage,
          }
        : undefined,
      service: { name: b.service.name },
    };
  }

  async getForUser(userId: string, bookingId: string) {
    const b = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        user: true,
        provider: { include: { user: true } },
        service: true,
        address: true,
        rating: true,
        tracking: true,
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      user: { id: b.user.id, firstName: b.user.firstName, profileImage: b.user.profileImage },
      provider: b.provider
        ? {
            id: b.provider.id,
            name: `${b.provider.user.firstName} ${b.provider.user.lastName}`,
            rating: b.provider.rating,
            profileImage: b.provider.profileImage,
            phoneNumber: b.provider.user.phoneNumber,
          }
        : null,
      service: { id: b.service.id, name: b.service.name, icon: b.service.icon },
      address: { fullAddress: b.address.fullAddress },
      status: bookingStatusApi(b.status),
      scheduledDate: b.scheduledDate,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      baseAmount: b.baseAmount,
      discount: b.discount,
      taxes: b.taxes,
      finalAmount: b.finalAmount,
      tipAmount: b.tipAmount,
      paymentStatus: paymentStatusApi(b.paymentStatus),
      paymentMethod: b.paymentMethod,
      description: b.description,
      rating: b.rating
        ? {
            rating: b.rating.stars,
            reviewText: b.rating.reviewText,
            createdAt: b.rating.createdAt,
          }
        : null,
      tracking: b.tracking
        ? {
            status: b.tracking.status.toLowerCase(),
            totalDistance: b.tracking.totalDistance,
            actualArrivalTime: b.tracking.actualArrivalTime,
          }
        : null,
    };
  }

  async getById(bookingId: string, userId?: string, providerId?: string) {
    const b = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...(userId ? { userId } : {}),
        ...(providerId ? { providerId } : {}),
      },
      include: {
        provider: { include: { user: true } },
        service: true,
        address: true,
        tracking: true,
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: bookingStatusApi(b.status),
      provider: b.provider
        ? {
            id: b.provider.id,
            name: `${b.provider.user.firstName} ${b.provider.user.lastName}`,
            rating: b.provider.rating,
            phoneNumber: b.provider.user.phoneNumber,
          }
        : null,
      service: { name: b.service.name, icon: b.service.icon },
      address: { fullAddress: b.address.fullAddress },
      scheduledDate: b.scheduledDate,
      startedAt: b.startedAt,
      eta: b.eta,
      finalAmount: b.finalAmount,
      paymentStatus: paymentStatusApi(b.paymentStatus),
      tracking: b.tracking
        ? {
            status: b.tracking.status.toLowerCase(),
            distance: b.tracking.totalDistance,
            eta: b.eta,
          }
        : null,
    };
  }

  async listForUser(
    userId: string,
    query: { status?: string; page?: number; limit?: number; sortBy?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);
    const where: { userId: string; status?: { in: BookingStatus[] } } = { userId };
    if (query.status && query.status !== "all") {
      const map: Record<string, BookingStatus[]> = {
        pending: ["PENDING"],
        accepted: ["ACCEPTED", "ASSIGNED", "EN_ROUTE"],
        completed: ["COMPLETED"],
        cancelled: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED"],
      };
      where.status = { in: map[query.status] ?? [query.status.toUpperCase() as BookingStatus] };
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
          service: true,
          provider: { include: { user: true } },
          rating: true,
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        serviceId: b.serviceId,
        serviceName: b.service.name,
        serviceIcon: b.service.icon,
        providerId: b.providerId,
        providerName: b.provider ? `${b.provider.user.firstName} ${b.provider.user.lastName}` : null,
        providerImage: b.provider?.profileImage,
        providerRating: b.provider?.rating,
        status: bookingStatusApi(b.status),
        scheduledDate: b.scheduledDate,
        completedAt: b.completedAt,
        amount: b.baseAmount,
        finalAmount: b.finalAmount,
        paymentStatus: paymentStatusApi(b.paymentStatus),
        ratingGiven: Boolean(b.rating),
      })),
      total,
      page,
      limit,
    };
  }

  async update(userId: string, id: string, patch: { scheduledDate?: string; description?: string }) {
    const b = await prisma.booking.findFirst({ where: { id, userId } });
    if (!b) return { error: "NOT_FOUND" as const };
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"].includes(b.status)) {
      return { error: "INVALID_STATUS" as const };
    }
    await prisma.booking.update({
      where: { id },
      data: {
        scheduledDate: patch.scheduledDate ? new Date(patch.scheduledDate) : undefined,
        description: patch.description
          ? sanitizeUserInput(patch.description, 1000)
          : undefined,
      },
    });
    return { ok: true as const };
  }

  async accept(providerId: string, id: string, eta?: number) {
    const existing = await prisma.booking.findFirst({ where: { id, providerId, status: "PENDING" } });
    if (!existing) return null;
    const acceptedAt = new Date();
    const waitTimeMs = existing.queuedAt ? acceptedAt.getTime() - existing.queuedAt.getTime() : null;
    await prisma.booking.update({
      where: { id },
      data: { status: "ACCEPTED", acceptedAt, assignedAt: acceptedAt, waitTimeMs, eta },
    });
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { provider: { include: { user: true } }, service: true, user: true },
    });
    if (booking?.userId) {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "booking_accepted",
        title: "Booking Accepted",
        message: `${booking.provider?.user.firstName} has accepted your ${booking.service.name} booking`,
        referenceId: booking.id,
        referenceType: "booking",
      });
    }
    return booking;
  }

  async reject(providerId: string, id: string, reason: string) {
    await prisma.booking.updateMany({
      where: { id, providerId },
      data: { status: "REJECTED", cancellationReason: reason, cancelledAt: new Date() },
    });
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (booking?.userId) {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "booking_rejected",
        title: "Booking Rejected",
        message: reason,
        referenceId: id,
      });
    }
    return true;
  }

  async start(providerId: string, id: string, lat: number, lng: number) {
    const updated = await prisma.booking.updateMany({
      where: { id, providerId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    if (updated.count === 0) throw new Error("FORBIDDEN");
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!booking) throw new Error("FORBIDDEN");
    await prisma.tracking.upsert({
      where: { bookingId: id },
      create: {
        bookingId: id,
        status: TrackingStatus.IN_PROGRESS,
        startLatitude: lat,
        startLongitude: lng,
        actualStartTime: new Date(),
      },
      update: {
        status: TrackingStatus.IN_PROGRESS,
        startLatitude: lat,
        startLongitude: lng,
        actualStartTime: new Date(),
      },
    });
    if (booking.userId) {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "service_started",
        title: "Service Started",
        message: "Your service provider has started the job",
        referenceId: id,
      });
    }
    return booking;
  }

  async complete(
    providerId: string,
    id: string,
    _lat: number,
    _lng: number,
    notes?: string,
  ) {
    const existing = await prisma.booking.findFirst({ where: { id, providerId } });
    if (!existing) return null;
    const duration = existing.startedAt
      ? Math.round((Date.now() - existing.startedAt.getTime()) / 60000)
      : existing.estimatedDuration;
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        actualDuration: duration,
        providerNotes: notes,
      },
    });
    await prisma.tracking.updateMany({
      where: { bookingId: id },
      data: { status: TrackingStatus.COMPLETED, actualEndTime: new Date(), totalDuration: duration },
    });
    if (existing.providerId) {
      const existingEarning = await prisma.earning.findUnique({ where: { bookingId: id } });
      if (!existingEarning) {
        const breakdown = await earningsService.calculateBookingEarning(id);
        await prisma.provider.update({
          where: { id: existing.providerId },
          data: {
            walletBalance: { increment: breakdown.netEarning },
            totalEarnings: { increment: breakdown.netEarning },
            completedBookings: { increment: 1 },
          },
        });
        await prisma.earning.create({
          data: {
            providerId: existing.providerId,
            bookingId: id,
            grossAmount: breakdown.bookingAmount,
            commission: breakdown.commission,
            netEarning: breakdown.netEarning,
          },
        });
        void financialLedgerService
          .recordProviderEarning(id, breakdown.bookingAmount, breakdown.commission, breakdown.netEarning)
          .catch(() => undefined);

        const provider = await prisma.provider.findUnique({
          where: { id: existing.providerId },
          select: { userId: true },
        });
        if (provider?.userId) {
          void earningsLiveService.broadcastEarningsUpdate(provider.userId).catch(() => undefined);
        }
      }
    }
    if (booking.userId) {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "booking_completed",
        title: "Service Completed",
        message: "Please rate your experience",
        referenceId: id,
        priority: "high",
      });
      // Referral engine: a completed booking may qualify the customer's referrer.
      void fraudContextForUser(booking.userId)
        .then((ctx) => referralService.onBookingCompleted(booking.userId, id, ctx))
        .catch(() => {});
      // Loyalty: reward H-Coins for completing a booking.
      void hcoinService.earn(booking.userId, "BOOKING_COMPLETED", id).catch(() => {});
      void cashbackService.creditOnBookingComplete(booking.userId, id).catch(() => {});
    }
    return { booking, totalDuration: duration };
  }

  async cancel(
    actor: { userId: string; providerId?: string },
    id: string,
    reason: string,
  ) {
    const b = await prisma.booking.findUnique({ where: { id } });
    if (!b) return { error: "NOT_FOUND" as const };

    const actorResolution = resolveBookingCancelActor(actor.userId, actor.providerId, b);
    if (!actorResolution.allowed) return { error: "NOT_FOUND" as const };

    if (b.status === "COMPLETED") return { error: "INVALID_STATUS" as const };

    const { cancelledBy } = actorResolution;
    const status =
      cancelledBy === "user" ? BookingStatus.CANCELLED_BY_USER : BookingStatus.CANCELLED_BY_PROVIDER;

    let refundAmount = 0;
    let refundStatus: string | null = null;

    if (b.paymentStatus === "SUCCESS") {
      const refundResult = await paymentService.refundForBookingCancellation(id, reason, actor.userId);
      if ("error" in refundResult) return { error: "REFUND_FAILED" as const };
      refundAmount = refundResult.amount;
      refundStatus = refundResult.status;
    }

    await prisma.booking.update({
      where: { id },
      data: {
        status,
        cancelledAt: new Date(),
        cancellationReason: reason,
        cancelledBy,
        refundAmount,
        refundStatus,
      },
    });

    return { status: bookingStatusApi(status), refundAmount };
  }

  async upcoming(userId: string) {
    const rows = await prisma.booking.findMany({
      where: {
        userId,
        scheduledDate: { gte: new Date() },
        status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE"] },
      },
      orderBy: { scheduledDate: "asc" },
      take: 20,
      include: { service: true, provider: { include: { user: true } } },
    });
    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        status: bookingStatusApi(b.status),
        service: b.service.name,
        provider: b.provider ? `${b.provider.user.firstName} ${b.provider.user.lastName}` : "TBD",
        scheduledDate: b.scheduledDate,
        timeUntilBooking: formatTimeUntil(b.scheduledDate),
      })),
      total: rows.length,
    };
  }
}

function formatTimeUntil(date: Date): string {
  const diff = date.getTime() - Date.now();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 0) return `${days} days`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours > 0) return `${hours} hours`;
  return "soon";
}

export const bookingService = new BookingService();
