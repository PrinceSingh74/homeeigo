import { BookingStatus, Prisma } from "@prisma/client";
import { analyticsSqlPredicate, analyticsWhere, dispatchFallbackWhere, isBusinessRow } from "../lib/analytics-scope";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";
import {
  providerOffersService,
  resolveServiceMatchTokens,
  type ServiceMatchTokens,
} from "../lib/service-match";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { entitlementService } from "./entitlement.service";
import { geofenceService } from "./geofence.service";
import { partnerOperationsService } from "./partner-operations.service";
import { incCounter, observeHist } from "../lib/metrics";
import { logger } from "../lib/logger";
import {
  availabilityGate,
  countRejections,
  distanceBoundGate,
  evaluateMatchingGates,
  serviceAreaGate,
  type GateRejection,
} from "../lib/matching-gates";
import { EMPTY_CAPABILITY_ROWS, type MatchingRejectionReason } from "../lib/provider-capability";
import {
  capabilityRejections,
  loadCapabilityRows,
  loadServiceGateContext,
  seedPartnerIds,
  serviceOfferWhere,
  type ServiceCapabilityMode,
  type ServiceGateContext,
} from "./provider-capability-loader";
import { careerPriorityBoost } from "../lib/partner-career-policy";
import { DISPATCHABLE_PROVIDER_WHERE } from "../lib/partner-four-axis";
import { offerRequiresLivePresence } from "../lib/scheduled-offer-presence";
import {
  dispatchEligibilityService,
  passesPresenceLocationGate,
} from "./dispatch-eligibility.service";
import { configuredMatchingWeights } from "../lib/service-runtime-policy";
import {
  DEFAULT_SIGNAL_WEIGHTS,
  completionPoints,
  distancePoints,
  compareRankedProviders,
  normalisedMatchScore,
  ratingPoints,
  responsePoints,
  unknownSignals,
  type ProviderEvidence,
  type SignalName,
  type SignalScores,
} from "../lib/matching-signals";

/** A provider with no counted bookings. Every history signal reads as UNKNOWN, never as a value. */
const NO_EVIDENCE: ProviderEvidence = Object.freeze({ terminalJobs: 0, recentJobs: 0 });

/** Window over which the response signal is measured — the same 30 days rating.service uses. */
const RESPONSE_WINDOW_DAYS = 30;

export interface MatchingRequest {
  serviceId: string;
  customerId?: string;
  latitude: number;
  longitude: number;
  scheduledDate: Date;
  maxResults?: number;
  maxDistanceKm?: number;
}

/**
 * `null` means the signal had no evidence and was EXCLUDED from the score (W2-D3). Availability is
 * never null: a provider without it does not reach ranking at all.
 */
export interface ProviderScoreBreakdown {
  ratingScore: number | null;
  distanceScore: number | null;
  availabilityScore: number;
  responseScore: number | null;
  completionScore: number | null;
}

export interface ProviderMatch {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  /** Kilometres, or `null` when the provider's position is unknown. Never an invented default. */
  distance: number | null;
  /** Minutes, or `null` whenever distance is unknown — an ETA from an invented distance is a lie. */
  eta: number | null;
  totalScore: number;
  scoreBreakdown: ProviderScoreBreakdown;
  /** Signals excluded for lack of evidence — the "why does this rank here" answer for operations. */
  unknownSignals?: SignalName[];
  isOnline: boolean;
  availableNow?: boolean;
  availabilityLabel?: "Available now" | "Limited availability" | "Confirming professional" | "Unavailable";
  availability: boolean;
  profileImage: string | null;
  premiumBoost?: number;
  careerPriorityBoost?: number;
  /** Set when the service prefers a professional who already completed a job for this customer. */
  preferredProviderBoost?: number;
  matchingConfigVersion?: number;
}

/** Ranking points for a returning professional when the service sets `matching.preferredProvider`. */
const PREFERRED_PROVIDER_BOOST = 10;

/** One provider the hard gates refused, with every failing reason in the mandated order. */
export interface MatchingRejection {
  providerId: string;
  reasons: MatchingRejectionReason[];
  details: GateRejection[];
}

export interface MatchingDiagnostics {
  matches: ProviderMatch[];
  rejections: MatchingRejection[];
  /** Providers carrying each reason (a provider counts once per reason it carries). */
  counts: Partial<Record<MatchingRejectionReason, number>>;
  latencyMs: number;
  candidateCount: number;
  serviceCapabilityMode: ServiceCapabilityMode;
  /** False when the service is not offered (PAUSED / ARCHIVED / DEPRECATED / inactive): nobody is a candidate. */
  serviceOffered: boolean;
}

