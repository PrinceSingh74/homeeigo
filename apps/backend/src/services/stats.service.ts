import { BookingStatus, UserRole } from "@prisma/client";
import prisma from "../lib/prisma";
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
    return cacheService.getOrFetch("stats:overview", 60, async () => {
      const [completedBookings, activeProviders, availableServices, customers, ratingAgg] =
        await Promise.all([
          prisma.booking.count({ where: { status: BookingStatus.COMPLETED } }),
          prisma.provider.count({ where: { isActive: true } }),
          prisma.service.count({ where: { isActive: true } }),
          prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
          prisma.rating.aggregate({ _avg: { stars: true }, _count: true }),
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
    });
  }
}

export const statsService = new StatsService();
