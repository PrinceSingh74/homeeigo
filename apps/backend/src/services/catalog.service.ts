import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { formatServiceList } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { cacheService } from "./cache.service";

// Catalog data changes rarely (no runtime mutation endpoints) and is read on
// nearly every home/category view, so a short TTL is safe and high-value.
const FEATURED_TTL = 10 * 60; // 10 minutes
const CATEGORY_TTL = 5 * 60; //  5 minutes

type ServiceRating = { rating: number | null; reviewCount: number };

/**
 * Real per-service ratings aggregated from the ratings table (rating → booking →
 * serviceId). Services have no rating column, so this is the source of truth.
 * Returns null rating for services with no reviews yet (frontend shows "New").
 */
async function ratingsForServices(serviceIds: string[]): Promise<Map<string, ServiceRating>> {
  const map = new Map<string, ServiceRating>();
  if (serviceIds.length === 0) return map;
  const rows = await prisma.rating.findMany({
    where: { booking: { serviceId: { in: serviceIds } } },
    select: { stars: true, booking: { select: { serviceId: true } } },
  });
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const sid = r.booking.serviceId;
    const cur = acc.get(sid) ?? { sum: 0, count: 0 };
    cur.sum += r.stars;
    cur.count += 1;
    acc.set(sid, cur);
  }
  for (const [sid, { sum, count }] of acc) {
    map.set(sid, { rating: Math.round((sum / count) * 10) / 10, reviewCount: count });
  }
  return map;
}

export class CatalogService {
  async list(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.ServiceWhereInput = { isActive: true };
    if (query.category) where.category = query.category;
    if (query.minPrice != null || query.maxPrice != null) {
      where.basePrice = {};
      if (query.minPrice != null) (where.basePrice as Prisma.FloatFilter).gte = Number(query.minPrice);
      if (query.maxPrice != null) (where.basePrice as Prisma.FloatFilter).lte = Number(query.maxPrice);
    }
    if (query.city) where.availableCities = { has: query.city };

    let orderBy: Prisma.ServiceOrderByWithRelationInput = { popularity: "desc" };
    if (query.sortBy === "price") orderBy = { basePrice: "asc" };
    if (query.sortBy === "newest") orderBy = { createdAt: "desc" };

    const [rows, total] = await Promise.all([
      prisma.service.findMany({ where, orderBy, skip, take: limit }),
      prisma.service.count({ where }),
    ]);
    return { services: rows.map(formatServiceList), total, page, limit };
  }