/** Same bound dispatch, the slot grid and broadcast create use. A partner farther than this is not offered the job. */
export const MATCHING_MAX_DISTANCE_KM = 50;
const MAX_DISTANCE_DEFAULT_KM = MATCHING_MAX_DISTANCE_KM;

/** Distance from the job to the partner's live position, or their saved base when they have not pinged. */
export function providerDispatchDistanceKm(
  provider: {
    currentLocation?: { latitude: number; longitude: number } | null;
    baseLatitude: number | null;
    baseLongitude: number | null;
  },
  lat: number,
  lng: number,
): number | null {
  const loc = provider.currentLocation;
  const originLat = loc?.latitude ?? provider.baseLatitude;
  const originLng = loc?.longitude ?? provider.baseLongitude;
  return originLat != null && originLng != null ? distanceKm(lat, lng, originLat, originLng) : null;
}
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
    return (await this.runMatching(request, { persist: true, record: true })).matches;
  }

  /**
   * Phase 11 — the same match, with the hard-gate rejections that produced it.
   *
   * Read-only: never persists match scores, never dispatches, emits no rejection metrics (an admin
   * opening a diagnostics page must not move the dispatch dashboards). Used by
   * `GET /api/admin/bookings/:id/matching-diagnostics`; customers never see it.
   */
  async findBestProvidersWithDiagnostics(
    request: MatchingRequest,
    preview: { capabilityMode?: ServiceCapabilityMode; includeOffline?: boolean } = {},
  ): Promise<MatchingDiagnostics> {
    return this.runMatching(request, { persist: false, record: false, previewMode: preview.capabilityMode, includeOffline: preview.includeOffline === true });
  }

  /**
   * The one matching pipeline: candidate SQL -> batched loads -> hard gates in the mandated order
   * (`lib/matching-gates.ts`) -> score and sort the survivors with `compareRankedProviders`, exactly
   * as before. Gates run BEFORE scoring; nothing a gate refuses is ever ranked.
   */
  private async runMatching(
    request: MatchingRequest,
    opts: {
      persist: boolean;
      record: boolean;
      previewMode?: ServiceCapabilityMode;
      includeOffline?: boolean;
      /** Set only by the paid-dispatch widening pass. Prevents a second widening. */
      populationOverride?: Prisma.UserWhereInput;
    },
  ): Promise<MatchingDiagnostics> {
    // A capability-mode preview exists only for the read-only diagnostics. Dispatch (`persist`)
    // always runs in the mode the feature flag says; `findBestProviders` cannot pass a preview.
    if (opts.previewMode && (opts.persist || opts.record)) throw new Error("capability mode preview is diagnostics-only");
    // Evaluating offline partners is a diagnostics-only preview: it lets the strict-vs-legacy comparison
    // run over the real population when nobody is online (presence refuses them in both modes alike).
    // Dispatch is online-only, always.
    if (opts.includeOffline && (opts.persist || opts.record)) throw new Error("includeOffline preview is diagnostics-only");
    const startedAt = performance.now();
    const {
      serviceId,
      latitude,
      longitude,
      scheduledDate,
      maxResults = 10,
      maxDistanceKm = MAX_DISTANCE_DEFAULT_KM,
    } = request;

    const [population, gate, matchTokens, service] = await Promise.all([
      opts.populationOverride ?? this.candidatePopulation(request.customerId),
      loadServiceGateContext(serviceId, request.customerId, prisma, opts.previewMode ? { mode: opts.previewMode } : {}),
      resolveServiceMatchTokens(serviceId),
      prisma.service.findUnique({ where: { id: serviceId }, select: { isActive: true } }),
    ]);
    // Owner decision 2026-09-29: a service that is not offered (paused for missing method facts, archived,
    // deprecated) has no candidates — an existing booking of it is never offered to a partner; operations
    // handle those bookings. A new booking of it is already refused (assertBookable).
    const serviceOffered = service?.isActive === true;
    const providers = serviceOffered ? await this.loadCandidates(serviceId, { onlyOnline: !opts.includeOffline, population, gate, matchTokens }) : [];
    if (!serviceOffered && opts.record) incCounter("matching_service_not_offered_total");
    const widen = () => this.runMatching(request, { ...opts, populationOverride: dispatchFallbackWhere() });
    const finish = (matches: ProviderMatch[], rejections: MatchingRejection[]): MatchingDiagnostics => {
      const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const counts = countRejections(rejections);
      if (opts.record) {
        for (const [reason, n] of Object.entries(counts)) incCounter("matching_rejection_total", { reason }, n);
        observeHist("matching_latency_seconds", latencyMs / 1000);
        incCounter("matching_latency_ms_total", undefined, latencyMs);
        // Counts only: no provider, customer or address identifiers leave this function in a log line.
        logger.info("matching_decision", {
          category: "APPLICATION",
          candidates: providers.length,
          matched: matches.length,
          rejected: rejections.length,
          counts,
          latencyMs,
          serviceCapabilityMode: gate.mode,
          population: opts.populationOverride ? "widened" : "strict",
        });
      }
      return { matches, rejections, counts, latencyMs, candidateCount: providers.length, serviceCapabilityMode: gate.mode, serviceOffered };
    };
    // Strict SQL can be empty (every skilled partner is a seed account) or full of partners the
    // gates then refuse. When the owner has the seed fallback on, a real customer's paid job gets
    // one wider pass before we report nobody. Off (the default), business means business partners
    // only. The wider pass never runs when the strict pass already has a match.
    if (providers.length === 0) {
      if (!opts.populationOverride && serviceOffered && gate.seedPartnerFallback) return widen();
      return finish([], []);
    }

    const entitlements = request.customerId
      ? await entitlementService.resolve(request.customerId)
      : null;
    const isPremium = Boolean(entitlements?.hasMembership && entitlements.premiumAccess);

    const providerIds = providers.map((p) => p.id);
    // One batch per table for the whole candidate set - never per provider.
    const [conflicts, capacityMap, jobZones, presenceMap, evidenceMap, capabilityMap] = await Promise.all([
      this.loadConflictMap(providerIds, scheduledDate),
      partnerOperationsService.loadCapacityMap(providerIds, scheduledDate),
      geofenceService.findContaining(latitude, longitude, { zoneType: "SERVICE_ZONE" }).catch(() => []),
      dispatchEligibilityService.loadPresenceEvidence(providerIds),
      this.loadEvidenceMap(providerIds),
      loadCapabilityRows(providerIds),
    ]);
    const jobZoneNames = new Set(jobZones.map((z) => z.name.trim().toLowerCase()));

    const serviceRow = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { catalogConfig: true, version: true },
    });
    const catalog = await loadHydratedCatalog({ id: serviceId, catalogConfig: serviceRow?.catalogConfig });
    const weights = configuredMatchingWeights(catalog);
    const matchingConfigVersion = serviceRow?.version ?? 1;
    // Ranking only: a returning professional is preferred, never exempted from a gate.
    const preferred =
      catalog?.matching?.preferredProvider === true && request.customerId
        ? await this.loadReturningProviders(request.customerId, providerIds)
        : new Set<string>();

    // A job without a usable position cannot be shown to be inside anyone's area. Never matched
    // around an invented point (the assignment engine used to substitute central Mumbai).
    const jobLocated = Number.isFinite(latitude) && Number.isFinite(longitude);
    const now = new Date();
    // Only the widened pass, and only while the owner keeps the fallback on, treats a seed account as eligible.
    const seedIds = opts.populationOverride && gate.seedPartnerFallback ? await seedPartnerIds(providers) : new Set<string>();

    const matches: ProviderMatch[] = [];
    const rejections: MatchingRejection[] = [];
    for (const p of providers) {
      const capacityFull = capacityMap.get(p.id)?.capacityFull ?? false;
      const rawDistance = jobLocated ? this.rawDistanceKm(p, latitude, longitude) : null;
      // Seed/demo partners stay provenance-blocked on the strict pass. On the widened pass they
      // may take a real customer's job; suite fixtures are not in that pass at all.
      const seedDispatch = seedIds.has(p.id);
      const rejected = evaluateMatchingGates({
        providerIsBusiness: seedDispatch ? true : isBusinessRow(p.user.dataOrigin),
        bookingIsBusiness: gate.bookingIsBusiness,
        capability: capabilityRejections(
          capabilityMap.get(p.id) ?? EMPTY_CAPABILITY_ROWS,
          gate,
          this.legacyOffersService(p.serviceCategories, matchTokens, gate),
          now,
          p.user.dataOrigin,
          seedDispatch ? { seedVisible: true } : undefined,
        ),
        notAvailable: availabilityGate(this.scheduleOf(p), scheduledDate, now),
        location: !jobLocated
          ? "job_location_unknown"
          : distanceBoundGate(rawDistance == null ? null : round1(rawDistance), maxDistanceKm) ??
            serviceAreaGate(this.areaOf(p), rawDistance, jobZoneNames),
        presenceFresh: offerRequiresLivePresence(scheduledDate, now)
          ? passesPresenceLocationGate(presenceMap.get(p.id) ?? null, now)
          : true,
        capacityFull,
      });
      if (rejected.length > 0) {
        rejections.push({ providerId: p.id, reasons: rejected.map((r) => r.reason), details: rejected });
        continue;
      }
      matches.push(
        this.scoreProvider(p, latitude, longitude, scheduledDate, conflicts.get(p.id) ?? false, isPremium, {
          capacityFull,
          jobZoneNames,
          weights,
          matchingConfigVersion,
          evidence: evidenceMap.get(p.id) ?? NO_EVIDENCE,
          preferred: preferred.has(p.id),
        }),
      );
    }

    matches.sort(compareRankedProviders);
    const available = matches.slice(0, maxResults);

    if (available.length === 0 && !opts.populationOverride && serviceOffered && gate.seedPartnerFallback) {
      return widen();
    }

    if (opts.persist && request.customerId && available.length > 0) {
      void this.persistMatchScores({
        userId: request.customerId,
        serviceId,
        tier: entitlements?.tier ?? null,
        priorityScore: entitlements ? (entitlements.hasMembership ? 80 : 10) : 10,
        matches: available,
      }).catch(() => {});
    }

    return finish(available, rejections);
  }

  /**
   * Admin diagnostics for one booking: the match dispatch would compute for its service, address,
   * slot and customer, with every rejection. Nothing is dispatched or persisted. A booking whose
   * address has no coordinates is diagnosed as it is dispatched — every candidate fails
   * LOCATION_GATE_FAILED ("job_location_unknown"); no location is invented.
   */
  async diagnosticsForBooking(bookingId: string, preview: { capabilityMode?: ServiceCapabilityMode; includeOffline?: boolean } = {}) {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, serviceId: true, userId: true, scheduledDate: true, address: { select: { latitude: true, longitude: true } } },
    });
    if (!b) return null;
    const latitude = b.address?.latitude ?? Number.NaN;
    const longitude = b.address?.longitude ?? Number.NaN;
    const d = await this.findBestProvidersWithDiagnostics({
      serviceId: b.serviceId,
      customerId: b.userId,
      latitude,
      longitude,
      scheduledDate: b.scheduledDate,
      maxResults: 15,
    }, preview);
    return {
      bookingId: b.id,
      bookingStatus: b.status,
      /** True when the capability mode was supplied by the caller instead of read from the flag. */
      capabilityModePreviewed: preview.capabilityMode != null,
      /** True when offline partners were evaluated too (read-only preview; dispatch is online-only). */
      offlineIncluded: preview.includeOffline === true,
      jobLocated: Number.isFinite(latitude) && Number.isFinite(longitude),
      ...d,
      matches: d.matches.map((m) => ({ providerId: m.providerId, totalScore: m.totalScore, distance: m.distance, scoreBreakdown: m.scoreBreakdown, unknownSignals: m.unknownSignals })),
    };
  }

  /** The legacy String[] rule, evaluated in memory with the same tokens the candidate SQL used. */
  private legacyOffersService(serviceCategories: string[], tokens: ServiceMatchTokens | null, gate: ServiceGateContext): boolean {
    if (!tokens || !providerOffersService(serviceCategories, tokens)) return false;
    if (gate.mode === "LEGACY_FALLBACK" && gate.legacyRequiredSkills.length > 0) {
      return gate.legacyRequiredSkills.every((s) => serviceCategories.includes(s));
    }
    return true;
  }

  private rawDistanceKm(provider: ProviderForMatching, lat: number, lng: number): number | null {
    return providerDispatchDistanceKm(provider, lat, lng);
  }

  private scheduleOf(provider: ProviderForMatching) {
    return {
      isOnline: provider.isOnline,
      pausedAt: provider.pausedAt,
      workingDays: provider.workingDays,
      workingHoursStart: provider.workingHoursStart,
      workingHoursEnd: provider.workingHoursEnd,
      breakWindows: provider.breakWindows,
      timezone: provider.timezone,
    };
  }

  private areaOf(provider: ProviderForMatching) {
    return {
      serviceRadiusKm: provider.serviceRadiusKm,
      serviceRegions: provider.serviceRegions,
      hasOrigin: Boolean(provider.currentLocation) || (provider.baseLatitude != null && provider.baseLongitude != null),
    };
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
    const providers = await this.loadCandidates(serviceId, {
      onlyOnline: true,
      exclude: excludeProviderIds,
      population: await this.candidatePopulation(customerId),
    });
    if (providers.length === 0) return [];
    const now = new Date();
    const [capacityMap, jobZones, presenceMap, evidenceMap] = await Promise.all([
      partnerOperationsService.loadCapacityMap(
        providers.map((p) => p.id),
        now,
      ),
      geofenceService
        .findContaining(customerLocation.latitude, customerLocation.longitude, { zoneType: "SERVICE_ZONE" })
        .catch(() => []),
      dispatchEligibilityService.loadPresenceEvidence(providers.map((p) => p.id)),
      this.loadEvidenceMap(providers.map((p) => p.id)),
    ]);
    const jobZoneNames = new Set(jobZones.map((z) => z.name.trim().toLowerCase()));
    const serviceRow = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { catalogConfig: true, version: true },
    });
    const catalog = await loadHydratedCatalog({ id: serviceId, catalogConfig: serviceRow?.catalogConfig });
    const weights = configuredMatchingWeights(catalog);
    const matchingConfigVersion = serviceRow?.version ?? 1;
    return providers
      .map((p) =>
        this.scoreProvider(
          p,
          customerLocation.latitude,
          customerLocation.longitude,
          now,
          false,
          isPremium,
          {
            capacityFull: capacityMap.get(p.id)?.capacityFull ?? false,
            jobZoneNames,
            weights,
            matchingConfigVersion,
            evidence: evidenceMap.get(p.id) ?? NO_EVIDENCE,
          },
        ),
      )
      .filter((m) => {
        if (!m.availability) return false;
        const evidence = presenceMap.get(m.providerId) ?? null;
        return passesPresenceLocationGate(evidence, now);
      })
      .sort(compareRankedProviders);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Which partners a customer may be matched to, by provenance.
   *
   * A business customer (REAL, or UNKNOWN — which is how every row predating provenance reads) is
   * matched only to business partners. Measured 2026-09-21: 20 of the 57 matchable partners were
   * certification/test accounts (272 of 324 partners overall), and 9 bookings by non-fixture
   * customers had been assigned to one — four still ASSIGNED/ACCEPTED/EN_ROUTE with a partner who
   * does not exist. One fixture partner, left online by `whole-project-integration-cert.ts`, was the
   * only result `/api/providers/nearby` returned for central Bangalore.
   *
   * A fixture customer is left unrestricted, so certification suites that pair fixture customers
   * with fixture partners keep working. No customer id (an anonymous caller) is treated as business.
   *
   * Inert until the provenance backfill runs: with every `data_origin` NULL, every partner is
   * business and the candidate pool is unchanged.
   */
  /**
   * W2-D4 — the partner population a customer may be matched against. Symmetric.
   *
   * A business customer sees business partners; a non-business customer (fixture, test,
   * certification, synthetic — declared or inferred) sees ONLY non-business partners.
   *
   * It used to return NO filter at all for a non-business customer, so a certification run could be
   * matched to a REAL partner: the fixture booking then consumed that partner's real capacity, could
   * earn them a fixture rating, and entered their completion history. Measured on homigo_db before
   * this change: 4 synthetic-customer bookings assigned to real partners. The two worlds are now
   * disjoint at the one place a partner is chosen for a customer.
   *
   * Both halves of the population come from `analyticsWhere`, the single provenance policy; nothing
   * here restates which origins are business.
   */
  async candidatePopulation(customerId?: string): Promise<Prisma.UserWhereInput> {
    if (customerId) {
      const c = await prisma.user.findUnique({ where: { id: customerId }, select: { dataOrigin: true } });
      if (c && !isBusinessRow(c.dataOrigin)) return analyticsWhere("NON_BUSINESS") as Prisma.UserWhereInput;
    }
    return analyticsWhere() as Prisma.UserWhereInput;
  }

  /**
   * The providers qualified to perform a service — the SAME population dispatch matches against.
   *
   * Exposed for the availability projection (Wave 4), which must offer a slot only when a partner
   * who could actually take the job is free for it. A second "who can do this service" query would
   * drift from this one and start advertising slots dispatch cannot fill.
   */
  /**
   * The partners whose calendars back the availability projection.
   *
   * W2-D4: scoped to the SAME population matching uses for this customer. It used to load candidates
   * with no population at all, so the slots a real customer was shown could be backed entirely by
   * fixture partners — availability the platform could never actually honour.
   */
  async qualifiedProvidersForService(serviceId: string, customerId?: string, only?: string[]) {
    const [population, gate, matchTokens] = await Promise.all([
      this.candidatePopulation(customerId),
      loadServiceGateContext(serviceId, customerId),
      resolveServiceMatchTokens(serviceId),
    ]);
    const candidates = await this.loadCandidates(serviceId, { population, gate, matchTokens, only });
    // Phase 11: the provenance + capability gates dispatch applies. Presence, capacity and distance
    // are job-time facts and stay with dispatch; a slot must not be backed by a partner whose
    // credentials dispatch would refuse.
    const rows = candidates.length > 0 ? await loadCapabilityRows(candidates.map((p) => p.id)) : new Map();
    const now = new Date();
    const strict = candidates.filter(
      (p) =>
        isBusinessRow(p.user.dataOrigin) === gate.bookingIsBusiness &&
        capabilityRejections(rows.get(p.id) ?? EMPTY_CAPABILITY_ROWS, gate, this.legacyOffersService(p.serviceCategories, matchTokens, gate), now, p.user.dataOrigin).length === 0,
    );
    // Same widening as dispatch: a real customer whose strict pool cannot do the service may be
    // backed by an on-duty seed/demo partner. A fixture customer never reaches this branch.
    if (strict.length > 0 || !gate.bookingIsBusiness) return strict;
    return this.marketplaceSeedProviders(serviceId, gate, matchTokens, only, candidates.map((p) => p.id));
  }

  /**
   * Seed-domain partners (`@homigo.demo`) who can do the service, for a real customer's job whose
   * strict pool cannot. Fixture addresses are not included. Callers that already have a match must
   * not call this — a real partner must not lose the job to a seed account.
   */
  private async marketplaceSeedProviders(
    serviceId: string,
    gate: ServiceGateContext,
    matchTokens: ServiceMatchTokens | null,
    only: string[] | undefined,
    excludeIds: string[],
  ) {
    if (!gate.bookingIsBusiness || !gate.seedPartnerFallback) return [];
    const widened = await this.loadCandidates(serviceId, { population: dispatchFallbackWhere(), gate, matchTokens, only });
    const seen = new Set(excludeIds);
    const seedIds = await seedPartnerIds(widened);
    const extra = widened.filter((p) => !seen.has(p.id) && seedIds.has(p.id));
    if (extra.length === 0) return [];
    const now = new Date();
    const extraRows = await loadCapabilityRows(extra.map((p) => p.id));
    return extra.filter(
      (p) =>
        capabilityRejections(
          extraRows.get(p.id) ?? EMPTY_CAPABILITY_ROWS,
          gate,
          this.legacyOffersService(p.serviceCategories, matchTokens, gate),
          now,
          p.user.dataOrigin,
          { seedVisible: true },
        ).length === 0,
    );
  }

  /**
   * Who may back a slot or a broadcast checkout at this address.
   *
   * A partner in another city must not keep a Sunday open when someone near the address works
   * weekdays only. Seed accounts are added only when nobody in the strict pool is within the
   * dispatch radius. With no coordinates, or with nobody nearby at all, the strict list is returned
   * unchanged.
   */
  async providersReachableForAddress(
    serviceId: string,
    customerId: string | undefined,
    point: { lat: number; lng: number } | null,
    only?: string[],
  ) {
    const strict = await this.qualifiedProvidersForService(serviceId, customerId, only);
    if (!point) return strict;
    const nearby = (list: typeof strict) =>
      list.filter((p) => {
        const km = providerDispatchDistanceKm(p, point.lat, point.lng);
        return km != null && km <= MATCHING_MAX_DISTANCE_KM;
      });
    const strictNearby = nearby(strict);
    if (strictNearby.length > 0) return strictNearby;
    const [gate, matchTokens] = await Promise.all([
      loadServiceGateContext(serviceId, customerId),
      resolveServiceMatchTokens(serviceId),
    ]);
    const seedNearby = nearby(await this.marketplaceSeedProviders(serviceId, gate, matchTokens, only, strict.map((p) => p.id)));
    return seedNearby.length > 0 ? seedNearby : strict;
  }

  private async loadCandidates(
    serviceId: string,
    options: {
      onlyOnline?: boolean;
      exclude?: string[];
      /** Restrict to these provider ids (a customer-chosen partner) - same filters otherwise. */
      only?: string[];
      population?: Prisma.UserWhereInput;
      gate?: ServiceGateContext;
      matchTokens?: ServiceMatchTokens | null;
    } = {},
  ) {
    const maxCandidates = Number(process.env.MATCHING_MAX_CANDIDATES || 500);
    const matchTokens = options.matchTokens !== undefined ? options.matchTokens : await resolveServiceMatchTokens(serviceId);
    if (!matchTokens) return [];
    const gate = options.gate ?? (await loadServiceGateContext(serviceId, null));
    // The shared "offers this service" predicate (legacy String[] rule OR a typed ACTIVE capability).
    const offersWhere = await serviceOfferWhere(serviceId, { gate, matchTokens });
    if (!offersWhere) return [];
    const idFilter: Prisma.StringFilter = {
      ...(options.exclude && options.exclude.length > 0 ? { notIn: options.exclude } : {}),
      ...(options.only ? { in: options.only } : {}),
    };

    return prisma.provider.findMany({
      where: {
        ...offersWhere,
        ...DISPATCHABLE_PROVIDER_WHERE,
        // Population merged INTO the existing user filter. A second top-level `user` key would
        // replace `isBanned: false` rather than add to it (later keys win in an object literal),
        // silently letting banned partners back into the pool.
        user: { isBanned: false, ...(options.population ?? {}) },
        ...(options.onlyOnline ? { isOnline: true } : {}),
        ...(Object.keys(idFilter).length > 0 ? { id: idFilter } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, isBanned: true, dataOrigin: true, email: true, emailEncrypted: true } },
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

  /**
   * W2-D3 — the evidence behind each provider's stored rates, counted from real bookings.
   *
   * `completionRate` and `responseRate` are stored without their denominators, and both have
   * no-evidence defaults that look like measurements (0 and — from rating.service — 100). So the
   * sample sizes are counted here, in ONE grouped query per call over a bounded candidate set,
   * rather than trusted or fetched per provider.
   *
   * Not a schema change on purpose: the live backend hot-reloads this code against a database that
   * would not have new columns, and a regenerated client selecting a missing column would take
   * matching down. Counting at match time needs no migration at all.
   */
  private async loadEvidenceMap(providerIds: string[]): Promise<Map<string, ProviderEvidence>> {
    const out = new Map<string, ProviderEvidence>();
    if (providerIds.length === 0) return out;
    const since = new Date(Date.now() - RESPONSE_WINDOW_DAYS * 86_400_000);
    /**
     * W2-D4: a booking is evidence for a partner only when its customer is from the partner's own
     * population. A certification booking assigned to a real partner (4 such on homigo_db) must not
     * become that partner's completion or response history. Both sides use the one provenance
     * predicate from `analytics-scope`; the strings are constants, never caller input.
     */
    const sameWorld = Prisma.raw(`${analyticsSqlPredicate("cu")} = ${analyticsSqlPredicate("pu")}`);
    const rows = await prisma.$queryRaw<Array<{ provider_id: string; terminal_jobs: bigint; recent_jobs: bigint }>>`
      SELECT b.provider_id,
             COUNT(*) FILTER (WHERE b.status IN ('COMPLETED','CANCELLED_BY_PROVIDER','CANCELLED_BY_USER',
                                                 'CUSTOMER_NO_SHOW','PROVIDER_NO_SHOW')) AS terminal_jobs,
             COUNT(*) FILTER (WHERE b.created_at >= ${since}) AS recent_jobs
      FROM bookings b
      JOIN users cu ON cu.id = b.user_id
      JOIN providers p ON p.id = b.provider_id
      JOIN users pu ON pu.id = p.user_id
      WHERE b.provider_id = ANY(${providerIds})
        AND ${sameWorld}
      GROUP BY b.provider_id
    `;
    for (const r of rows) {
      out.set(r.provider_id, { terminalJobs: Number(r.terminal_jobs), recentJobs: Number(r.recent_jobs) });
    }
    return out;
  }

  /** Candidates who have already completed a job for this customer. One query for the whole set. */
  private async loadReturningProviders(customerId: string, providerIds: string[]): Promise<Set<string>> {
    if (providerIds.length === 0) return new Set();
    const rows = await prisma.booking.findMany({
      where: { userId: customerId, status: "COMPLETED", providerId: { in: providerIds } },
      select: { providerId: true },
      distinct: ["providerId"],
    });
    return new Set(rows.flatMap((r) => (r.providerId ? [r.providerId] : [])));
  }

  private scoreProvider(
    provider: ProviderForMatching,
    customerLat: number,
    customerLng: number,
    scheduledDate: Date,
    hasConflict: boolean,
    isPremiumCustomer = false,
    extras?: {
      capacityFull?: boolean;
      jobZoneNames?: Set<string>;
      weights?: ReturnType<typeof configuredMatchingWeights>;
      matchingConfigVersion?: number;
      evidence?: ProviderEvidence;
      preferred?: boolean;
    },
  ): ProviderMatch {
    const loc = provider.currentLocation;
    const originLat = loc?.latitude ?? provider.baseLatitude;
    const originLng = loc?.longitude ?? provider.baseLongitude;
    // W2-D3: unknown position is `null`, never an invented 15 km.
    const distance: number | null =
      originLat != null && originLng != null
        ? distanceKm(customerLat, customerLng, originLat, originLng)
        : null;
    const evidence = extras?.evidence ?? NO_EVIDENCE;

    const ratingScore = ratingPoints(provider.rating, provider.totalReviews);
    const distanceScore = distancePoints(distance, MAX_DISTANCE_DEFAULT_KM);
    const availabilityScore = this.calculateAvailabilityScore(
      provider,
      scheduledDate,
      hasConflict,
      extras,
      distance,
    );
    const responseScore = responsePoints(provider.responseRate, provider.avgResponseTime, evidence);
    const completionScore = completionPoints(provider.completionRate, evidence);

    // Phase C — premium ranking: higher-rated providers ranked first for members.
    let premiumBoost = 0;
    if (isPremiumCustomer) {
      // W2-D3: the rating tiers apply only to a rating with enough reviews behind it - the same
      // evidence rule as the rating signal. A stored 5.0 over one review is not a 5.0 provider.
      if (ratingScore != null) {
        if (provider.rating >= 4.8) premiumBoost += 12;
        else if (provider.rating >= 4.5) premiumBoost += 8;
        else if (provider.rating >= 4.0) premiumBoost += 4;
      }
      if (provider.isOnline) premiumBoost += 3;
    }

    const careerBoost = careerPriorityBoost(provider.careerLevel, {
      lifecycleState: provider.lifecycleState,
      complianceRestricted: provider.complianceRestricted,
    });

    /**
     * W2-D3: one normalisation for both the configured-weights and default paths, over the signals
     * that are KNOWN. With every signal known and default weights this equals the old additive sum,
     * so providers with real history rank exactly as before; an unknown signal is excluded rather
     * than invented (old behaviour) or zeroed (which would punish having no history).
     */
    const signals: SignalScores = {
      rating: ratingScore,
      distance: distanceScore,
      availability: availabilityScore,
      response: responseScore,
      completion: completionScore,
    };
    const coreScore = normalisedMatchScore(signals, extras?.weights ?? DEFAULT_SIGNAL_WEIGHTS);

    const preferredBoost = extras?.preferred ? PREFERRED_PROVIDER_BOOST : 0;
    const totalScore = round1(coreScore + premiumBoost + careerBoost + preferredBoost);

    return {
      providerId: provider.id,
      name:
        provider.businessName ||
        `${provider.user.firstName} ${provider.user.lastName}`.trim(),
      rating: provider.rating,
      totalReviews: provider.totalReviews,
      // Unknown position => no distance and NO ETA. An ETA built on an invented distance was
      // shown to customers as if it were real.
      distance: distance == null ? null : round1(distance),
      eta: distance == null ? null : etaMinutes(distance),
      totalScore,
      scoreBreakdown: {
        ratingScore: ratingScore == null ? null : round1(ratingScore),
        distanceScore: distanceScore == null ? null : round1(distanceScore),
        availabilityScore: round1(availabilityScore),
        responseScore: responseScore == null ? null : round1(responseScore),
        completionScore: completionScore == null ? null : round1(completionScore),
      },
      unknownSignals: unknownSignals(signals),
      isOnline: provider.isOnline,
      availableNow: true,
      availabilityLabel: "Available now" as const,
      availability: availabilityScore > 0,
      profileImage: provider.profileImage,
      premiumBoost: isPremiumCustomer ? round1(premiumBoost) : undefined,
      careerPriorityBoost: careerBoost > 0 ? careerBoost : undefined,
      preferredProviderBoost: preferredBoost > 0 ? preferredBoost : undefined,
      matchingConfigVersion: extras?.matchingConfigVersion,
    };
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
    // W2-D3: this defaulted to 15 as well, a second invented distance hidden in a parameter list.
    distanceKmValue: number | null = null,
  ): number {
    // The SAME predicates the hard gates use (lib/matching-gates.ts) - the score cannot drift from them.
    if (availabilityGate(this.scheduleOf(provider), scheduledDate)) return 0;
    if (extras?.capacityFull) return 0;
    if (serviceAreaGate(this.areaOf(provider), distanceKmValue, extras?.jobZoneNames)) return 0;

    return hasConflict ? 10 : 20;
  }


}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const matchingService = new MatchingService();
