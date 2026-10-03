import { BookingStatus, Prisma, type CoverageRequestStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { cacheService } from "./cache.service";
import {
  ACCEPTANCE_TERMINAL_STATUSES,
  acceptanceRatePct,
  acceptanceWindowStart,
} from "../lib/acceptance-rate";
import {
  CANCELLED_BOOKING_STATUSES,
  cancellationRatePct,
  completionRatePct,
} from "../lib/fulfillment-rates";

/**
 * Journeys required before an average arrival time is published for a city.
 *
 * A credibility floor, not a statistical claim: one or two timed journeys describe those journeys,
 * not the city. Tunable — raising it makes the page quieter and never less true.
 */
const MIN_ARRIVAL_SAMPLES = 5;
import {
  CITY_SEEDS,
  deriveCityDetail,
  deriveCitySummary,
  getCitySeed,
  searchCoverage,
  type CityCoverageDetail,
  type CityCoverageSummary,
  type CityLiveOverrides,
  type CoverageSearchResult,
  type CoverageStatus,
} from "../data/hyperlocal-coverage";

/** Operational statuses an admin may set on a city. */
export const MANAGEABLE_CITY_STATUSES: CoverageStatus[] = ["AVAILABLE", "LIMITED", "COMING_SOON"];

export type CoverageRequestInput = {
  name: string;
  mobile: string;
  city?: string;
  area: string;
  society?: string;
  pincode?: string;
  source?: string;
};

export type CoverageIntelligence = {
  totals: {
    cities: number;
    liveCities: number;
    areas: number;
    liveAreas: number;
    pincodes: number;
    societies: number;
    coveragePct: number;
    activePartners: number;
    avgCoverageScore: number;
  };
  cities: Array<
    CityCoverageSummary & {
      liveAreas: number;
      limitedAreas: number;
      comingSoonAreas: number;
      pendingRequests: number;
    }
  >;
  requests: {
    total: number;
    new: number;
    reviewing: number;
    planned: number;
    last30Days: number;
  };
  demandHotspots: Array<{ label: string; requests: number; city: string | null }>;
  expansionOpportunities: Array<{
    citySlug: string;
    cityName: string;
    areaName: string;
    status: string;
    societies: number;
    demandSignals: number;
    priorityIndex: number;
  }>;
  generatedAt: string;
};

/** Case-insensitive live aggregate lookups keyed by seed city name. */
type LiveCityAggregates = Map<string, CityLiveOverrides>;

class CoverageService {
  /** Live DB aggregates blended into the deterministic baselines (cached — read-heavy). */
  private async liveAggregates(): Promise<LiveCityAggregates> {
    return cacheService.getOrFetch(
      "coverage:live-aggregates",
      300,
      async () => {
        const cityNames = CITY_SEEDS.map((c) => c.name);
        const [providerGroups, customerGroups, bookingCounts, acceptanceRows, outcomeRows] = await Promise.all([
          prisma.provider.groupBy({
            by: ["city"],
            where: { isActive: true, city: { in: cityNames, mode: "insensitive" } },
            _count: { _all: true },
          }),
          prisma.user.groupBy({
            by: ["preferredCity"],
            where: { preferredCity: { in: cityNames, mode: "insensitive" } },
            _count: { _all: true },
          }),
          Promise.all(
            cityNames.map(async (name) => ({
              name,
              count: await prisma.booking.count({
                where: {
                  status: BookingStatus.COMPLETED,
                  address: { city: { equals: name, mode: "insensitive" } },
                },
              }),
            })),
          ),
          /**
           * Terminal dispatch outcomes per city, on the SAME definition the provider column uses —
           * ACCEPTED over ACCEPTED+REJECTED+TIMEOUT within the shared window. Raw SQL because Prisma
           * cannot group by a field on a relation, and grouping is the whole point: one pass for
           * every city rather than a query each.
           */
          prisma.$queryRaw<Array<{ city: string | null; accepted: bigint; terminal: bigint }>>`
            SELECT p.city AS city,
                   COUNT(*) FILTER (WHERE a.status = 'ACCEPTED') AS accepted,
                   COUNT(*) AS terminal
            FROM assignment_attempts a
            JOIN providers p ON p.id = a.provider_id
            WHERE a.status = ANY(${ACCEPTANCE_TERMINAL_STATUSES}::"AssignmentAttemptStatus"[])
              AND a.dispatched_at >= ${acceptanceWindowStart()}
              AND p.city IS NOT NULL
            GROUP BY p.city
          `,
          /**
           * Terminal booking outcomes and mean travel time per city, in one pass.
           *
           * Travel time comes from the en_route -> arrived lifecycle pair (ADR-018), NOT from
           * `bookings.eta`. `eta` looked like the obvious source and is not one: 33 of 2,879 rows
           * carry a value and every one of them is exactly 1, so it is a sentinel rather than a
           * measurement. Averaging it would have published "Avg Arrival Time: 1 min" — swapping a
           * seeded fabrication for a misattributed one.
           *
           * These replace `seeded()` figures that were published to customers as
           * "Completion Rate", "Cancellation Rate" and "Avg Arrival Time". Grouped on the booking's
           * ADDRESS city, which is the city the work happened in — the same attribution
           * `servicesCompleted` already uses, so the numbers on one card cannot disagree.
           */
          prisma.$queryRaw<Array<{
            city: string | null;
            completed: bigint;
            cancelled: bigint;
            avg_eta: number | null;
            arrival_samples: bigint;
          }>>`
            SELECT a.city AS city,
                   COUNT(*) FILTER (WHERE b.status = 'COMPLETED') AS completed,
                   COUNT(*) FILTER (WHERE b.status = ANY(${CANCELLED_BOOKING_STATUSES}::"BookingStatus"[])) AS cancelled,
                   AVG(EXTRACT(EPOCH FROM (b.arrived_at - b.en_route_at)) / 60)
                     FILTER (WHERE b.arrived_at IS NOT NULL AND b.en_route_at IS NOT NULL
                             AND b.arrived_at > b.en_route_at) AS avg_eta,
                   COUNT(*) FILTER (WHERE b.arrived_at IS NOT NULL AND b.en_route_at IS NOT NULL
                                    AND b.arrived_at > b.en_route_at) AS arrival_samples
            FROM bookings b
            JOIN addresses a ON a.id = b.address_id
            WHERE a.city IS NOT NULL
            GROUP BY a.city
          `,
        ]);

        const acceptanceByCity = new Map(
          acceptanceRows.map((r) => [String(r.city ?? "").toLowerCase(), r]),
        );
        const outcomeByCity = new Map(outcomeRows.map((r) => [String(r.city ?? "").toLowerCase(), r]));

        const map: Array<[string, CityLiveOverrides]> = CITY_SEEDS.map((seed) => {
          const key = seed.name.toLowerCase();
          const providers = providerGroups.find((g) => g.city?.toLowerCase() === key)?._count._all ?? 0;
          const customers = customerGroups.find((g) => g.preferredCity?.toLowerCase() === key)?._count._all ?? 0;
          const completed = bookingCounts.find((b) => b.name.toLowerCase() === key)?.count ?? 0;
          /**
           * Measured, or absent. `acceptanceRatePct` returns null when the city has no terminal
           * dispatch outcome in the window, and that null is carried all the way to the customer
           * page — which previously showed a seeded 91-98% for every city, forever.
           */
          const acc = acceptanceByCity.get(key);
          const acceptanceRate = acceptanceRatePct(Number(acc?.accepted ?? 0), Number(acc?.terminal ?? 0));

          /**
           * Completion, cancellation and arrival time — measured, or absent.
           *
           * A city with no finished bookings has no completion rate. Reporting 0% would say nothing
           * ever finished; the seeded 96.5-99.4% it used to report said the opposite. Both are
           * claims the data cannot support.
           */
          const outcome = outcomeByCity.get(key);
          const outcomeCompleted = Number(outcome?.completed ?? 0);
          const outcomeCancelled = Number(outcome?.cancelled ?? 0);
          /**
           * Published only when there is something credible to publish.
           *
           * Two floors, both stated rather than implied: at least MIN_ARRIVAL_SAMPLES journeys, and
           * an average of at least one minute. The current dataset has 13 arrival pairs averaging
           * 0.01 minutes — instrumentation noise from fixtures — and rounding that to "0 mins" would
           * be a claim, not a measurement. Every city therefore reports null today, which is correct.
           */
          const arrivalSamples = Number(outcome?.arrival_samples ?? 0);
          const avgEtaRaw = outcome?.avg_eta;
          const avgEtaRounded =
            avgEtaRaw != null && Number.isFinite(Number(avgEtaRaw)) ? Math.round(Number(avgEtaRaw)) : null;
          const avgEta =
            arrivalSamples >= MIN_ARRIVAL_SAMPLES && avgEtaRounded != null && avgEtaRounded >= 1
              ? avgEtaRounded
              : null;
          return [
            seed.slug,
            {
              activePartners: providers,
              customers,
              servicesCompleted: completed,
              acceptanceRate,
              completionRate: completionRatePct(outcomeCompleted, outcomeCancelled),
              cancellationRate: cancellationRatePct(outcomeCompleted, outcomeCancelled),
              avgArrivalMins: avgEta,
            },
          ];
        });
        return map;
      },
      15,
    ).then((entries) => new Map(entries));
  }

  /** Active catalog services for a city (falls back to core list inside the engine). */
  private async cityServices(cityName: string): Promise<Array<{ name: string; slug: string }>> {
    const services = await cacheService.getOrFetch(
      // v2: the key changed with the filter so a cached pre-filter list (fixtures included) is never served.
      "coverage:catalog-services:v2",
      300,
      () =>
        prisma.service.findMany({
          where: CUSTOMER_CATALOG_WHERE,
          select: { name: true, slug: true, availableCities: true, unavailableCities: true },
          orderBy: { name: "asc" },
        }),
      15,
    );
    const key = cityName.toLowerCase();
    return services
      .filter(
        (s) =>
          (s.availableCities.length === 0 || s.availableCities.some((c) => c.toLowerCase() === key)) &&
          !s.unavailableCities.some((c) => c.toLowerCase() === key),
      )
      .map((s) => ({ name: s.name, slug: s.slug }));
  }

  /** Admin-managed status overrides keyed by city slug (source of truth for availability). */
  private async statusOverrides(): Promise<Map<string, CoverageStatus>> {
    const rows = await prisma.cityCoverageOverride.findMany({
      where: { status: { not: null } },
      select: { slug: true, status: true },
    });
    const map = new Map<string, CoverageStatus>();
    for (const r of rows) {
      if (r.status && MANAGEABLE_CITY_STATUSES.includes(r.status as CoverageStatus)) {
        map.set(r.slug, r.status as CoverageStatus);
      }
    }
    return map;
  }

  /** Blend live DB aggregates with an admin status override into one overrides object. */
  private mergeOverrides(
    live: CityLiveOverrides | undefined,
    statusOverride: CoverageStatus | undefined,
  ): CityLiveOverrides | undefined {
    if (!statusOverride) return live;
    return { ...(live ?? {}), statusOverride };
  }

  async cities(): Promise<CityCoverageSummary[]> {
    const [live, overrides] = await Promise.all([
      this.liveAggregates().catch(() => new Map() as LiveCityAggregates),
      this.statusOverrides().catch(() => new Map<string, CoverageStatus>()),
    ]);
    return CITY_SEEDS.map((seed) =>
      deriveCitySummary(seed, this.mergeOverrides(live.get(seed.slug), overrides.get(seed.slug))),
    );
  }

  async cityDetail(slug: string): Promise<CityCoverageDetail | null> {
    const seed = getCitySeed(slug);
    if (!seed) return null;
    const [live, services, overrides] = await Promise.all([
      this.liveAggregates().catch(() => new Map() as LiveCityAggregates),
      this.cityServices(seed.name).catch(() => []),
      this.statusOverrides().catch(() => new Map<string, CoverageStatus>()),
    ]);
    return deriveCityDetail(seed, {
      live: this.mergeOverrides(live.get(seed.slug), overrides.get(seed.slug)),
      services,
    });
  }

  /** Admin: all cities with live metrics + which have a manual status override (for the console). */
  async managedCities(): Promise<Array<CityCoverageSummary & { managedStatus: CoverageStatus | null; note: string | null }>> {
    const [summaries, rows] = await Promise.all([
      this.cities(),
      prisma.cityCoverageOverride.findMany({ select: { slug: true, status: true, note: true } }),
    ]);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    return summaries.map((s) => {
      const row = bySlug.get(s.slug);
      const managedStatus =
        row?.status && MANAGEABLE_CITY_STATUSES.includes(row.status as CoverageStatus)
          ? (row.status as CoverageStatus)
          : null;
      return { ...s, managedStatus, note: row?.note ?? null };
    });
  }

  /** Admin: set (or clear, with status=null) a city's operational status override. */
  async setCityStatus(slug: string, status: CoverageStatus | null, note: string | undefined, userId: string) {
    if (!getCitySeed(slug)) return { ok: false as const, reason: "CITY_NOT_FOUND" };
    if (status !== null && !MANAGEABLE_CITY_STATUSES.includes(status)) {
      return { ok: false as const, reason: "INVALID_STATUS" };
    }
    await prisma.cityCoverageOverride.upsert({
      where: { slug },
      create: { slug, status, note: note ?? null, updatedBy: userId },
      update: { status, note: note ?? null, updatedBy: userId },
    });
    return { ok: true as const };
  }

  search(query: string, limit = 12): CoverageSearchResult[] {
    return searchCoverage(query, Math.min(Math.max(limit, 1), 25));
  }

  async createRequest(input: CoverageRequestInput) {
    // Dedupe: same mobile + area within 24h counts as one demand signal.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.coverageRequest.findFirst({
      where: {
        mobile: input.mobile,
        area: { equals: input.area, mode: "insensitive" },
        createdAt: { gte: dayAgo },
      },
      select: { id: true },
    });
    if (existing) return { request: existing, duplicate: true };

    const request = await prisma.coverageRequest.create({
      data: {
        name: input.name,
        mobile: input.mobile,
        city: input.city?.trim() || null,
        area: input.area.trim(),
        society: input.society?.trim() || null,
        pincode: input.pincode?.trim() || null,
        source: input.source?.trim() || "web_coverage_explorer",
      },
      select: { id: true, status: true, createdAt: true },
    });
    return { request, duplicate: false };
  }

  async listRequests(opts: { status?: string; search?: string; page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const where: Prisma.CoverageRequestWhereInput = {};
    if (opts.status && opts.status !== "ALL") where.status = opts.status as CoverageRequestStatus;
    if (opts.search) {
      const q = opts.search.trim();
      where.OR = [
        { area: { contains: q, mode: "insensitive" } },
        { society: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { pincode: { contains: q } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }
    const [requests, total] = await Promise.all([
      prisma.coverageRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.coverageRequest.count({ where }),
    ]);
    return { requests, total, page, limit };
  }

  async updateRequest(id: string, patch: { status?: string; notes?: string }, updatedBy?: string) {
    return prisma.coverageRequest.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status as CoverageRequestStatus } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedBy: updatedBy ?? null,
      },
    });
  }

  /** Admin dashboard aggregates — Operations HQ Coverage Intelligence + Executive HQ score. */
  async intelligence(): Promise<CoverageIntelligence> {
    const [live, requestRows, overrides] = await Promise.all([
      this.liveAggregates().catch(() => new Map() as LiveCityAggregates),
      prisma.coverageRequest.findMany({
        select: { city: true, area: true, society: true, pincode: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      }),
      this.statusOverrides().catch(() => new Map<string, CoverageStatus>()),
    ]);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const requestsByCity = new Map<string, number>();
    const hotspotCounts = new Map<string, { requests: number; city: string | null }>();
    for (const r of requestRows) {
      const cityKey = r.city?.toLowerCase() ?? "unknown";
      requestsByCity.set(cityKey, (requestsByCity.get(cityKey) ?? 0) + 1);
      const label = r.society || r.area || r.pincode || "Unknown";
      const entry = hotspotCounts.get(label.toLowerCase()) ?? { requests: 0, city: r.city };
      entry.requests += 1;
      hotspotCounts.set(label.toLowerCase(), entry);
    }
    const hotspotLabels = new Map<string, string>();
    for (const r of requestRows) {
      const label = r.society || r.area || r.pincode || "Unknown";
      if (!hotspotLabels.has(label.toLowerCase())) hotspotLabels.set(label.toLowerCase(), label);
    }

    const cities = CITY_SEEDS.map((seed) => {
      const summary = deriveCitySummary(seed, this.mergeOverrides(live.get(seed.slug), overrides.get(seed.slug)));
      return {
        ...summary,
        liveAreas: seed.areas.filter((a) => a.status === "AVAILABLE").length,
        limitedAreas: seed.areas.filter((a) => a.status === "LIMITED").length,
        comingSoonAreas: seed.areas.filter((a) => a.status === "COMING_SOON").length,
        pendingRequests: requestsByCity.get(seed.name.toLowerCase()) ?? 0,
      };
    });

    const totalAreas = cities.reduce((s, c) => s + c.areaCount, 0);
    const liveAreas = cities.reduce((s, c) => s + c.liveAreas, 0);
    const limitedAreas = cities.reduce((s, c) => s + c.limitedAreas, 0);

    // Expansion Priority Index: demand signals (60%) + society footprint (25%) + city maturity (15%).
    const expansionOpportunities = CITY_SEEDS.flatMap((seed) => {
      const citySummary = cities.find((c) => c.slug === seed.slug)!;
      return seed.areas
        .filter((a) => a.status !== "AVAILABLE")
        .map((a) => {
          const demandSignals = requestRows.filter((r) => {
            const inCity = r.city?.toLowerCase() === seed.name.toLowerCase();
            const areaMatch = r.area.toLowerCase().includes(a.name.toLowerCase().split(" ")[0] ?? "");
            const pinMatch = r.pincode ? a.pincodes.includes(r.pincode) : false;
            return inCity && (areaMatch || pinMatch);
          }).length;
          const priorityIndex = Math.round(
            Math.min(1, demandSignals / 25) * 60 +
              Math.min(1, a.societies.length / 6) * 25 +
              (citySummary.coverageScore / 100) * 15,
          );
          return {
            citySlug: seed.slug,
            cityName: seed.name,
            areaName: a.name,
            status: a.status,
            societies: a.societies.length,
            demandSignals,
            priorityIndex,
          };
        });
    })
      .sort((a, b) => b.priorityIndex - a.priorityIndex)
      .slice(0, 15);

    const statusCount = (s: CoverageRequestStatus) => requestRows.filter((r) => r.status === s).length;

    return {
      totals: {
        cities: cities.length,
        liveCities: cities.filter((c) => c.status === "AVAILABLE").length,
        areas: totalAreas,
        liveAreas,
        pincodes: cities.reduce((s, c) => s + c.pincodeCount, 0),
        societies: cities.reduce((s, c) => s + c.societyCount, 0),
        coveragePct: Math.round(((liveAreas + limitedAreas * 0.5) / Math.max(1, totalAreas)) * 1000) / 10,
        // Sums only cities whose partner count was actually measured.
        activePartners: cities.reduce((s, c) => s + (c.activePartners ?? 0), 0),
        avgCoverageScore: Math.round(cities.reduce((s, c) => s + c.coverageScore, 0) / Math.max(1, cities.length)),
      },
      cities,
      requests: {
        total: requestRows.length,
        new: statusCount("NEW"),
        reviewing: statusCount("REVIEWING"),
        planned: statusCount("PLANNED"),
        last30Days: requestRows.filter((r) => r.createdAt.getTime() >= thirtyDaysAgo).length,
      },
      demandHotspots: [...hotspotCounts.entries()]
        .map(([key, v]) => ({ label: hotspotLabels.get(key) ?? key, requests: v.requests, city: v.city }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10),
      expansionOpportunities,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const coverageService = new CoverageService();
