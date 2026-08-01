/**
 * HOMIGO Geo-Intelligence Service — the unified intelligence layer consumed by the
 * Customer app, Partner app, Admin command center and Grafana.
 *
 * Real data only:
 *   PostgreSQL (live ops) · BigQuery (warehouse + ARIMA) · Vertex AI · Weather API · Google Maps
 *
 * Every method returns an `IntelResult<T>` carrying a confidence score (0–1) and a data
 * freshness timestamp, is wrapped in the L1+L2 cache, and emits Prometheus telemetry.
 *
 * Scale note: all zone math runs over the geofence set (tens–hundreds), not per-provider,
 * and heavy aggregates are cached — so this stays flat as customers/providers grow toward
 * the 1M/100k/50-city target. Per-endpoint TTLs below tune freshness vs. cost.
 */
import type { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { cacheService } from "./cache.service";
import { weatherService } from "./weather.service";
import { mapsService } from "./maps.service";
import { distanceKm } from "../lib/geo";
import { incCounter, observeHist } from "../lib/metrics";
import { forecastDemand, detectFakeGps, predictEta as bqPredictEta } from "./vertex-ai.service";

export interface IntelResult<T> {
  data: T;
  /** Model/heuristic confidence in [0,1]. */
  confidence: number;
  /** ISO timestamp of the underlying data (live = now; warehouse = ETL load time). */
  freshness: string;
  /** Provenance: postgres | bigquery | vertex | weather | google | computed (+combos). */
  source: string;
  cached: boolean;
  generatedAt: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ACTIVE_BOOKING: BookingStatus[] = ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as BookingStatus[];

/** Telemetry + cache wrapper used by every endpoint. */
async function intel<T>(
  cacheKey: string,
  ttlSec: number,
  build: () => Promise<Omit<IntelResult<T>, "cached" | "generatedAt">>,
  l1Sec = 5,
): Promise<IntelResult<T>> {
  const t0 = Date.now();
  // Stable, bounded metric label (strip any per-request suffix like horizon/coords from the
  // cache key) — keeps Prometheus cardinality to the fixed set of endpoints.
  const endpoint = cacheKey.split(":")[0];
  incCounter("geo_intel_requests_total", { endpoint });
  try {
    let cached = true;
    const core = await cacheService.getOrFetch(
      `geo-intel:${cacheKey}`,
      ttlSec,
      async () => {
        cached = false;
        return build();
      },
      l1Sec,
    );
    return { ...core, cached, generatedAt: new Date().toISOString() };
  } catch (err) {
    incCounter("geo_intel_errors_total", { endpoint });
    throw err;
  } finally {
    observeHist("geo_intel_latency_seconds", (Date.now() - t0) / 1000, { endpoint });
  }
}

// ---- Shared zone snapshot (loaded once, reused by density/demand/surge/scoring) ----
type ZoneAgg = {
  zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; radiusMeters: number;
  baseSurge: number; supply: number; demand24h: number; revenue24h: number; activeBookings: number; areaKm2: number;
};

function inside(lat: number, lng: number, z: { centerLat: number; centerLng: number; radiusMeters: number }): boolean {
  return distanceKm(lat, lng, z.centerLat, z.centerLng) * 1000 <= z.radiusMeters;
}

async function buildZoneSnapshot(): Promise<ZoneAgg[]> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [zones, providerLocs, recentBookings, activeBookings] = await Promise.all([
    prisma.geofence.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true, centerLat: true, centerLng: true, radiusMeters: true, surgeMultiplier: true } }),
    prisma.location.findMany({ where: { provider: { isOnline: true } }, select: { latitude: true, longitude: true } }),
    prisma.booking.findMany({ where: { createdAt: { gte: since } }, select: { totalAmount: true, status: true, address: { select: { latitude: true, longitude: true } } } }),
    prisma.booking.findMany({ where: { status: { in: ACTIVE_BOOKING } }, select: { address: { select: { latitude: true, longitude: true } } } }),
  ]);
  return zones.map((z) => {
    const supply = providerLocs.filter((p) => inside(p.latitude, p.longitude, z)).length;
    let demand24h = 0, revenue24h = 0;
    for (const b of recentBookings) {
      if (!b.address || !inside(b.address.latitude, b.address.longitude, z)) continue;
      demand24h++;
      if (b.status === "COMPLETED") revenue24h += b.totalAmount ?? 0;
    }
    const active = activeBookings.filter((b) => b.address && inside(b.address.latitude, b.address.longitude, z)).length;
    const areaKm2 = Math.PI * Math.pow(z.radiusMeters / 1000, 2);
    return {
      zoneId: z.id, name: z.name, city: z.city, centerLat: z.centerLat, centerLng: z.centerLng, radiusMeters: z.radiusMeters,
      baseSurge: z.surgeMultiplier ?? 1, supply, demand24h, revenue24h, activeBookings: active, areaKm2,
    };
  });
}

