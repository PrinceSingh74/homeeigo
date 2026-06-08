import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { sanitizeUserInput } from "../utils/sanitizer";
import { parsePagination } from "../lib/pagination";
import { hcoinService } from "./hcoin.service";

const ON_TIME_TOLERANCE_MIN = 15;
const RECENT_DAYS_HIGH_WEIGHT = 7;
const RECENT_DAYS_MED_WEIGHT = 30;

export type ProviderBadge =
  | "super_star"
  | "expert"
  | "trusted"
  | "quick_responder"
  | "punctual";

export class RatingService {
  async create(
    userId: string,
    body: {
      bookingId: string;
      rating: number;
      reviewText?: string;
      photos?: string[];
      tipAmount?: number;
      liked?: string[];
      couldImprove?: string[];
    },
  ) {
    const booking = await prisma.booking.findFirst({
      where: { id: body.bookingId, userId, status: "COMPLETED" },
      include: { rating: true, provider: true },
    });
    if (!booking || booking.rating) return { error: "INVALID_BOOKING" as const };
    if (!booking.providerId) return { error: "INVALID_BOOKING" as const };
    if (body.rating < 1 || body.rating > 5) return { error: "VALIDATION_ERROR" as const };

    const rating = await prisma.rating.create({
      data: {
        bookingId: body.bookingId,
        userId,
        providerId: booking.providerId,
        stars: body.rating,
        reviewText: body.reviewText
          ? sanitizeUserInput(body.reviewText, 1000)
          : undefined,
        photos: body.photos ?? [],
        tipAmount: body.tipAmount ?? 0,
        liked: body.liked ?? [],
        couldImprove: body.couldImprove ?? [],
      },
    });

    if (body.tipAmount && body.tipAmount > 0) {
      await prisma.provider.update({
        where: { id: booking.providerId },
        data: { walletBalance: { increment: body.tipAmount } },
      });
    }

    await this.updateProviderMetrics(booking.providerId);

    // Loyalty: reward H-Coins for leaving a review (once per booking).
    void hcoinService.earn(userId, "REVIEW_SUBMITTED", body.bookingId).catch(() => {});

    return rating;
  }

  async byBooking(userId: string, bookingId: string) {
    const r = await prisma.rating.findFirst({
      where: { bookingId, userId },
    });
    if (!r) return null;
    return {
      id: r.id,
      rating: r.stars,
      reviewText: r.reviewText,
      photos: r.photos,
      tipAmount: r.tipAmount,
      createdAt: r.createdAt,
      helpfulCount: r.helpfulCount,
    };
  }

  async update(userId: string, id: string, patch: { rating?: number; reviewText?: string; photos?: string[] }) {
    const existing = await prisma.rating.findFirst({ where: { id, userId } });
    if (!existing) return null;
    await prisma.rating.update({
      where: { id },
      data: {
        stars: patch.rating,
        reviewText: patch.reviewText
          ? sanitizeUserInput(patch.reviewText, 1000)
          : undefined,
        photos: patch.photos,
      },
    });
    if (patch.rating !== undefined) {
      await this.updateProviderMetrics(existing.providerId);
    }
    return true;
  }

  async providerRespond(providerId: string, id: string, response: string) {
    const r = await prisma.rating.findFirst({ where: { id, providerId } });
    if (!r) return null;
    const updated = await prisma.rating.update({
      where: { id },
      data: {
        providerResponse: sanitizeUserInput(response, 1000),
        respondedAt: new Date(),
      },
    });
    return updated;
  }

