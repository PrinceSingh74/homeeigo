import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";
import { resolveServiceMatchTokens, serviceCategoryMatchWhere } from "../lib/service-match";
import { entitlementService } from "./entitlement.service";
import { geofenceService } from "./geofence.service";
import { partnerOperationsService } from "./partner-operations.service";
import { isInBreakWindow, isWithinWorkingWindow } from "../lib/partner-ops-clock";
import { MIN_SERVICE_RADIUS_KM } from "../lib/partner-capacity";
import { careerPriorityBoost } from "../lib/partner-career-policy";
import { DISPATCH_LIFECYCLE_WHERE } from "../lib/partner-four-axis";

export interface MatchingRequest {
  serviceId: string;
  customerId?: string;
  latitude: number;
  longitude: number;
  scheduledDate: Date;
  maxResults?: number;
  maxDistanceKm?: number;
}

export interface ProviderScoreBreakdown {
  ratingScore: number;
  distanceScore: number;
  availabilityScore: number;
  responseScore: number;
  completionScore: number;
}

export interface ProviderMatch {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  distance: number;
  eta: number;
  totalScore: number;
  scoreBreakdown: ProviderScoreBreakdown;
  isOnline: boolean;
  availability: boolean;
  profileImage: string | null;
  premiumBoost?: number;
  careerPriorityBoost?: number;
}

const MAX_DISTANCE_DEFAULT_KM = 50;
const CONFLICT_WINDOW_MS = 2 * 60 * 60 * 1000;

type ProviderForMatching = Awaited<ReturnType<MatchingService["loadCandidates"]>>[number];

export class MatchingService {
  /**
   * Find best matching providers for a booking request.
   *
   * Composite score (0-100):
   *   rating (0-30) + distance (0-25) + availability (0-20)
   *   + response (0-15) + completion (0-10)
   */
  async findBestProviders(request: MatchingRequest): Promise<ProviderMatch[]> {
    const {
      serviceId,
      latitude,
      longitude,
      scheduledDate,
      maxResults = 10,
      maxDistanceKm = MAX_DISTANCE_DEFAULT_KM,
    } = request;

    const providers = await this.loadCandidates(serviceId, { onlyOnline: true });
    if (providers.length === 0) return [];

    const entitlements = request.customerId
      ? await entitlementService.resolve(request.customerId)
      : null;
    const isPremium = Boolean(entitlements?.hasMembership && entitlements.premiumAccess);

    const providerIds = providers.map((p) => p.id);
    const [conflicts, capacityMap, jobZones] = await Promise.all([
      this.loadConflictMap(providerIds, scheduledDate),
      partnerOperationsService.loadCapacityMap(providerIds, scheduledDate),
      geofenceService.findContaining(latitude, longitude, { zoneType: "SERVICE_ZONE" }).catch(() => []),
    ]);
    const jobZoneNames = new Set(jobZones.map((z) => z.name.trim().toLowerCase()));

    const matches = providers
      .map((p) =>
        this.scoreProvider(
          p,
          latitude,
          longitude,
          scheduledDate,
          conflicts.get(p.id) ?? false,
          isPremium,
          { capacityFull: capacityMap.get(p.id)?.capacityFull ?? false, jobZoneNames },
        ),
      )
      .filter((m) => m.distance <= maxDistanceKm && m.availability);

    matches.sort((a, b) => b.totalScore - a.totalScore);

    const available = matches.slice(0, maxResults);

    if (request.customerId && available.length > 0) {
      void this.persistMatchScores({
        userId: request.customerId,
        serviceId,
        tier: entitlements?.tier ?? null,
        priorityScore: entitlements ? (entitlements.hasMembership ? 80 : 10) : 10,
        matches: available,
      }).catch(() => {});
    }

    return available;
  }

  private async persistMatchScores(opts: {
    userId: string;
    serviceId: string;
    tier: string | null;
    priorityScore: number;
    matches: ProviderMatch[];
  }) {
    await prisma.providerMatchScore.createMany({
      data: opts.matches.map((m, idx) => ({
        userId: opts.userId,
        providerId: m.providerId,
        serviceId: opts.serviceId,
        membershipTier: opts.tier,
        priorityScore: opts.priorityScore,
        totalScore: m.totalScore,
        premiumBoost: m.premiumBoost ?? 0,
        ratingScore: m.scoreBreakdown.ratingScore,
        distanceScore: m.scoreBreakdown.distanceScore,
        responseScore: m.scoreBreakdown.responseScore,
        completionScore: m.scoreBreakdown.completionScore,
        rank: idx + 1,
      })),
    });
  }