export class GeoIntelligenceService {
  // 1) DEMAND FORECAST (BigQuery ARIMA) — multi-horizon (1/6/24/168h) ----------
  async demandForecast(horizonHours = 24): Promise<IntelResult<unknown>> {
    const h = clamp(Math.round(horizonHours), 1, 168);
    return intel(`demand-forecast:${h}`, 300, async () => {
      const points = await forecastDemand(h);
      // confidence = inverse of mean relative CI width across points.
      const rel = points.length
        ? points.reduce((s, p) => s + (p.hi - p.lo) / (2 * Math.max(p.predicted, 1)), 0) / points.length
        : 1;
      return {
        data: { horizonHours: h, points, totalPredicted: Math.round(points.reduce((s, p) => s + Math.max(0, p.predicted), 0) * 10) / 10 },
        confidence: clamp(1 - rel, 0.5, 0.97),
        freshness: new Date().toISOString(),
        source: "bigquery:arima_plus",
      };
    }, 30);
  }

  // 2) SURGE PREDICTION — weather surge × demand/supply pressure per zone -------
  async surgePrediction(): Promise<IntelResult<unknown>> {
    return intel("surge-prediction", 120, async () => {
      const zones = await buildZoneSnapshot();
      const enriched = await Promise.all(
        zones.map(async (z) => {
          const snap = await weatherService.getByCoords(z.centerLat, z.centerLng).catch(() => null);
          const weatherSurge = weatherService.surgeMultiplier(snap);
          // demand pressure: active demand vs available supply (clamped).
          const pressure = z.supply > 0 ? z.activeBookings / z.supply : z.activeBookings > 0 ? 2 : 1;
          const demandSurge = clamp(1 + (pressure - 1) * 0.4, 1, 2.5);
          const predictedSurge = Math.round(clamp(z.baseSurge * weatherSurge * demandSurge, 1, 3) * 100) / 100;
          const demandDeltaPct = z.supply > 0 ? Math.round((pressure - 1) * 100) : null;
          return { zoneId: z.zoneId, name: z.name, city: z.city, supply: z.supply, activeBookings: z.activeBookings, weatherSurge, predictedSurge, demandDeltaPct };
        }),
      );
      const hasWeather = enriched.some((e) => e.weatherSurge !== 1);
      return {
        data: enriched.sort((a, b) => b.predictedSurge - a.predictedSurge),
        confidence: hasWeather ? 0.85 : 0.7,
        freshness: new Date().toISOString(),
        source: "postgres+weather+computed",
      };
    });
  }