  async listForUser(userId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const [rows, total] = await Promise.all([
      prisma.rating.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          provider: { include: { user: true } },
          booking: { include: { service: true } },
        },
      }),
      prisma.rating.count({ where: { userId } }),
    ]);
    return {
      ratings: rows.map((r) => ({
        id: r.id,
        bookingNumber: r.booking.bookingNumber,
        provider: {
          id: r.providerId,
          name: `${r.provider.user.firstName} ${r.provider.user.lastName}`,
          image: r.provider.profileImage,
        },
        service: { name: r.booking.service.name },
        rating: r.stars,
        reviewText: r.reviewText,
        photos: r.photos,
        tipAmount: r.tipAmount,
        createdAt: r.createdAt,
      })),
      total,
      page,
    };
  }

  /**
   * Recency-weighted average rating.
   *   ≤ 7 days  → 3x weight
   *   ≤ 30 days → 2x weight
   *   older     → 1x weight
   */
  async calculateProviderRating(providerId: string): Promise<number> {
    const ratings = await prisma.rating.findMany({
      where: { providerId },
      select: { stars: true, createdAt: true },
    });
    if (ratings.length === 0) return 0;

    const now = Date.now();
    let totalScore = 0;
    let totalWeight = 0;
    for (const r of ratings) {
      const daysOld = Math.floor((now - r.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const weight =
        daysOld <= RECENT_DAYS_HIGH_WEIGHT ? 3 : daysOld <= RECENT_DAYS_MED_WEIGHT ? 2 : 1;
      totalScore += r.stars * weight;
      totalWeight += weight;
    }
    if (totalWeight === 0) return 0;
    return Math.round((totalScore / totalWeight) * 10) / 10;
  }

  /**
   * Recompute and persist all derived provider metrics:
   * rating (weighted), totalReviews, completionRate, responseRate, onTimeRate.
   * Triggers badge re-evaluation.
   */
  async updateProviderMetrics(providerId: string): Promise<void> {
    const [ratingCount, weightedRating, bookingStats, onTime] = await Promise.all([
      prisma.rating.count({ where: { providerId } }),
      this.calculateProviderRating(providerId),
      this.computeBookingStats(providerId),
      this.computeOnTimeRate(providerId),
    ]);

    const completionRate =
      bookingStats.total > 0
        ? Math.round((bookingStats.completed / bookingStats.total) * 100)
        : 0;
    const responseRate =
      bookingStats.last30Days > 0
        ? Math.round((bookingStats.last30DaysAccepted / bookingStats.last30Days) * 100)
        : 100;

    await prisma.provider.update({
      where: { id: providerId },
      data: {
        rating: weightedRating,
        totalReviews: ratingCount,
        completedBookings: bookingStats.completed,
        completionRate,
        responseRate,
        onTimeRate: onTime,
      },
    });

    await this.awardBadges(providerId);
  }

  /**
   * Derive and persist badges from current provider metrics.
   */
  async awardBadges(providerId: string): Promise<ProviderBadge[]> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        rating: true,
        totalReviews: true,
        completedBookings: true,
        completionRate: true,
        responseRate: true,
        onTimeRate: true,
        avgResponseTime: true,
      },
    });
    if (!provider) return [];

    const badges: ProviderBadge[] = [];

    if (
      provider.rating >= 4.8 &&
      provider.completedBookings >= 50 &&
      provider.completionRate >= 98
    ) {
      badges.push("super_star");
    }
    if (
      provider.rating >= 4.5 &&
      provider.completedBookings >= 30 &&
      provider.completionRate >= 95
    ) {
      badges.push("expert");
    }
    if (
      provider.rating >= 4.0 &&
      provider.completedBookings >= 10 &&
      provider.completionRate >= 90
    ) {
      badges.push("trusted");
    }
    if (provider.responseRate >= 95 && provider.avgResponseTime > 0 && provider.avgResponseTime <= 5) {
      badges.push("quick_responder");
    }
    if (provider.onTimeRate >= 95 && provider.completedBookings >= 20) {
      badges.push("punctual");
    }

    const unique = Array.from(new Set(badges));
    await prisma.provider.update({
      where: { id: providerId },
      data: { badges: unique },
    });
    return unique;
  }

  async getRatingBreakdown(providerId: string): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
    const grouped = await prisma.rating.groupBy({
      by: ["stars"],
      where: { providerId },
      _count: true,
    });
    const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of grouped) {
      const star = row.stars as 1 | 2 | 3 | 4 | 5;
      if (star in breakdown) breakdown[star] = row._count;
    }
    return breakdown;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async computeBookingStats(providerId: string) {
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);

    const [total, completed, last30Days, last30DaysAccepted] = await Promise.all([
      prisma.booking.count({ where: { providerId } }),
      prisma.booking.count({ where: { providerId, status: BookingStatus.COMPLETED } }),
      prisma.booking.count({ where: { providerId, createdAt: { gte: last30 } } }),
      prisma.booking.count({
        where: {
          providerId,
          createdAt: { gte: last30 },
          status: { in: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED] },
        },
      }),
    ]);

    return { total, completed, last30Days, last30DaysAccepted };
  }

  private async computeOnTimeRate(providerId: string): Promise<number> {
    const completed = await prisma.booking.findMany({
      where: { providerId, status: BookingStatus.COMPLETED },
      select: { scheduledDate: true, tracking: { select: { actualArrivalTime: true } } },
    });
    const withArrival = completed.filter((b) => b.tracking?.actualArrivalTime);
    if (withArrival.length === 0) return 100;

    let onTime = 0;
    for (const b of withArrival) {
      const scheduled = b.scheduledDate.getTime();
      const actual = b.tracking!.actualArrivalTime!.getTime();
      const delayMinutes = (actual - scheduled) / 60000;
      if (delayMinutes <= ON_TIME_TOLERANCE_MIN) onTime += 1;
    }
    return Math.round((onTime / withArrival.length) * 100);
  }
}

export const ratingService = new RatingService();