  async byId(id: string) {
    const s = await prisma.service.findFirst({ where: { id, isActive: true } });
    if (!s) return null;
    const agg = (await ratingsForServices([s.id])).get(s.id);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      detailedDescription: s.detailedDescription,
      category: s.category,
      subcategory: s.subcategory,
      basePrice: s.basePrice,
      minPrice: s.minPrice ?? s.basePrice,
      maxPrice: s.maxPrice ?? s.basePrice,
      estimatedDuration: s.estimatedDuration,
      durationRange: s.durationRange,
      icon: s.icon,
      images: s.images,
      rating: agg?.rating ?? null,
      reviewCount: agg?.reviewCount ?? 0,
      bookingCount: s.bookingCount,
      includedServices: s.includedServices,
      excludedServices: s.excludedServices,
      requirements: s.requirements,
      availableCities: s.availableCities,
      isFeatured: s.isFeatured,
      isPopular: s.isPopular,
      premiumOnly: s.premiumOnly,
    };
  }

  async byCategory(category: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    return cacheService.getOrFetch(`catalog:category:${category}:${page}:${limit}`, CATEGORY_TTL, async () => {
      const where = { isActive: true, category };
      const [rows, total] = await Promise.all([
        prisma.service.findMany({ where, skip, take: limit, orderBy: { popularity: "desc" } }),
        prisma.service.count({ where }),
      ]);
      return {
        services: rows.map((s) => ({
          id: s.id,
          name: s.name,
          basePrice: s.basePrice,
          category: s.category,
        })),
        category,
        total,
        page,
      };
    });
  }

  async search(body: {
    q?: string;
    category?: string;
    city?: string;
    minPrice?: number;
    maxPrice?: number;
  }) {
    const start = Date.now();
    const where: Prisma.ServiceWhereInput = { isActive: true };
    if (body.category) where.category = body.category;
    if (body.city) where.availableCities = { has: body.city };
    if (body.minPrice != null || body.maxPrice != null) {
      where.basePrice = {};
      if (body.minPrice != null) (where.basePrice as Prisma.FloatFilter).gte = body.minPrice;
      if (body.maxPrice != null) (where.basePrice as Prisma.FloatFilter).lte = body.maxPrice;
    }
    if (body.q) {
      where.OR = [
        { name: { contains: body.q, mode: "insensitive" } },
        { description: { contains: body.q, mode: "insensitive" } },
        { tags: { has: body.q.toLowerCase() } },
      ];
    }
    const rows = await prisma.service.findMany({ where, take: 50, orderBy: { popularity: "desc" } });
    const ratings = await ratingsForServices(rows.map((s) => s.id));
    return {
      services: rows.map((s) => ({
        id: s.id,
        name: s.name,
        basePrice: s.basePrice,
        rating: ratings.get(s.id)?.rating ?? null,
        reviewCount: ratings.get(s.id)?.reviewCount ?? 0,
      })),
      total: rows.length,
      searchTime: Date.now() - start,
    };
  }

  async featured() {
    return cacheService.getOrFetch("catalog:featured", FEATURED_TTL, async () => {
      const rows = await prisma.service.findMany({
        where: { isActive: true, isFeatured: true },
        take: 20,
        orderBy: { popularity: "desc" },
      });
      const ratings = await ratingsForServices(rows.map((s) => s.id));
      return {
        services: rows.map((s) => ({
          id: s.id,
          name: s.name,
          basePrice: s.basePrice,
          rating: ratings.get(s.id)?.rating ?? null,
          reviewCount: ratings.get(s.id)?.reviewCount ?? 0,
          isFeatured: s.isFeatured,
          isPromoted: s.isPromoted,
        })),
        total: rows.length,
      };
    });
  }

  // ------------------------------------------------------------------ admin --
  // Admin service management (create / edit / activate / delete). All mutations
  // invalidate the cached homepage catalog read so changes show up immediately.

  private async invalidateCatalogCache(): Promise<void> {
    await cacheService.invalidate("catalog:featured");
  }

  private adminRow(s: Prisma.ServiceGetPayload<object>) {
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      detailedDescription: s.detailedDescription,
      category: s.category,
      subcategory: s.subcategory,
      basePrice: s.basePrice,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      estimatedDuration: s.estimatedDuration,
      icon: s.icon,
      isActive: s.isActive,
      isFeatured: s.isFeatured,
      isPopular: s.isPopular,
      premiumOnly: s.premiumOnly,
      bookingCount: s.bookingCount,
      availableCities: s.availableCities,
      createdAt: s.createdAt,
    };
  }

  /** List ALL services (active + inactive) for the admin panel. */
  async adminList(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.ServiceWhereInput = {};
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };
    if (query.category) where.category = query.category;
    if (query.status === "active") where.isActive = true;
    if (query.status === "inactive") where.isActive = false;

    const [rows, total] = await Promise.all([
      prisma.service.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.service.count({ where }),
    ]);
    return { services: rows.map((s) => this.adminRow(s)), total, page, limit };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** Create a service. Returns null on a unique-constraint clash (name/slug). */
  async create(input: {
    name: string;
    description: string;
    category: string;
    basePrice: number;
    estimatedDuration: number;
    subcategory?: string;
    detailedDescription?: string;
    minPrice?: number;
    maxPrice?: number;
    icon?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    premiumOnly?: boolean;
    availableCities?: string[];
  }) {
    const slug = this.slugify(input.name);
    try {
      const s = await prisma.service.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          detailedDescription: input.detailedDescription,
          category: input.category,
          subcategory: input.subcategory,
          basePrice: input.basePrice,
          minPrice: input.minPrice,
          maxPrice: input.maxPrice,
          estimatedDuration: input.estimatedDuration,
          icon: input.icon,
          isActive: input.isActive ?? true,
          isFeatured: input.isFeatured ?? false,
          premiumOnly: input.premiumOnly ?? false,
          availableCities: input.availableCities ?? [],
        },
      });
      await this.invalidateCatalogCache();
      return { service: this.adminRow(s) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { error: "DUPLICATE" as const };
      }
      throw e;
    }
  }

  /** Update a service. Returns null if it does not exist. */
  async update(
    id: string,
    input: Partial<{
      name: string;
      description: string;
      detailedDescription: string;
      category: string;
      subcategory: string;
      basePrice: number;
      minPrice: number;
      maxPrice: number;
      estimatedDuration: number;
      icon: string;
      isActive: boolean;
      isFeatured: boolean;
      premiumOnly: boolean;
      availableCities: string[];
    }>,
  ) {
    const exists = await prisma.service.findUnique({ where: { id } });
    if (!exists) return { error: "NOT_FOUND" as const };
    try {
      const s = await prisma.service.update({
        where: { id },
        data: { ...input, ...(input.name ? { slug: this.slugify(input.name) } : {}) },
      });
      await this.invalidateCatalogCache();
      return { service: this.adminRow(s) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { error: "DUPLICATE" as const };
      }
      throw e;
    }
  }

  /** Activate / deactivate a service (soft enable/disable — keeps history & bookings). */
  async setActive(id: string, isActive: boolean) {
    const exists = await prisma.service.findUnique({ where: { id } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const s = await prisma.service.update({ where: { id }, data: { isActive } });
    await this.invalidateCatalogCache();
    return { service: this.adminRow(s) };
  }

  /**
   * Hard-delete a service. Bookings reference services with onDelete: Restrict, so a
   * service that has bookings cannot be deleted — callers should deactivate instead.
   */
  async remove(id: string) {
    const exists = await prisma.service.findUnique({ where: { id } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const bookings = await prisma.booking.count({ where: { serviceId: id } });
    if (bookings > 0) return { error: "HAS_BOOKINGS" as const, bookings };
    await prisma.service.delete({ where: { id } });
    await this.invalidateCatalogCache();
    return { ok: true as const };
  }
}

export const catalogService = new CatalogService();
