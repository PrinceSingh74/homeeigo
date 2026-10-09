import { analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import { publicReviewWhere } from "../lib/public-reviews";
import { BookingStatus, UserRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { cacheService } from "./cache.service";

export type StatsOverview = {
  completedBookings: number;
  activeProviders: number;
  availableServices: number;
  customers: number;
  averageRating: number | null;
  reviewCount: number;
};

export class StatsService {
  /**
   * Public homepage stats — all derived live from PostgreSQL (the source of truth).
   * Cached briefly (Redis when available, else in-memory) since these counts change
   * slowly and the homepage is read-heavy. averageRating is null until any review exists.
   */
  async overview(): Promise<StatsOverview> {
    return cacheService.getOrFetch("stats:overview", 120, async () => {
      const [completedBookings, activeProviders, availableServices, customers, ratingAgg] =
        await Promise.all([
          // Public-facing "bookings completed" counter — a business claim shown to customers.
          prisma.booking.count({ where: { status: BookingStatus.COMPLETED, ...analyticsWhere() } }),
          prisma.provider.count({ where: { isActive: true, ...analyticsWhereVia("provider") } }),
          // Public counter: customer-visible commercial services only (never fixtures).
          prisma.service.count({ where: CUSTOMER_CATALOG_WHERE }),
          prisma.user.count({ where: { role: UserRole.CUSTOMER, ...analyticsWhere() } }),
          // The same review population the review lists show, so the headline cannot disagree with them.
          prisma.rating.aggregate({ where: publicReviewWhere(), _avg: { stars: true }, _count: true }),
        ]);

      const avg = ratingAgg._avg.stars;
      return {
        completedBookings,
        activeProviders,
        availableServices,
        customers,
        averageRating: avg != null ? Math.round(avg * 10) / 10 : null,
        reviewCount: ratingAgg._count,
      };
    }, 15);
  }
}

export const statsService = new StatsService();