  // 3) DYNAMIC ZONE SCORING — rank zones (earning / service / risk) -------------
  async zoneScoring(): Promise<IntelResult<unknown>> {
    return intel("zone-scoring", 180, async () => {
      const zones = await buildZoneSnapshot();
      const maxRev = Math.max(1, ...zones.map((z) => z.revenue24h));
      const maxDem = Math.max(1, ...zones.map((z) => z.demand24h));
      const scored = zones.map((z) => {
        const earning = (z.revenue24h / maxRev) * 100;
        const demandScore = (z.demand24h / maxDem) * 100;
        // service health: supply able to meet active demand (1 = healthy, 0 = starved).
        const serviceHealth = z.activeBookings === 0 ? 100 : clamp((z.supply / z.activeBookings) * 100, 0, 100);
        // risk: high demand + low supply ⇒ high operational risk.
        const risk = clamp(demandScore - serviceHealth + (z.supply === 0 && z.demand24h > 0 ? 40 : 0), 0, 100);
        const composite = Math.round(earning * 0.4 + demandScore * 0.3 + serviceHealth * 0.3);
        return {
          zoneId: z.zoneId, name: z.name, city: z.city, supply: z.supply, demand24h: z.demand24h, revenue24h: Math.round(z.revenue24h),
          earningScore: Math.round(earning), demandScore: Math.round(demandScore), serviceHealth: Math.round(serviceHealth), riskScore: Math.round(risk), compositeScore: composite,
        };
      });
      scored.sort((a, b) => b.compositeScore - a.compositeScore);
      return {
        data: {
          ranked: scored,
          bestEarning: [...scored].sort((a, b) => b.earningScore - a.earningScore).slice(0, 5),
          worstService: [...scored].sort((a, b) => a.serviceHealth - b.serviceHealth).slice(0, 5),
          highRisk: [...scored].filter((z) => z.riskScore >= 50).sort((a, b) => b.riskScore - a.riskScore),
        },
        confidence: 0.82,
        freshness: new Date().toISOString(),
        source: "postgres+computed",
      };
    });
  }

  // 4) PROVIDER DENSITY — providers per zone + per km² --------------------------
  async providerDensity(): Promise<IntelResult<unknown>> {
    return intel("provider-density", 60, async () => {
      const zones = await buildZoneSnapshot();
      const data = zones.map((z) => ({
        zoneId: z.zoneId, name: z.name, city: z.city, centerLat: z.centerLat, centerLng: z.centerLng,
        providers: z.supply, areaKm2: Math.round(z.areaKm2 * 10) / 10,
        densityPerKm2: Math.round((z.supply / Math.max(z.areaKm2, 0.01)) * 100) / 100,
      })).sort((a, b) => b.densityPerKm2 - a.densityPerKm2);
      return { data, confidence: 0.95, freshness: new Date().toISOString(), source: "postgres" };
    });
  }

  // 5) REVENUE FORECAST — run-rate projection from recent realized revenue ------
  async revenueForecast(): Promise<IntelResult<unknown>> {
    return intel("revenue-forecast", 300, async () => {
      const now = Date.now();
      const [d1, d7] = await Promise.all([
        prisma.booking.aggregate({ _sum: { totalAmount: true }, _count: true, where: { status: "COMPLETED", completedAt: { gte: new Date(now - 86400_000) } } }),
        prisma.booking.aggregate({ _sum: { totalAmount: true }, where: { status: "COMPLETED", completedAt: { gte: new Date(now - 7 * 86400_000) } } }),
      ]);
      const rev24h = d1._sum.totalAmount ?? 0;
      const rev7d = d7._sum.totalAmount ?? 0;
      const hourlyRate = rev24h / 24;
      const weeklyRate = rev7d / 7;
      // blended projection (recent-weighted), with a confidence reflecting sample size.
      const projDay = Math.round(hourlyRate * 24 * 0.6 + weeklyRate * 0.4);
      return {
        data: {
          realized24h: Math.round(rev24h), realized7d: Math.round(rev7d),
          forecastHourly: Math.round(hourlyRate), forecastDaily: projDay, forecastWeekly: Math.round(projDay * 7), forecastMonthly: Math.round(projDay * 30),
          completedLast24h: d1._count,
        },
        confidence: clamp(0.5 + Math.min(d1._count, 50) / 100, 0.5, 0.92),
        freshness: new Date().toISOString(),
        source: "postgres",
      };
    });
  }

