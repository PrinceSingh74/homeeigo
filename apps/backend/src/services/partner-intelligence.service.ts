import prisma from "../lib/prisma";
import { LOCATION_FRESH_SEC } from "../lib/partner-presence.config";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { weatherService } from "./weather.service";
import { partnerOsService } from "./partner-os.service";
import { providerService } from "./provider.service";
import {
  signalMissing,
  signalOk,
  type DemandOutlook,
  type EarningsSnapshot,
  type JobsSnapshot,
  type LocationFreshnessState,
  type PartnerIntelligenceContext,
  type PartnerLocation,
  type PerformanceSnapshot,
  type Signal,
  type WeatherNow,
  type ZoneCandidate,
  type ZoneSupply,
  type ZoneSurge,
} from "./partner-intelligence.types";

/**
 * Partner Intelligence — signal aggregation.
 *
 * This service GATHERS and NORMALISES authoritative signals. It does not rank zones, coach
 * earnings, plan shifts or decide nudges: those are separate services that consume this one. The
 * separation is the point — if aggregation also ranked, every consumer would silently inherit one
 * service's opinion of "best", and the ranking could not be changed without touching collection.
 *
 * Nothing here computes a business signal that already has an owner. Demand comes from the demand
 * model, surge from the deterministic surge service, weather from the weather service, earnings and
 * performance from partner-os. This layer's only original logic is location freshness grading and
 * distance-to-zone, both documented below and versioned.
 */

/**
 * Version of THIS layer's deterministic rules (freshness thresholds, candidate assembly).
 * Bump when a threshold or the shape of a derived field changes, so a stored explanation can be
 * traced back to the logic that produced it.
 */
export const PARTNER_INTELLIGENCE_RULES_VERSION = "pi.rules.v1";

/**
 * Location freshness thresholds.
 *
 * `LIVE` is anchored to the platform's OWN existing definition of presence, imported from
 * `partner-presence.config` rather than restated: a provider counts as online for that window after
 * a ping (tracking.service uses the same constant), and the partner app pings
 * on a 10s / 25m cadence. So a fix inside 60s is genuinely live rather than an invented threshold.
 * The wider bands are this layer's rules, deliberately conservative, and versioned above.
 *
 * A location past `EXPIRED_S` is not returned as a value at all — describing an hour-old fix as
 * "where you are" is how a partner gets sent to the wrong zone.
 */
/**
 * Imported, not restated. The comment above has always said this band is anchored to the platform's
 * presence window; it said so while hardcoding the number, so the anchor could drift without anyone
 * noticing. The wider RECENT/STALE bands below remain this layer's own advisory rules.
 */
const LOCATION_LIVE_S = LOCATION_FRESH_SEC;
const LOCATION_RECENT_S = 10 * 60;
const LOCATION_STALE_S = 60 * 60;

function gradeLocationAge(ageSeconds: number): LocationFreshnessState {
  if (ageSeconds <= LOCATION_LIVE_S) return "LIVE";
  if (ageSeconds <= LOCATION_RECENT_S) return "RECENT";
  if (ageSeconds <= LOCATION_STALE_S) return "STALE";
  return "EXPIRED";
}

/** Haversine. Straight-line only — travel time is the route service's job, not this one's. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * 10) / 10;
}

/**
 * Run a collector, turning any failure into an explicit signal state.
 *
 * The geo-intel `intel()` wrapper THROWS when its source is down (it records an error metric and
 * rethrows rather than degrading). Letting that propagate would mean one unavailable model fails
 * the partner's whole context, so every collector is isolated: the request degrades a section, not
 * itself.
 */
async function collect<T>(
  fallbackState: "UNAVAILABLE" | "MODEL_UNAVAILABLE",
  reasonCode: string,
  fn: () => Promise<Signal<T>>,
): Promise<Signal<T>> {
  try {
    return await fn();
  } catch {
    return signalMissing<T>(fallbackState, reasonCode);
  }
}