  /**
   * Re-rank candidates without re-checking conflicts (used when provider availability
   * changes in realtime — e.g. another provider comes online).
   */
  async reRankProviders(
    serviceId: string,
    customerLocation: { latitude: number; longitude: number },
    excludeProviderIds: string[] = [],
    customerId?: string,
  ): Promise<ProviderMatch[]> {
    const entitlements = customerId ? await entitlementService.resolve(customerId) : null;
    const isPremium = Boolean(entitlements?.hasMembership && entitlements.premiumAccess);
    const providers = await this.loadCandidates(serviceId, { onlyOnline: true, exclude: excludeProviderIds });
    if (providers.length === 0) return [];
    const now = new Date();
    const [capacityMap, jobZones] = await Promise.all([
      partnerOperationsService.loadCapacityMap(
        providers.map((p) => p.id),
        now,
      ),
      geofenceService
        .findContaining(customerLocation.latitude, customerLocation.longitude, { zoneType: "SERVICE_ZONE" })
        .catch(() => []),
    ]);
    const jobZoneNames = new Set(jobZones.map((z) => z.name.trim().toLowerCase()));
    return providers
      .map((p) =>
        this.scoreProvider(
          p,
          customerLocation.latitude,
          customerLocation.longitude,
          now,
          false,
          isPremium,
          { capacityFull: capacityMap.get(p.id)?.capacityFull ?? false, jobZoneNames },
        ),
      )
      .filter((m) => m.availability)
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async loadCandidates(
    serviceId: string,
    options: { onlyOnline?: boolean; exclude?: string[] } = {},
  ) {
    const maxCandidates = Number(process.env.MATCHING_MAX_CANDIDATES || 500);
    const matchTokens = await resolveServiceMatchTokens(serviceId);
    if (!matchTokens) return [];

    return prisma.provider.findMany({
      where: {
        ...serviceCategoryMatchWhere(matchTokens),
        isActive: true,
        isApproved: true,
        isBanned: false,
        complianceRestricted: false,
        pausedAt: null,
        ...DISPATCH_LIFECYCLE_WHERE,
        user: { isBanned: false },
        ...(options.onlyOnline ? { isOnline: true } : {}),
        ...(options.exclude && options.exclude.length > 0
          ? { id: { notIn: options.exclude } }
          : {}),
      },
      include: {
        user: { select: { firstName: true, lastName: true, isBanned: true } },
        currentLocation: true,
      },
      orderBy: [{ rating: "desc" }, { completionRate: "desc" }],
      take: maxCandidates,
    });
  }

  private async loadConflictMap(
    providerIds: string[],
    scheduledDate: Date,
  ): Promise<Map<string, boolean>> {
    if (providerIds.length === 0) return new Map();
    const rows = await prisma.booking.findMany({
      where: {
        providerId: { in: providerIds },
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.ACCEPTED,
            BookingStatus.ASSIGNED,
            BookingStatus.EN_ROUTE,
            BookingStatus.IN_PROGRESS,
          ],
        },
        scheduledDate: {
          gte: new Date(scheduledDate.getTime() - CONFLICT_WINDOW_MS),
          lte: new Date(scheduledDate.getTime() + CONFLICT_WINDOW_MS),
        },
      },
      select: { providerId: true },
    });
    const map = new Map<string, boolean>();
    for (const row of rows) {
      if (row.providerId) map.set(row.providerId, true);
    }
    return map;
  }

  private scoreProvider(
    provider: ProviderForMatching,
    customerLat: number,
    customerLng: number,
    scheduledDate: Date,
    hasConflict: boolean,
    isPremiumCustomer = false,
    extras?: { capacityFull?: boolean; jobZoneNames?: Set<string> },
  ): ProviderMatch {
    const loc = provider.currentLocation;
    const originLat = loc?.latitude ?? provider.baseLatitude;
    const originLng = loc?.longitude ?? provider.baseLongitude;
    const distance =
      originLat != null && originLng != null
        ? distanceKm(customerLat, customerLng, originLat, originLng)
        : 15;

    const ratingScore = this.calculateRatingScore(provider.rating, provider.totalReviews);
    const distanceScore = this.calculateDistanceScore(distance);
    const availabilityScore = this.calculateAvailabilityScore(
      provider,
      scheduledDate,
      hasConflict,
      extras,
      distance,
    );
    const responseScore = this.calculateResponseScore(provider.responseRate, provider.avgResponseTime);
    const completionScore = this.calculateCompletionScore(provider.completionRate);

    // Phase C — premium ranking: higher-rated providers ranked first for members.
    let premiumBoost = 0;
    if (isPremiumCustomer) {
      if (provider.rating >= 4.8) premiumBoost += 12;
      else if (provider.rating >= 4.5) premiumBoost += 8;
      else if (provider.rating >= 4.0) premiumBoost += 4;
      if (provider.isOnline) premiumBoost += 3;
    }

    const careerBoost = careerPriorityBoost(provider.careerLevel, {
      lifecycleState: provider.lifecycleState,
      complianceRestricted: provider.complianceRestricted,
    });

    const totalScore = round1(
      ratingScore + distanceScore + availabilityScore + responseScore + completionScore + premiumBoost + careerBoost,
    );

    return {
      providerId: provider.id,
      name:
        provider.businessName ||
        `${provider.user.firstName} ${provider.user.lastName}`.trim(),
      rating: provider.rating,
      totalReviews: provider.totalReviews,
      distance: round1(distance),
      eta: etaMinutes(distance),
      totalScore,
      scoreBreakdown: {
        ratingScore: round1(ratingScore),
        distanceScore: round1(distanceScore),
        availabilityScore: round1(availabilityScore),
        responseScore: round1(responseScore),
        completionScore: round1(completionScore),
      },
      isOnline: provider.isOnline,
      availability: availabilityScore > 0,
      profileImage: provider.profileImage,
      premiumBoost: isPremiumCustomer ? round1(premiumBoost) : undefined,
      careerPriorityBoost: careerBoost > 0 ? careerBoost : undefined,
    };
  }

  /** 0-30. New providers (<5 reviews) get a default 15. */
  private calculateRatingScore(rating: number, totalReviews: number): number {
    if (totalReviews < 5) return 15;
    if (rating >= 4.8) return 30;
    if (rating >= 4.5) return 27;
    if (rating >= 4.0) return 24;
    if (rating >= 3.5) return 20;
    if (rating >= 3.0) return 15;
    return 10;
  }

  /** 0-25. Linear decay from 0 km to MAX_DISTANCE_DEFAULT_KM. */
  private calculateDistanceScore(distance: number): number {
    const score = (1 - distance / MAX_DISTANCE_DEFAULT_KM) * 25;
    if (score < 0) return 0;
    if (score > 25) return 25;
    return score;
  }

  /**
   * 0-20. Working window, breaks, capacity, and service radius/zones.
   * Unset schedule still treats as 24/7 so incomplete profiles are not punished.
   */
  private calculateAvailabilityScore(
    provider: ProviderForMatching,
    scheduledDate: Date,
    hasConflict: boolean,
    extras?: { capacityFull?: boolean; jobZoneNames?: Set<string> },
    distanceKmValue = 15,
  ): number {
    if (!provider.isOnline || provider.pausedAt) return 0;
    if (extras?.capacityFull) return 0;

    const schedule = {
      workingDays: provider.workingDays,
      workingHoursStart: provider.workingHoursStart,
      workingHoursEnd: provider.workingHoursEnd,
      breakWindows: provider.breakWindows,
      timezone: provider.timezone,
    };
    if (!isWithinWorkingWindow(schedule, scheduledDate)) return 0;
    if (isInBreakWindow(schedule, new Date())) return 0;

    const radius = provider.serviceRadiusKm;
    if (radius != null && radius >= MIN_SERVICE_RADIUS_KM) {
      const loc = provider.currentLocation;
      const hasOrigin = Boolean(loc) || (provider.baseLatitude != null && provider.baseLongitude != null);
      if (!hasOrigin || distanceKmValue > radius) return 0;
    }

    if (provider.serviceRegions.length > 0 && extras?.jobZoneNames && extras.jobZoneNames.size > 0) {
      const wants = provider.serviceRegions.map((r) => r.trim().toLowerCase()).filter(Boolean);
      const zoneHit = wants.some((w) =>
        [...extras.jobZoneNames!].some((n) => n === w || n.includes(w) || w.includes(n)),
      );
      if (!zoneHit) return 0;
    }

    return hasConflict ? 10 : 20;
  }

  /** 0-15. Weighted down by slow response time. */
  private calculateResponseScore(responseRate: number, avgResponseTime: number): number {
    let base: number;
    if (responseRate >= 95) base = 15;
    else if (responseRate >= 90) base = 13;
    else if (responseRate >= 85) base = 11;
    else if (responseRate >= 80) base = 9;
    else if (responseRate >= 70) base = 6;
    else base = 3;

    let multiplier = 1;
    if (avgResponseTime > 30) multiplier = 0.4;
    else if (avgResponseTime > 15) multiplier = 0.6;
    else if (avgResponseTime > 5) multiplier = 0.8;

    return base * multiplier;
  }

  /** 0-10. */
  private calculateCompletionScore(completionRate: number): number {
    if (completionRate >= 98) return 10;
    if (completionRate >= 95) return 9;
    if (completionRate >= 90) return 8;
    if (completionRate >= 85) return 6;
    if (completionRate >= 80) return 4;
    return 1;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const matchingService = new MatchingService();
