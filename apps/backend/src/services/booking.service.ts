import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  Prisma,
  TrackingStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { nextBookingNumber } from "../lib/booking-number";
import { bookingStatusApi, paymentStatusApi } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { notificationService } from "./notification.service";
import { emailDeliveryService } from "./email-delivery.service";
import { bookingValidationService } from "./booking-validation.service";
import { earningsService } from "./earnings.service";
import { referralService } from "./referral.service";
import { hcoinService } from "./hcoin.service";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { bookingPriorityService } from "./booking-priority.service";
import { addressPiiService } from "./address-pii.service";
import { assignmentEngine } from "./assignment-engine.service";
import { incCounter } from "../lib/metrics";
import { membershipCouponService } from "./membership-coupon.service";
import { cashbackService } from "./cashback.service";
import { bookingPricingService, BOOKING_ADDONS } from "./booking-pricing.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { toWaitTimeMsBigInt } from "../lib/wait-time-ms";

/** Partners may accept shortly after a dispatch timeout while the UI refreshes. */
const ASSIGN_ACCEPT_GRACE_MS = Number(process.env.ASSIGNMENT_ACCEPT_GRACE_MS || 5 * 60 * 1000);
import { resolveBookingCancelActor } from "../lib/booking-cancel-auth";
import { bookingRefundService } from "./booking-refund.service";
import { cancellationPolicyService } from "./cancellation-policy.service";
import { financialLedgerService } from "./financial-ledger.service";
import { earningsLiveService } from "./earnings-live.service";
import { userPiiService } from "./user-pii.service";
import { trackingService } from "./tracking.service";
import { logger } from "../lib/logger";
import {
  recordEtaJobStartFallback,
  recordEtaLifecycleTransition,
} from "../lib/eta-metrics";
import { distanceKm as distanceBetweenKm } from "../lib/geo";
import { fraudContextForUser } from "../lib/fraud-context";
import { withTxRetry } from "../lib/db-retry";
import { withRescheduleGate } from "../lib/reschedule-gate";
import { isPrismaConnectionExhausted, isRetryablePrismaError } from "../lib/prisma-errors";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildBookingAssignedEvent,
  buildBookingCancelledEvent,
  buildBookingCompletedEvent,
  buildBookingCreatedEvent,
  buildBookingStartedEvent,
} from "../events/catalog/booking.events";

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
      packagePrice?: number;
      addonIds?: string[];
    },
  ) {
    const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
    if (!service) return { error: "VALIDATION_ERROR" as const };

    const scheduled = new Date(body.scheduledDate);

    // Resolve service-location coords so weather-based dynamic surge can apply.
    const bookingAddress = await prisma.address
      .findFirst({ where: { id: body.addressId, userId }, select: { latitude: true, longitude: true, city: true } })
      .catch(() => null);

    const priced = await bookingPricingService.quote({
      userId,
      serviceId: body.serviceId,
      couponCode: body.couponCode,
      packagePrice: body.packagePrice,
      addonIds: body.addonIds,
      lat: bookingAddress?.latitude,
      lng: bookingAddress?.longitude,
    });
    if (!priced.ok) return { error: priced.error as typeof priced.error };

    const {
      campaignDiscount,
      membershipDiscount,
      freeDeliveryDiscount,
      weatherSurgeAmount,
      taxes,
      finalAmount,
      couponCode,
      campaignId,
      membershipCouponId,
    } = priced.breakdown;

    // Canonical money invariant: base + taxes − discount − campaign_discount + tip == total.
    // (1) Stored base must INCLUDE the weather-surge amount — surge has no column of
    //     its own, and an un-surged base makes the invariant drift by exactly the surge.
    // (2) Stored `discount` must EXCLUDE campaignDiscount — the invariant subtracts the
    //     campaign_discount column separately, so folding it in double-counts coupons.
    const baseAmount = priced.breakdown.baseAmount + weatherSurgeAmount;
    const discount = membershipDiscount + freeDeliveryDiscount;

    if (body.couponCode?.trim() && priced.breakdown.couponError) {
      return { error: priced.breakdown.couponError as string };
    }

    // Catalog snapshot of chosen add-ons — priced server-side above; stored on
    // the booking so history / partner / admin all see WHAT was bought, not
    // just a lump-sum baseAmount.
    const addonsSnapshot = [...new Set(body.addonIds ?? [])]
      .map((id) => BOOKING_ADDONS.find((a) => a.id === id))
      .filter((a): a is (typeof BOOKING_ADDONS)[number] => Boolean(a))
      .map((a) => ({ id: a.id, name: a.name, price: a.price }));

    const entitlements = await entitlementService.resolve(userId);
    const queuePriority = bookingPriorityService.resolvePriority(userId, entitlements);
    const priorityScore = bookingPriorityService.resolvePriorityScore(entitlements);
    const revenueBefore = baseAmount - priced.breakdown.membershipDiscount + taxes;

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

    const MAX_BOOKING_TX_RETRIES = 8;
    let booking;
    try {
      for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
        const bookingNumber = await nextBookingNumber();
        try {
          booking = await prisma.$transaction(
        async (tx) => {
          const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
            userId,
            providerId: body.providerId ?? null,
            scheduledDate: scheduled,
          });
          if (conflict) {
            throw new Error(conflict.code);
          }

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
          addons: addonsSnapshot.length ? addonsSnapshot : undefined,
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

          if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
            await emitInTransaction(
              tx,
              buildBookingCreatedEvent({
                bookingId: created.id,
                bookingNumber: created.bookingNumber,
                userId: created.userId,
                serviceId: created.serviceId,
                serviceCategory: service.category,
                city: bookingAddress?.city ?? "unknown",
                providerId: created.providerId,
                status: created.status,
                finalAmount: created.finalAmount,
                finalAmountPaise: created.finalAmountPaise,
                paymentMethod: created.paymentMethod,
                scheduledAt: created.scheduledDate,
                actorType: "customer",
                actorId: userId,
              }),
            );
          }

          return created;
        },
        { isolationLevel: "Serializable" },
          );
          break;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
              await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
              continue;
            }
          }
          if (this.isBookingScheduleConflict(error)) {
            throw new Error("PROVIDER_UNAVAILABLE");
          }
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "OVERLAPPING_BOOKING") {
          return { error: "OVERLAPPING_BOOKING" as const };
        }
        if (error.message === "PROVIDER_UNAVAILABLE") {
          return { error: "PROVIDER_UNAVAILABLE" as const };
        }
      }
      if (this.isBookingScheduleConflict(error)) {
        return { error: "PROVIDER_UNAVAILABLE" as const };
      }
      throw error;
    }

    if (!booking) {
      return { error: "PROVIDER_UNAVAILABLE" as const };
    }

    recordFinancialMetric("booking_created_total", 1);

    // Ledger the membership discount for quota/analytics (best-effort).
    if (membershipDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.DISCOUNT_PCT, { amount: membershipDiscount });
    }
    if (freeDeliveryDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.FREE_DELIVERY, { amount: freeDeliveryDiscount });
    }

    // booking_created_total already recorded above via recordFinancialMetric (no duplicate).

    // Phase B — priority queue enqueue (server-side).
    await bookingPriorityService.enqueue(booking.id, queuePriority, priorityScore);

    // Phase 1 — assignment dispatch job (auto provider matching).
    // Job creation is awaited (must exist before we return), but the provider
    // fan-out itself must not block the customer's 201 — the assignment cron
    // re-dispatches PENDING jobs, so a failed inline dispatch self-heals.
    if (!body.providerId) {
      await assignmentEngine.createJob(booking.id);
      void assignmentEngine.dispatchBookingNow(booking.id).catch(() => undefined);
    }

    // Booking confirmation email (non-blocking)
    void this.notifyBookingConfirmation(booking.id).catch(() => undefined);

    return { booking: this.summary(booking) };
  }

  private async notifyBookingConfirmation(bookingId: string) {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, service: true },
    });
    if (!b?.userId) return;
    const email = await userPiiService.resolveEmail(b.user, { actorId: b.userId, authorized: true });
    if (!email) return;
    const date = b.scheduledDate ? new Date(b.scheduledDate) : new Date();
    emailDeliveryService.sendBookingConfirmation(
      email,
      {
        id: b.id,
        serviceTitle: b.service.name,
        dateLabel: date.toLocaleString("en-IN"),
        total: b.finalAmount,
      },
      b.user.firstName,
    );
  }

  private summary(b: {
    id: string;
    bookingNumber: string;
    status: BookingStatus;
    scheduledDate: Date;
    baseAmount: number;
    finalAmount: number;
    addons?: unknown;
    provider?: { id: string; rating: number; profileImage: string | null; user: { firstName: string; lastName: string } } | null;
    service: { name: string };
  }) {
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: bookingStatusApi(b.status),
      // Clients render the confirmation from this payload; without the slot they
      // fall back to "now" and tell the customer their service is today.
      scheduledDate: b.scheduledDate.toISOString(),
      amount: b.baseAmount,
      finalAmount: b.finalAmount,
      addons: b.addons ?? undefined,
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
      address: await addressPiiService.viewForFulfilment(b.address),
      status: bookingStatusApi(b.status),
      scheduledDate: b.scheduledDate,
      // Lifecycle anchors — the partner UI needs these to decide whether to offer
      // "On my way" or "I've arrived". Arrival does not change booking status, so
      // status alone cannot distinguish the two states.
      enRouteAt: b.enRouteAt,
      arrivedAt: b.arrivedAt,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      baseAmount: b.baseAmount,
      discount: b.discount,
      taxes: b.taxes,
      finalAmount: b.finalAmount,
      tipAmount: b.tipAmount,
      addons: b.addons ?? undefined,
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

  async getBookingAccess(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: { userId: true, providerId: true },
    });
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
      address: await addressPiiService.viewForFulfilment(b.address),
      scheduledDate: b.scheduledDate,
      // Lifecycle anchors — the partner UI needs these to decide whether to offer
      // "On my way" or "I've arrived". Arrival does not change booking status, so
      // status alone cannot distinguish the two states.
      enRouteAt: b.enRouteAt,
      arrivedAt: b.arrivedAt,
      startedAt: b.startedAt,
      eta: b.eta,
      finalAmount: b.finalAmount,
      addons: b.addons ?? undefined,
      paymentStatus: paymentStatusApi(b.paymentStatus),
      refundAmount: b.refundAmount,
      refundStatus: b.refundStatus,
      cancelledAt: b.cancelledAt,
      cancellationReason: b.cancellationReason,
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
        addons: b.addons ?? undefined,
        paymentStatus: paymentStatusApi(b.paymentStatus),
        ratingGiven: Boolean(b.rating),
      })),
      total,
      page,
      limit,
    };
  }

  async update(userId: string, id: string, patch: { scheduledDate?: string; description?: string }) {
    if (!patch.scheduledDate) {
      const b = await prisma.booking.findFirst({ where: { id, userId } });
      if (!b) return { error: "NOT_FOUND" as const };
      if (["IN_PROGRESS", "COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"].includes(b.status)) {
        return { error: "INVALID_STATUS" as const };
      }
      if (patch.description !== undefined) {
        await prisma.booking.update({
          where: { id },
          data: { description: sanitizeUserInput(patch.description, 1000) },
        });
      }
      return { ok: true as const };
    }

    const scheduled = new Date(patch.scheduledDate);

    try {
      const notifyProviderId = await this.runRescheduleWithRetry(async () => {
        return withRescheduleGate(() =>
          withTxRetry(async () => {
            let providerId: string | null = null;
            await prisma.$transaction(
              async (tx) => {
                const b = await tx.booking.findFirst({ where: { id, userId } });
                if (!b) throw new Error("NOT_FOUND");
                if (
                  ["IN_PROGRESS", "COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"].includes(
                    b.status,
                  )
                ) {
                  throw new Error("INVALID_STATUS");
                }

                const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
                  userId,
                  providerId: b.providerId,
                  scheduledDate: scheduled,
                  excludeBookingId: id,
                });
                if (conflict) {
                  throw new Error(conflict.code);
                }

                await tx.booking.update({
                  where: { id },
                  data: {
                    scheduledDate: scheduled,
                    description:
                      patch.description !== undefined
                        ? sanitizeUserInput(patch.description, 1000)
                        : undefined,
                  },
                });
                providerId = b.providerId;
              },
              { isolationLevel: "Serializable", maxWait: 15_000, timeout: 20_000 },
            );
            return providerId;
          }),
        );
      });

      if (notifyProviderId) {
        void prisma.provider
          .findUnique({ where: { id: notifyProviderId }, select: { userId: true } })
          .then((provider) => {
            if (!provider?.userId) return;
            return notificationService.createForUser({
              userId: provider.userId,
              type: "SYSTEM",
              title: "Booking rescheduled",
              message: `Customer rescheduled to ${scheduled.toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}`,
              referenceId: id,
              referenceType: "booking",
            });
          })
          .catch(() => undefined);
      }
      return { ok: true as const };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "NOT_FOUND") return { error: "NOT_FOUND" as const };
        if (error.message === "INVALID_STATUS") return { error: "INVALID_STATUS" as const };
        if (error.message === "OVERLAPPING_BOOKING") {
          return { error: "OVERLAPPING_BOOKING" as const };
        }
        if (error.message === "PROVIDER_UNAVAILABLE") {
          return { error: "PROVIDER_UNAVAILABLE" as const };
        }
      }
      if (isPrismaConnectionExhausted(error)) {
        return { error: "POOL_BUSY" as const };
      }
      if (this.isBookingScheduleConflict(error)) {
        return { error: "PROVIDER_UNAVAILABLE" as const };
      }
      if (isRetryablePrismaError(error)) {
        return { error: "POOL_BUSY" as const };
      }
      throw error;
    }
  }

  /** Outer retry for reschedule — re-enters gate after transient pool/serialization exhaustion. */
  private async runRescheduleWithRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isRetryablePrismaError(err)) throw err;
        lastErr = err;
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1) + Math.random() * 75));
      }
    }
    throw lastErr;
  }

  private isRetryableBookingTxError(error: Prisma.PrismaClientKnownRequestError): boolean {
    if (error.code === "P2034" || error.code === "P2010" || error.code === "P2024" || error.code === "P2037") {
      return true;
    }
    if (error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("booking_number")) return true;
    }
    return false;
  }

  private isBookingConflictError(error: Prisma.PrismaClientKnownRequestError): boolean {
    if (error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("booking_number")) return false;
      return true;
    }
    if (error.code === "P2034" || error.code === "P2010") return false;
    return this.isExclusionConstraintMessage(error.message);
  }

  private isBookingScheduleConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return this.isBookingConflictError(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return this.isExclusionConstraintMessage(message);
  }

  private isExclusionConstraintMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("bookings_provider_slot_excl") ||
      lower.includes("bookings_user_slot_excl") ||
      lower.includes("23p01") ||
      lower.includes("exclusion constraint")
    );
  }

  async accept(
    providerId: string,
    id: string,
    eta?: number,
  ): Promise<
    | {
        ok: true;
        booking: NonNullable<Awaited<ReturnType<BookingService["loadBookingForAccept"]>>>;
        newlyAccepted: boolean;
      }
    | {
        ok: false;
        error: "NOT_FOUND" | "INVALID_STATUS" | "PROVIDER_UNAVAILABLE" | "ALREADY_CLAIMED";
      }
  > {
    const pre = await prisma.booking.findUnique({
      where: { id },
      select: { status: true, providerId: true },
    });
    if (!pre) return { ok: false, error: "NOT_FOUND" };

    const claimedByPartner = new Set<BookingStatus>([
      BookingStatus.ACCEPTED,
      BookingStatus.ASSIGNED,
      BookingStatus.EN_ROUTE,
      BookingStatus.IN_PROGRESS,
    ]);

    if (pre.status !== BookingStatus.PENDING) {
      if (claimedByPartner.has(pre.status) && pre.providerId === providerId) {
        const booking = await this.loadBookingForAccept(id);
        if (!booking) return { ok: false, error: "NOT_FOUND" };
        return { ok: true, booking, newlyAccepted: false };
      }
      if (claimedByPartner.has(pre.status) && pre.providerId && pre.providerId !== providerId) {
        return { ok: false, error: "ALREADY_CLAIMED" };
      }
      return { ok: false, error: "INVALID_STATUS" };
    }

    const MAX_BOOKING_TX_RETRIES = 8;

    for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                status: string;
                provider_id: string | null;
                user_id: string;
                queued_at: Date | null;
                scheduled_date: Date;
                service_id: string;
              }>
            >`
              SELECT id, status, provider_id, user_id, queued_at, scheduled_date, service_id
              FROM bookings
              WHERE id = ${id}
              FOR UPDATE
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("NOT_FOUND");
            }
            if (row.status !== "PENDING") {
              if (
                row.provider_id &&
                row.provider_id !== providerId &&
                claimedByPartner.has(row.status as BookingStatus)
              ) {
                throw new Error("ALREADY_CLAIMED");
              }
              throw new Error("INVALID_STATUS");
            }

            const assignedProviderId = await this.resolveAcceptingProvider(
              tx,
              id,
              providerId,
              row.provider_id,
            );

            const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
              userId: row.user_id,
              providerId: assignedProviderId,
              scheduledDate: row.scheduled_date,
              excludeBookingId: id,
            });
            if (conflict) {
              throw new Error(conflict.code);
            }

            const acceptedAt = new Date();
            const waitTimeMs = row.queued_at
              ? toWaitTimeMsBigInt(acceptedAt.getTime() - new Date(row.queued_at).getTime())
              : null;

            await tx.booking.update({
              where: { id },
              data: {
                status: "ACCEPTED",
                acceptedAt,
                assignedAt: acceptedAt,
                waitTimeMs,
                eta,
              },
            });

            if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
              await emitInTransaction(
                tx,
                buildBookingAssignedEvent({
                  bookingId: id,
                  userId: row.user_id,
                  providerId: assignedProviderId,
                  serviceId: row.service_id,
                  assignedAt: acceptedAt,
                  eta: eta ?? null,
                  actorType: "partner",
                  actorId: providerId,
                }),
              );
            }
          },
          { isolationLevel: "Serializable" },
        );

        const booking = await this.loadBookingForAccept(id);
        if (!booking) return { ok: false, error: "NOT_FOUND" };

        const newlyAccepted = true;
        if (booking.userId) {
          const existingNotice = await prisma.notification.findFirst({
            where: {
              userId: booking.userId,
              type: "booking_accepted",
              referenceId: booking.id,
            },
            select: { id: true },
          });
          if (!existingNotice) {
            await notificationService.createForUser({
              userId: booking.userId,
              type: "booking_accepted",
              title: "Booking Accepted",
              message: `${booking.provider?.user.firstName} has accepted your ${booking.service.name} booking`,
              referenceId: booking.id,
              referenceType: "booking",
            });
            const customer = await prisma.user.findUnique({ where: { id: booking.userId } });
            if (customer) {
              const email = await userPiiService.resolveEmail(customer, { actorId: booking.userId, authorized: true });
              if (email) {
                emailDeliveryService.sendBookingAssigned(
                  email,
                  {
                    id: booking.id,
                    serviceTitle: booking.service.name,
                    proName: `${booking.provider?.user.firstName ?? "Pro"} ${booking.provider?.user.lastName ?? ""}`.trim(),
                  },
                  customer.firstName,
                );
              }
            }
          }
        }

        void assignmentEngine.onProviderAccepted(id, providerId).catch(() => undefined);

        return { ok: true, booking, newlyAccepted };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
            continue;
          }
        }
        if (error instanceof Error) {
          if (error.message === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
          if (error.message === "ALREADY_CLAIMED") return { ok: false, error: "ALREADY_CLAIMED" };
          if (error.message === "INVALID_STATUS") return { ok: false, error: "INVALID_STATUS" };
          if (error.message === "PROVIDER_UNAVAILABLE" || error.message === "OVERLAPPING_BOOKING") {
            return { ok: false, error: "PROVIDER_UNAVAILABLE" };
          }
        }
        throw error;
      }
    }

    return { ok: false, error: "INVALID_STATUS" };
  }

  /** Confirm this provider may accept — restore tentative assignment when needed. */
  private async resolveAcceptingProvider(
    tx: Prisma.TransactionClient,
    bookingId: string,
    providerId: string,
    currentProviderId: string | null,
  ): Promise<string> {
    if (currentProviderId === providerId) return providerId;

    const sentAttempt = await tx.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.SENT,
        job: { bookingId },
      },
      orderBy: { dispatchedAt: "desc" },
    });
    if (sentAttempt) {
      await tx.booking.update({ where: { id: bookingId }, data: { providerId } });
      return providerId;
    }

    const graceSince = new Date(Date.now() - ASSIGN_ACCEPT_GRACE_MS);
    const recentTimeout = await tx.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.TIMEOUT,
        job: { bookingId },
        respondedAt: { gte: graceSince },
      },
      orderBy: { dispatchedAt: "desc" },
    });
    if (recentTimeout) {
      await tx.assignmentAttempt.update({
        where: { id: recentTimeout.id },
        data: { status: AssignmentAttemptStatus.SENT, respondedAt: null, responseMs: null },
      });
      await tx.assignmentJob.updateMany({
        where: { bookingId },
        data: {
          status: AssignmentJobStatus.DISPATCHED,
          currentProviderId: providerId,
          timeoutAt: new Date(Date.now() + ASSIGN_ACCEPT_GRACE_MS),
        },
      });
      await tx.booking.update({ where: { id: bookingId }, data: { providerId } });
      return providerId;
    }

    throw new Error("NOT_FOUND");
  }

  private async loadBookingForAccept(id: string) {
    return prisma.booking.findUnique({
      where: { id },
      include: { provider: { include: { user: true } }, service: true, user: true },
    });
  }

  async reject(providerId: string, id: string, reason: string) {
    const booking = await prisma.booking.findFirst({
      where: { id, status: BookingStatus.PENDING },
      include: { service: true },
    });
    if (!booking) return { error: "NOT_FOUND" as const };

    const openAttempt = await prisma.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.SENT,
        job: { bookingId: id },
      },
    });
    if (!openAttempt && booking.providerId !== providerId) {
      return { error: "NOT_FOUND" as const };
    }

    await assignmentEngine.onProviderRejected(id, providerId, reason);

    if (booking.userId) {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "booking_reassigned",
        title: "Finding another professional",
        message: `We're matching you with another provider for ${booking.service?.name ?? "your service"}.`,
        referenceId: id,
        referenceType: "booking",
      });
    }

    void assignmentEngine.dispatchBookingNow(id).catch(() => undefined);
    return { ok: true as const };
  }

  /**
   * Explicit "I'm on my way" from the partner.
   *
   * This is the authoritative producer of `enRouteAt`. Before it existed the timestamp
   * was written only as a side effect of a GPS stream that just one client emitted, so a
   * partner who started a job without that stream lost the travel-start anchor forever —
   * 3 of 108 completed bookings ever recorded one. GPS is now corroboration, not the
   * sole source.
   *
   * Idempotent: repeat calls return `newlyTransitioned: false` and change nothing.
   */
  async markEnRoute(
    providerId: string,
    id: string,
    lat: number,
    lng: number,
  ): Promise<
    | { ok: true; newlyTransitioned: boolean; enRouteAt: Date | null }
    | { ok: false; error: "NOT_FOUND" | "INVALID_STATUS" }
  > {
    const booking = await prisma.booking.findFirst({
      where: { id, providerId },
      select: {
        status: true,
        enRouteAt: true,
        arrivedAt: true,
        eta: true,
        address: { select: { latitude: true, longitude: true } },
      },
    });
    if (!booking) return { ok: false as const, error: "NOT_FOUND" };

    // Already past the transition — report success without re-writing the timestamp.
    if (booking.enRouteAt) {
      recordEtaLifecycleTransition("en_route", "explicit_partner_action", "duplicate");
      return { ok: true as const, newlyTransitioned: false, enRouteAt: booking.enRouteAt };
    }
    // Departure cannot be declared after arrival. The staged CTA prevents this in both
    // clients, but the endpoint must be safe on its own — accepting it would stamp
    // enRouteAt after arrivedAt and yield a negative travel duration.
    if (booking.arrivedAt) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }
    if (!["ACCEPTED", "ASSIGNED"].includes(booking.status)) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }

    const distanceKm = booking.address
      ? distanceBetweenKm(lat, lng, booking.address.latitude, booking.address.longitude)
      : null;

    const applied = await trackingService.commitEnRoute({
      bookingId: id,
      providerId,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      googleEtaMin: booking.eta ?? null,
      source: "explicit_partner_action",
    });

    recordEtaLifecycleTransition(
      "en_route",
      "explicit_partner_action",
      applied ? "applied" : "duplicate",
    );

    const fresh = await prisma.booking.findUnique({ where: { id }, select: { enRouteAt: true } });
    return { ok: true as const, newlyTransitioned: applied, enRouteAt: fresh?.enRouteAt ?? null };
  }

  /**
   * Explicit "I've arrived" from the partner — the authoritative producer of `arrivedAt`.
   *
   * Races safely with both the GPS geofence and the job-start fallback: all three funnel
   * into `trackingService.recordArrival`, which is idempotent on `arrivedAt: null`.
   */
  async markArrived(
    providerId: string,
    id: string,
    lat: number,
    lng: number,
  ): Promise<
    | { ok: true; newlyTransitioned: boolean; arrivedAt: Date | null }
    | { ok: false; error: "NOT_FOUND" | "INVALID_STATUS" }
  > {
    const booking = await prisma.booking.findFirst({
      where: { id, providerId },
      select: {
        status: true,
        arrivedAt: true,
        enRouteAt: true,
        assignedAt: true,
        eta: true,
        address: { select: { city: true, latitude: true, longitude: true } },
        service: { select: { category: true } },
      },
    });
    if (!booking) return { ok: false as const, error: "NOT_FOUND" };

    if (booking.arrivedAt) {
      recordEtaLifecycleTransition("arrived", "explicit_partner_action", "duplicate");
      return { ok: true as const, newlyTransitioned: false, arrivedAt: booking.arrivedAt };
    }
    // A booking that is finished or cancelled can no longer be arrived at.
    if (!["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"].includes(booking.status)) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }

    const distanceKm = booking.address
      ? distanceBetweenKm(lat, lng, booking.address.latitude, booking.address.longitude)
      : null;

    const applied = await trackingService.recordArrival({
      bookingId: id,
      providerId,
      enRouteAt: booking.enRouteAt,
      assignedAt: booking.assignedAt,
      city: booking.address?.city ?? null,
      serviceCategory: booking.service?.category ?? null,
      distanceKm,
      googleEtaMin: booking.eta ?? null,
      source: "explicit_partner_action",
    });

    recordEtaLifecycleTransition(
      "arrived",
      "explicit_partner_action",
      applied ? "applied" : "duplicate",
    );

    const fresh = await prisma.booking.findUnique({ where: { id }, select: { arrivedAt: true } });
    return { ok: true as const, newlyTransitioned: applied, arrivedAt: fresh?.arrivedAt ?? null };
  }

  async start(providerId: string, id: string, lat: number, lng: number) {
    const startedAt = new Date();
    const started = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id, providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE"] } },
        data: { status: "IN_PROGRESS", startedAt },
      });
      if (updated.count === 0) throw new Error("FORBIDDEN");
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!booking?.userId) throw new Error("FORBIDDEN");

      await tx.tracking.upsert({
        where: { bookingId: id },
        create: {
          bookingId: id,
          status: TrackingStatus.IN_PROGRESS,
          startLatitude: lat,
          startLongitude: lng,
          actualStartTime: startedAt,
        },
        update: {
          status: TrackingStatus.IN_PROGRESS,
          startLatitude: lat,
          startLongitude: lng,
          actualStartTime: startedAt,
        },
      });

      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingStartedEvent({
            bookingId: id,
            userId: booking.userId,
            providerId,
            startedAt,
          }),
        );
      }
      return booking;
    });

    if (started.userId) {
      await notificationService.createForUser({
        userId: started.userId,
        type: "service_started",
        title: "Service Started",
        message: "Your service provider has started the job",
        referenceId: id,
      });
    }

    // A partner who is starting the service has demonstrably arrived. Without this,
    // any job that skips the GPS geofence (ACCEPTED -> IN_PROGRESS directly) never
    // records arrivedAt, and Phase 2 can never accumulate ETA training labels.
    // Idempotent: a no-op if the geofence or the explicit action already recorded it.
    //
    // Fire-and-forget so telemetry can never fail a job start — but the failure is now
    // logged and counted instead of swallowed. The previous `.catch(() => undefined)`
    // meant a broken fallback left no trace anywhere.
    void this.backfillArrivalFromStart(id, providerId, lat, lng).catch((err: unknown) => {
      recordEtaJobStartFallback("error");
      logger.error("eta_job_start_fallback_failed", {
        bookingId: id,
        providerId,
        source: "job_start",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return started;
  }

  /**
   * Records arrival at job start when the geofence never fired.
   *
   * The timestamp is slightly later than true arrival — it includes any idle time
   * before work began — so it is tagged `job_start` and the ETA validator scores it
   * below a GPS-confirmed arrival rather than treating the two as equivalent.
   */
  private async backfillArrivalFromStart(
    bookingId: string,
    providerId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        arrivedAt: true,
        enRouteAt: true,
        assignedAt: true,
        eta: true,
        address: { select: { city: true, latitude: true, longitude: true } },
        service: { select: { category: true } },
      },
    });
    if (!booking || booking.arrivedAt) return;

    const distanceKm = booking.address
      ? distanceBetweenKm(lat, lng, booking.address.latitude, booking.address.longitude)
      : null;

    const applied = await trackingService.recordArrival({
      bookingId,
      providerId,
      enRouteAt: booking.enRouteAt,
      assignedAt: booking.assignedAt,
      city: booking.address?.city ?? null,
      serviceCategory: booking.service?.category ?? null,
      distanceKm,
      googleEtaMin: booking.eta ?? null,
      source: "job_start",
    });

    recordEtaJobStartFallback(applied ? "applied" : "duplicate");
    recordEtaLifecycleTransition("arrived", "job_start", applied ? "applied" : "duplicate");
  }

  async complete(
    providerId: string,
    id: string,
    _lat: number,
    _lng: number,
    notes?: string,
  ) {
    const existing = await prisma.booking.findFirst({
      where: { id, providerId },
      include: { service: { select: { name: true } } },
    });
    if (!existing) return null;
    const duration = existing.startedAt
      ? Math.round((Date.now() - existing.startedAt.getTime()) / 60000)
      : existing.estimatedDuration;
    const completedAt = new Date();
    const booking = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt,
          actualDuration: duration,
          providerNotes: notes,
        },
      });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingCompletedEvent({
            bookingId: id,
            userId: updated.userId,
            providerId: updated.providerId,
            serviceId: updated.serviceId,
            completedAt,
            actualDurationMin: duration ?? existing.estimatedDuration ?? 0,
            finalAmount: updated.finalAmount,
            finalAmountPaise: updated.finalAmountPaise,
          }),
        );
      }
      /**
       * The partner is paid in the same transaction that marks the job done.
       *
       * These used to be two transactions: the booking was committed COMPLETED, and only then
       * was the wallet credited, the earning row written and the ledger posted. Anything that
       * interrupted the gap — a process restart, a dropped request — left a finished job with
       * no earning attached, no error anywhere, and a partner whose dashboard simply showed
       * nothing. Six of a hundred and eleven completed bookings were in that state.
       *
       * Joining them means a failure now rolls the completion back too, so the partner sees a
       * job that did not complete and can retry, rather than one that completed for free.
       */
      if (existing.providerId) {
        const alreadyEarned = await tx.earning.findUnique({ where: { bookingId: id } });
        if (!alreadyEarned) {
          // Computed through `tx` so the commission tier counts this booking, matching the
          // behaviour of the previous ordering where the status was already committed.
          const breakdown = await earningsService.calculateBookingEarning(id, tx);
          const { rupeesToPaise } = await import("../lib/money-paise");

          await tx.provider.update({
            where: { id: existing.providerId },
            data: {
              walletBalance: { increment: breakdown.netEarning },
              walletBalancePaise: { increment: rupeesToPaise(breakdown.netEarning) },
              totalEarnings: { increment: breakdown.netEarning },
              completedBookings: { increment: 1 },
            },
          });
          await tx.earning.create({
            data: {
              providerId: existing.providerId,
              bookingId: id,
              grossAmount: breakdown.bookingAmount,
              commission: breakdown.commission,
              netEarning: breakdown.netEarning,
            },
          });
          await financialLedgerService.recordProviderEarningInTransaction(
            tx,
            id,
            breakdown.bookingAmount,
            breakdown.commission,
            breakdown.netEarning,
            breakdown.bonus,
            breakdown.deduction,
          );
        }
      }
      return updated;
    });
    incCounter("booking_completed_total");
    await prisma.tracking.updateMany({
      where: { bookingId: id },
      data: { status: TrackingStatus.COMPLETED, actualEndTime: new Date(), totalDuration: duration },
    });
    if (existing.providerId) {
      const provider = await prisma.provider.findUnique({
        where: { id: existing.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        void earningsLiveService.broadcastEarningsUpdate(provider.userId).catch(() => undefined);
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
      const customer = await prisma.user.findUnique({ where: { id: booking.userId } });
      if (customer) {
        const email = await userPiiService.resolveEmail(customer, { actorId: booking.userId, authorized: true });
        if (email) {
          emailDeliveryService.sendBookingCompleted(
            email,
            { id, serviceTitle: existing.service?.name ?? "Service" },
            customer.firstName,
          );
        }
      }
    }
    return { booking, totalDuration: duration };
  }

  async cancel(
    actor: { userId: string; providerId?: string },
    id: string,
    reason: string,
  ) {
    const MAX_BOOKING_TX_RETRIES = 8;
    const cancellableStatuses = [
      "PENDING",
      "ACCEPTED",
      "ASSIGNED",
      "EN_ROUTE",
      "IN_PROGRESS",
    ] as const;

    for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
      try {
        const locked = await prisma.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                status: string;
                user_id: string;
                provider_id: string | null;
                payment_status: string;
                scheduled_date: Date;
                final_amount: number;
                payment_method: string | null;
              }>
            >`
              SELECT id, status, user_id, provider_id, payment_status, scheduled_date, final_amount, payment_method
              FROM bookings
              WHERE id = ${id}
              FOR UPDATE
            `;
            const row = rows[0];
            if (!row) return { error: "NOT_FOUND" as const };

            const actorResolution = resolveBookingCancelActor(actor.userId, actor.providerId, {
              userId: row.user_id,
              providerId: row.provider_id,
            });
            if (!actorResolution.allowed) return { error: "NOT_FOUND" as const };
            if (row.status === "COMPLETED") return { error: "INVALID_STATUS" as const };
            if (
              row.status === "CANCELLED_BY_USER" ||
              row.status === "CANCELLED_BY_PROVIDER" ||
              row.status === "REJECTED"
            ) {
              return { error: "INVALID_STATUS" as const };
            }
            if (!cancellableStatuses.includes(row.status as (typeof cancellableStatuses)[number])) {
              return { error: "INVALID_STATUS" as const };
            }

            return {
              ok: true as const,
              paymentStatus: row.payment_status,
              cancelledBy: actorResolution.cancelledBy,
              userId: row.user_id,
              bookingStatus: row.status,
              scheduledDate: row.scheduled_date,
              finalAmount: row.final_amount,
              paymentMethod: row.payment_method,
              providerId: row.provider_id,
            };
          },
          { isolationLevel: "Serializable" },
        );

        if ("error" in locked) return locked;

        const status =
          locked.cancelledBy === "user"
            ? BookingStatus.CANCELLED_BY_USER
            : BookingStatus.CANCELLED_BY_PROVIDER;

        const payment = await prisma.payment.findUnique({ where: { bookingId: id } });
        const paidAmount =
          locked.paymentStatus === "SUCCESS" && payment
            ? payment.amountPaid || payment.amount
            : 0;

        const quote = cancellationPolicyService.calculate({
          paidAmount: paidAmount || locked.finalAmount,
          scheduledDate: locked.scheduledDate,
          bookingStatus: locked.bookingStatus,
          cancelledBy: locked.cancelledBy,
          paymentMethod: payment?.paymentMethod ?? locked.paymentMethod,
        });

        const refundStatus =
          quote.refundAmount > 0 && locked.paymentStatus === "SUCCESS" ? "pending" : "none";

        const cancelledAt = new Date();
        const applied = await prisma.$transaction(async (tx) => {
          const count = await tx.booking.updateMany({
            where: {
              id,
              status: { in: [...cancellableStatuses] },
            },
            data: {
              status,
              cancelledAt,
              cancellationReason: reason,
              cancelledBy: locked.cancelledBy,
              refundAmount: quote.refundAmount,
              refundStatus,
            },
          });
          if (count.count === 0) return 0;

          if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
            await emitInTransaction(
              tx,
              buildBookingCancelledEvent({
                bookingId: id,
                userId: locked.userId,
                providerId: locked.providerId,
                cancelledBy: locked.cancelledBy,
                status,
                refundAmount: quote.refundAmount,
                cancelledAt,
                actorType: locked.cancelledBy === "user" ? "customer" : "partner",
                actorId: actor.userId,
              }),
            );
          }
          return count.count;
        });

        if (applied === 0) {
          return { error: "INVALID_STATUS" as const };
        }

        incCounter("booking_cancelled_total", { by: locked.cancelledBy });
        if (quote.refundAmount > 0) recordFinancialMetric("refund_total", 1);

        void assignmentEngine.onBookingCancelled(id).catch(() => undefined);

        if (quote.refundAmount > 0 && locked.paymentStatus === "SUCCESS") {
          void bookingRefundService
            .processCancellationRefund({
              bookingId: id,
              userId: locked.userId,
              actorUserId: actor.userId,
              reason,
              cancelledBy: locked.cancelledBy,
              refundAmount: quote.refundAmount,
            })
            .then(async (refundResult) => {
              await prisma.booking.updateMany({
                where: { id },
                data: { refundStatus: refundResult.status, refundAmount: refundResult.amount },
              });
            })
            .catch(() => undefined);
        }

        const bookingRow = await prisma.booking.findUnique({
          where: { id },
          include: { service: true, provider: { include: { user: true } } },
        });

        if (bookingRow?.userId && locked.cancelledBy === "provider") {
          await notificationService.createForUser({
            userId: bookingRow.userId,
            type: "booking_cancelled_by_provider",
            title: "Booking cancelled by professional",
            message:
              quote.refundAmount > 0
                ? `${bookingRow.provider?.user.firstName ?? "Your professional"} cancelled — ₹${quote.refundAmount} refund is on the way.`
                : `${bookingRow.provider?.user.firstName ?? "Your professional"} cancelled your ${bookingRow.service?.name ?? "booking"}.`,
            referenceId: id,
            referenceType: "booking",
          });
        }

        if (bookingRow?.provider?.userId && locked.cancelledBy === "user") {
          void notificationService.notifyBookingCancelled(
            bookingRow.provider.userId,
            id,
            reason,
          );
        }

        return {
          status: bookingStatusApi(status),
          refundAmount: quote.refundAmount,
          refundStatus,
          cancellationFee: quote.feeAmount,
          refundMessage: quote.message,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
            continue;
          }
        }
        throw error;
      }
    }

    return { error: "INVALID_STATUS" as const };
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