class PartnerIntelligenceService {
  /**
   * Assemble the canonical context for ONE partner.
   *
   * `providerId` must already have been resolved from the authenticated actor by the caller —
   * routes use `requireProvider()`, tools use `resolveProviderId(actor.actorId)`. This service
   * never accepts an identity from a request body, a query string or a tool argument, and it does
   * no ownership check of its own precisely because it must never be the place where one is
   * forgotten: it is only ever given an id the auth layer already proved.
   */
  async getContext(providerId: string, opts?: { demandHorizonHours?: number }): Promise<PartnerIntelligenceContext | null> {
    const horizon = Math.max(1, Math.min(168, opts?.demandHorizonHours ?? 24));
    const now = new Date();

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        businessName: true,
        city: true,
        isActive: true,
        isOnline: true,
        currentLocation: { select: { latitude: true, longitude: true, accuracy: true, lastUpdated: true } },
        user: { select: { preferredCity: true } },
      },
    });
    if (!provider) return null;

    const location = this.buildLocation(provider.currentLocation, now);
    const coords =
      location.state === "OK" && location.value
        ? { lat: location.value.latitude, lng: location.value.longitude }
        : null;

    /**
     * Collectors run concurrently and independently. Each is already cached by its owning service
     * (geo-intel uses an L1/L2 cache), so this is a fixed, bounded set of calls — not a per-zone
     * fan-out. No N+1: zone data arrives as whole snapshots and is joined in memory below.
     */
    const [demand, supply, surge, weather, jobs, earnings, performance] = await Promise.all([
      collect<DemandOutlook>("MODEL_UNAVAILABLE", "DEMAND_MODEL_UNAVAILABLE", () => this.buildDemand(horizon)),
      collect<ZoneSupply[]>("UNAVAILABLE", "SUPPLY_UNAVAILABLE", () => this.buildSupply()),
      collect<ZoneSurge[]>("UNAVAILABLE", "SURGE_UNAVAILABLE", () => this.buildSurge()),
      collect<WeatherNow>("UNAVAILABLE", "WEATHER_UNAVAILABLE", () => this.buildWeather(coords)),
      collect<JobsSnapshot>("UNAVAILABLE", "JOBS_UNAVAILABLE", () => this.buildJobs(providerId, now)),
      collect<EarningsSnapshot>("UNAVAILABLE", "EARNINGS_UNAVAILABLE", () => this.buildEarnings(providerId)),
      collect<PerformanceSnapshot>("UNAVAILABLE", "PERFORMANCE_UNAVAILABLE", () => this.buildPerformance(providerId)),
    ]);

    const zoneCandidates = await collect<ZoneCandidate[]>("UNAVAILABLE", "ZONE_CANDIDATES_UNAVAILABLE", () =>
      this.buildZoneCandidates(coords, supply, surge),
    );

    return {
      partner: {
        providerId: provider.id,
        businessName: provider.businessName,
        city: provider.city ?? provider.user?.preferredCity ?? null,
        isActive: provider.isActive,
        isOnline: provider.isOnline,
      },
      location,
      demand,
      supply,
      surge,
      weather,
      jobs,
      earnings,
      performance,
      zoneCandidates,
      generatedAt: now.toISOString(),
      versions: {
        rulesVersion: PARTNER_INTELLIGENCE_RULES_VERSION,
        models: {
          // Reported only when the model actually answered — never asserted.
          demand: demand.state === "OK" ? (demand.source ?? null) : null,
        },
      },
    };
  }

  // ---- collectors -------------------------------------------------------------------------

  private buildLocation(
    row: { latitude: number; longitude: number; accuracy: number | null; lastUpdated: Date } | null,
    now: Date,
  ): Signal<PartnerLocation> {
    if (!row) return signalMissing<PartnerLocation>("UNAVAILABLE", "NO_LOCATION_ON_FILE", "db:locations");

    const ageSeconds = Math.max(0, Math.round((now.getTime() - row.lastUpdated.getTime()) / 1000));
    const freshnessState = gradeLocationAge(ageSeconds);

    // An expired fix is withheld rather than aged-and-returned: past an hour it is not evidence of
    // where the partner is, and a downstream distance computed from it would look authoritative.
    if (freshnessState === "EXPIRED") {
      return {
        ...signalMissing<PartnerLocation>("STALE", "LOCATION_EXPIRED", "db:locations"),
        observedAt: row.lastUpdated.toISOString(),
      };
    }

    return signalOk<PartnerLocation>(
      {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyMeters: row.accuracy,
        updatedAt: row.lastUpdated.toISOString(),
        ageSeconds,
        freshnessState,
      },
      "db:locations",
      row.lastUpdated.toISOString(),
      freshnessState === "LIVE" ? "REAL_TIME" : "NEAR_REAL_TIME",
    );
  }

  private async buildDemand(horizonHours: number): Promise<Signal<DemandOutlook>> {
    const res = await geoIntelligenceService.demandForecast(horizonHours);
    const data = res.data as { horizonHours?: number; totalPredicted?: number; points?: unknown[] } | null;
    if (!data || !Array.isArray(data.points) || data.points.length === 0) {
      return signalMissing<DemandOutlook>("INSUFFICIENT_DATA", "DEMAND_NO_POINTS", res.source ?? null);
    }
    return signalOk<DemandOutlook>(
      {
        horizonHours: data.horizonHours ?? horizonHours,
        totalPredicted: data.totalPredicted ?? 0,
        points: data.points,
      },
      res.source ?? "bigquery:arima_plus",
      res.freshness ?? null,
      "FORECAST",
      res.confidence ?? null,
    );
  }

  private async buildSupply(): Promise<Signal<ZoneSupply[]>> {
    const res = await geoIntelligenceService.providerDensity();
    const rows = (res.data as ZoneSupply[] | null) ?? [];
    if (rows.length === 0) return signalMissing<ZoneSupply[]>("INSUFFICIENT_DATA", "NO_ZONES", res.source ?? null);
    return signalOk<ZoneSupply[]>(rows, res.source ?? "postgres", res.freshness ?? null, "NEAR_REAL_TIME", res.confidence ?? null);
  }

  private async buildSurge(): Promise<Signal<ZoneSurge[]>> {
    const res = await geoIntelligenceService.surgePrediction();
    const raw = (res.data as { zones?: ZoneSurge[] } | ZoneSurge[] | null) ?? null;
    const rows = Array.isArray(raw) ? raw : (raw?.zones ?? []);
    if (rows.length === 0) return signalMissing<ZoneSurge[]>("INSUFFICIENT_DATA", "NO_SURGE_ZONES", res.source ?? null);
    return signalOk<ZoneSurge[]>(rows, res.source ?? "deterministic:surge", res.freshness ?? null, "NEAR_REAL_TIME", res.confidence ?? null);
  }

  private async buildWeather(coords: { lat: number; lng: number } | null): Promise<Signal<WeatherNow>> {
    // Weather is location-specific: with no usable fix there is nothing to report, and the
    // partner's city centre is a guess dressed as an observation.
    if (!coords) return signalMissing<WeatherNow>("UNAVAILABLE", "NO_LOCATION_FOR_WEATHER", "openweather");

    const snap = await weatherService.getByCoords(coords.lat, coords.lng);
    if (!snap) return signalMissing<WeatherNow>("UNAVAILABLE", "WEATHER_PROVIDER_NO_DATA", "openweather");

    const s = snap as unknown as { condition?: string; temperature?: number; temp?: number; severity?: string; observedAt?: string };
    return signalOk<WeatherNow>(
      {
        condition: s.condition ?? null,
        temperatureC: s.temperature ?? s.temp ?? null,
        severity: s.severity ?? null,
        surgeMultiplier: weatherService.surgeMultiplier(snap),
        etaAdjustmentFactor: weatherService.etaAdjustmentFactor(snap),
      },
      "openweather",
      s.observedAt ?? null,
      "NEAR_REAL_TIME",
    );
  }

  private async buildJobs(providerId: string, now: Date): Promise<Signal<JobsSnapshot>> {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    const [assigned, todayCompletedCount] = await Promise.all([
      prisma.booking.findMany({
        where: { providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
        select: { id: true, status: true, scheduledDate: true },
        orderBy: { scheduledDate: "asc" },
        take: 20,
      }),
      prisma.booking.count({ where: { providerId, status: "COMPLETED", createdAt: { gte: dayStart } } }),
    ]);

    return signalOk<JobsSnapshot>(
      {
        activeCount: assigned.length,
        todayCompletedCount,
        assigned: assigned.map((b) => ({
          bookingId: b.id,
          status: b.status,
          scheduledDate: b.scheduledDate ? b.scheduledDate.toISOString() : null,
        })),
      },
      "db:bookings",
      now.toISOString(),
      "REAL_TIME",
    );
  }

  private async buildEarnings(providerId: string): Promise<Signal<EarningsSnapshot>> {
    const [forecast, summary] = await Promise.all([
      partnerOsService.getForecast(providerId),
      providerService.myEarningsSummary(providerId, 30),
    ]);

    const weekState = forecast.basis.weeklyProjection.state;
    const monthState = forecast.basis.monthlyProjection.state;

    // No trailing history at all is a real state, not a row of zeroes: a partner with no earnings
    // yet must not be coached from numbers that only look like data.
    if (weekState === "INSUFFICIENT_HISTORY" && monthState === "INSUFFICIENT_HISTORY") {
      return signalMissing<EarningsSnapshot>("INSUFFICIENT_DATA", "NO_EARNINGS_HISTORY", "db:earnings");
    }

    return signalOk<EarningsSnapshot>(
      {
        todayRealised: forecast.inputs.todayEarnings,
        trailing7dRealised: forecast.weeklyProjection,
        trailing30dRealised: forecast.monthlyProjection,
        averagePerJob: summary.averagePerJob ?? 0,
        averageNetPerJob: summary.averageNetPerJob ?? 0,
        // Carried through only because Item 0 established it is genuinely model-backed.
        todayOpportunity: forecast.todayProjection,
      },
      "db:earnings",
      forecast.basis.weeklyProjection.asOf,
      "HISTORICAL",
      forecast.basis.todayProjection.confidence ?? null,
    );
  }

  private async buildPerformance(providerId: string): Promise<Signal<PerformanceSnapshot>> {
    const p = await partnerOsService.getPerformanceSummary(providerId, 90);
    if (!p) return signalMissing<PerformanceSnapshot>("UNAVAILABLE", "PROVIDER_NOT_FOUND", "db:provider_counters");

    // Rates exist as stored counters from the first job onward, so they are always "present" —
    // but a completion rate over two jobs is not a fact about a partner. The sample size travels
    // with the value so consumers can refuse to draw a trend, rather than each of them guessing.
    return signalOk<PerformanceSnapshot>(
      {
        rating: p.performance.rating,
        totalRatings: p.performance.totalRatings,
        completionRate: p.performance.completionRate,
        acceptanceRate: p.performance.acceptanceRate,
        cancellationRate: p.performance.cancellationRate,
        responseRate: p.performance.responseRate,
        avgResponseTimeMinutes: p.performance.avgResponseTimeMinutes,
        sampleSize: p.basis.sampleSize,
      },
      "db:provider_counters",
      p.basis.asOf,
      "HISTORICAL",
    );
  }

  /**
   * Canonical zone candidates — joined, NOT ranked.
   *
   * Assembled from snapshots already fetched above plus the platform's existing zone scoring, whose
   * components (`earningScore`, `demandScore`, `serviceHealth`) are carried through unchanged so a
   * downstream ranker can cite them as reasons instead of inventing its own.
   */
  private async buildZoneCandidates(
    coords: { lat: number; lng: number } | null,
    supply: Signal<ZoneSupply[]>,
    surge: Signal<ZoneSurge[]>,
  ): Promise<Signal<ZoneCandidate[]>> {
    const scoring = await geoIntelligenceService.zoneScoring();
    // `zoneScoring().data` is an OBJECT — `{ ranked, bestEarning, worstService, highRisk }` — not an
    // array. Verified against the running service rather than assumed; the ranked list is the one
    // that carries every zone with its score components.
    const scored = ((scoring.data as { ranked?: Array<{
      zoneId: string; name: string; city: string | null;
      compositeScore?: number; demandScore?: number; earningScore?: number; serviceHealth?: number;
    }> } | null)?.ranked) ?? [];
    if (scored.length === 0) {
      return signalMissing<ZoneCandidate[]>("INSUFFICIENT_DATA", "NO_SCORED_ZONES", scoring.source ?? null);
    }

    // In-memory joins over whole snapshots — no per-zone query.
    const supplyById = new Map((supply.value ?? []).map((s) => [s.zoneId, s]));
    const surgeById = new Map((surge.value ?? []).map((s) => [s.zoneId, s]));

    const candidates: ZoneCandidate[] = scored.map((z) => {
      const sup = supplyById.get(z.zoneId) ?? null;
      const sur = surgeById.get(z.zoneId) ?? null;
      // Centres live on the density snapshot (verified: it carries centerLat/centerLng); the
      // scoring rows do not. A zone missing from that snapshot yields a null distance rather than
      // a (0,0) centre, which would place every such zone off the coast of Africa.
      const centre = sup as unknown as { centerLat?: number; centerLng?: number } | null;
      const hasCentre = typeof centre?.centerLat === "number" && typeof centre?.centerLng === "number";
      const centerLat = hasCentre ? centre!.centerLat! : 0;
      const centerLng = hasCentre ? centre!.centerLng! : 0;

      return {
        zoneId: z.zoneId,
        name: z.name,
        city: z.city,
        centerLat,
        centerLng,
        // Distance needs both a partner fix and a zone centre; without either it stays null rather
        // than defaulting to 0, which would read as "you are already there".
        distanceKm: coords && hasCentre ? distanceKm(coords.lat, coords.lng, centerLat, centerLng) : null,
        supply: sup?.providers ?? null,
        densityPerKm2: sup?.densityPerKm2 ?? null,
        predictedSurge: sur?.predictedSurge ?? null,
        platformScore: z.compositeScore ?? null,
        demandScore: z.demandScore ?? null,
        earningScore: z.earningScore ?? null,
        serviceHealth: z.serviceHealth ?? null,
      };
    });

    return signalOk<ZoneCandidate[]>(
      candidates,
      scoring.source ?? "postgres",
      scoring.freshness ?? null,
      "NEAR_REAL_TIME",
      scoring.confidence ?? null,
    );
  }
}

export const partnerIntelligenceService = new PartnerIntelligenceService();