  // 6) ETA PREDICTION — Vertex/BQML model → Google route fallback ---------------
  async etaPrediction(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<IntelResult<unknown>> {
    const key = `eta:${from.lat.toFixed(3)},${from.lng.toFixed(3)}:${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;
    return intel<{ etaMin: number; distanceKm: number; method: string; withTraffic?: boolean }>(key, 60, async () => {
      const dist = distanceKm(from.lat, from.lng, to.lat, to.lng);
      const now = new Date();
      const modelEta = await bqPredictEta({ distanceKm: dist, hourOfDay: now.getUTCHours(), dayOfWeek: now.getUTCDay() }).catch(() => null);
      if (modelEta != null) {
        return { data: { etaMin: modelEta, distanceKm: Math.round(dist * 10) / 10, method: "bqml" }, confidence: 0.88, freshness: now.toISOString(), source: "bigquery:model_eta" };
      }
      const g = await mapsService.eta(from, to);
      return {
        data: { etaMin: g.etaMinutes, distanceKm: g.distanceKm, method: g.source, withTraffic: g.withTraffic },
        confidence: g.source === "google" ? 0.92 : 0.6,
        freshness: now.toISOString(),
        source: g.source === "google" ? "google:distance_matrix" : "haversine",
      };
    });
  }

  // 7) FRAUD / FAKE-GPS — BigQuery teleport detection --------------------------
  async fraudDetection(limit = 50): Promise<IntelResult<unknown>> {
    return intel("fraud", 120, async () => {
      const rows = await detectFakeGps(limit);
      // risk score scales with the worst implied speed seen.
      const worst = rows.reduce((m, r) => Math.max(m, r.implied_kmh), 0);
      const riskScore = clamp(Math.round((worst / 1000) * 100), 0, 100);
      return {
        data: { suspiciousCount: rows.length, riskScore, events: rows },
        confidence: rows.length ? 0.95 : 0.8,
        freshness: new Date().toISOString(),
        source: "bigquery:vw_fake_gps_signals",
      };
    });
  }

  // 8) EXECUTIVE KPI AGGREGATION ----------------------------------------------
  async executiveKpis(): Promise<IntelResult<unknown>> {
    return intel("exec-kpis", 30, async () => {
      const now = Date.now();
      const [gmv, completed, cancelled, online, customers, refunded, dayBookings] = await Promise.all([
        prisma.booking.aggregate({ _sum: { totalAmount: true }, where: { status: "COMPLETED" } }),
        prisma.booking.count({ where: { status: "COMPLETED" } }),
        prisma.booking.count({ where: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] } } }),
        prisma.provider.count({ where: { isOnline: true } }),
        prisma.user.count({ where: { role: "CUSTOMER", isActive: true, deletedAt: null } }),
        prisma.booking.count({ where: { refundAmount: { gt: 0 } } }),
        prisma.booking.count({ where: { createdAt: { gte: new Date(now - 86400_000) } } }),
      ]);
      const finished = completed + cancelled;
      const gmvVal = gmv._sum.totalAmount ?? 0;
      return {
        data: {
          gmv: Math.round(gmvVal),
          bookingsToday: dayBookings,
          completionRate: finished ? Math.round((completed / finished) * 1000) / 10 : 0,
          cancellationRate: finished ? Math.round((cancelled / finished) * 1000) / 10 : 0,
          refundRate: finished ? Math.round((refunded / finished) * 1000) / 10 : 0,
          onlineProviders: online,
          activeCustomers: customers,
        },
        confidence: 0.99,
        freshness: new Date().toISOString(),
        source: "postgres",
      };
    });
  }
}

export const geoIntelligenceService = new GeoIntelligenceService();
