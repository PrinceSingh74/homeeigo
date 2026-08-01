/**
 * Geospatial Prometheus metrics — REAL values pulled at scrape time (no mock data).
 * Registered once at boot (see index.ts). Reuses prisma + existing geo data.
 *
 *   geo_active_providers                  ← providers.is_online = true
 *   geo_active_bookings                   ← bookings in ACCEPTED/ASSIGNED/EN_ROUTE/IN_PROGRESS
 *   geo_zone_supply{zone}                 ← online provider locations inside each geofence
 *   geo_zone_demand{zone}                 ← bookings (24h) whose address is inside each geofence
 *   geo_zone_revenue{zone}                ← completed-booking revenue (24h) inside each geofence
 *
 * (geo_eta_seconds + geo_tracking_latency are observed at event time — maps.service / tracking.service.)
 */
import type { BookingStatus } from "@prisma/client";
import prisma from "./prisma";
import { setGauge, registerScrapeSampler } from "./metrics";
import { distanceKm } from "./geo";

const ZONE_TTL_MS = 30_000; // zone aggregation is heavier — recompute at most every 30s
let zoneCache = { at: 0 };

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as BookingStatus[];

function inside(lat: number, lng: number, z: { centerLat: number; centerLng: number; radiusMeters: number }): boolean {
  return distanceKm(lat, lng, z.centerLat, z.centerLng) * 1000 <= z.radiusMeters;
}

/** NCR Tier-0 region: Delhi, Gurugram, Noida (+ Gurgaon spelling). */
const NCR_CITIES = new Set(["delhi", "gurugram", "gurgaon", "noida"]);
function isNcr(city: string | null): boolean {
  return !!city && NCR_CITIES.has(city.trim().toLowerCase());
}

export function registerGeoMetricSamplers(): void {
  // Platform-wide live counts (cheap).
  registerScrapeSampler(async () => {
    const [providers, bookings] = await Promise.all([
      prisma.provider.count({ where: { isOnline: true } }).catch(() => 0),
      prisma.booking.count({ where: { status: { in: ACTIVE_BOOKING_STATUSES } } }).catch(() => 0),
    ]);
    setGauge("geo_active_providers", providers);
    setGauge("geo_active_bookings", bookings);
  });

  // Per-zone supply / demand / revenue (heavier — recompute every 30s).
  registerScrapeSampler(async () => {
    if (Date.now() - zoneCache.at < ZONE_TTL_MS) return;
    zoneCache = { at: Date.now() };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [zones, providerLocs, recentBookings] = await Promise.all([
      prisma.geofence.findMany({
        where: { isActive: true },
        select: { id: true, name: true, centerLat: true, centerLng: true, radiusMeters: true, surgeMultiplier: true, city: true },
      }).catch(() => [] as Array<{ id: string; name: string; centerLat: number; centerLng: number; radiusMeters: number; surgeMultiplier: number; city: string | null }>),
      // online providers' current locations
      prisma.location.findMany({
        where: { provider: { isOnline: true } },
        select: { latitude: true, longitude: true },
      }).catch(() => [] as Array<{ latitude: number; longitude: number }>),
      // last-24h bookings with their address coords + status + amount
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, finalAmount: true, address: { select: { latitude: true, longitude: true } } },
      }).catch(() => [] as Array<{ status: string; finalAmount: number; address: { latitude: number; longitude: number } | null }>),
    ]);

    for (const z of zones) {
      const label = { zone: z.name };
      const supply = providerLocs.filter((p) => inside(p.latitude, p.longitude, z)).length;
      let demand = 0;
      let revenue = 0;
      for (const b of recentBookings) {
        if (!b.address) continue;
        if (!inside(b.address.latitude, b.address.longitude, z)) continue;
        demand += 1;
        if (b.status === "COMPLETED") revenue += b.finalAmount ?? 0;
      }
      const ncrLabel = { ...label, region: isNcr(z.city) ? "NCR" : "other" };
      setGauge("geo_zone_supply", supply, ncrLabel);
      setGauge("geo_zone_demand", demand, ncrLabel);
      setGauge("geo_zone_revenue", Math.round(revenue), ncrLabel);
      setGauge("geo_zone_surge", z.surgeMultiplier ?? 1, ncrLabel);
    }
  });
}
