import prisma from "../lib/prisma";
import { trackingService } from "./tracking.service";
import { heatmapService } from "./heatmap.service";
import { geofenceService } from "./geofence.service";
import { roomManager } from "../lib/websocket";
import { cacheService } from "./cache.service";
import {
  ADMIN_OPS_ROOM,
  ALERT_DEDUP_TTL_MS,
  alertKey,
  getAdminAlertSubscriberCount,
  tryBroadcastAdminAlert,
} from "../lib/admin-alert-broadcast";

/**
 * Phase 17.4 — Admin operations map. A read-only aggregation that REUSES Redis presence
 * (`tracking.service`), the Phase-16 heatmap + geofence engines, and existing booking data.
 * No duplicate presence/heatmap/geofence systems.
 */
const ACTIVE_BOOKING = ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as const;
const ETA_BREACH_MIN = 60;

export const ADMIN_WS = {
  PROVIDER_ONLINE: "ADMIN_PROVIDER_ONLINE",
  PROVIDER_OFFLINE: "ADMIN_PROVIDER_OFFLINE",
  BOOKING_UPDATE: "ADMIN_BOOKING_UPDATE",
  ALERT: "ADMIN_ALERT",
} as const;
const ADMIN_ROOM = ADMIN_OPS_ROOM;

export type OpsAlert = { type: string; severity: "warning" | "critical"; bookingId?: string; providerId?: string; message: string };

/** Stable identity for an alert so we only push a given condition once. */
export { alertKey };

type ActiveBookingRow = {
  id: string;
  status: string;
  providerId: string | null;
  eta: number | null;
  scheduledDate: Date | null;
};

/** Pure alert derivation shared by `snapshot()` and the live dispatcher — single source of truth. */
function buildAlerts(activeBookings: ActiveBookingRow[], onlineIds: Set<string>, now: number): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  for (const b of activeBookings) {
    if (b.providerId && !onlineIds.has(b.providerId)) {
      alerts.push({ type: "PROVIDER_OFFLINE", severity: "critical", bookingId: b.id, providerId: b.providerId, message: "Assigned provider is offline" });
    }
    if (b.scheduledDate && b.scheduledDate.getTime() < now && (b.status === "ACCEPTED" || b.status === "ASSIGNED")) {
      alerts.push({ type: "BOOKING_DELAYED", severity: "warning", bookingId: b.id, message: "Scheduled time passed, not started" });
    }
    if ((b.eta ?? 0) > ETA_BREACH_MIN) {
      alerts.push({ type: "ETA_BREACH", severity: "warning", bookingId: b.id, message: `ETA ${b.eta}m exceeds ${ETA_BREACH_MIN}m` });
    }
  }
  return alerts;
}

// Legacy dedup map — kept for TTL refresh of active conditions between ticks.
const lastSeenActive = new Map<string, number>();

export const opsMapService = {
  /** Broadcast an admin command-center event to subscribed admins. Skips when room is empty. */
  emit(type: (typeof ADMIN_WS)[keyof typeof ADMIN_WS], data: Record<string, unknown>): boolean {
    if (getAdminAlertSubscriberCount() === 0) return false;
    try {
      roomManager.broadcast(ADMIN_ROOM, { type, data, timestamp: new Date() });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Lightweight scan (no heatmap) that derives current ops alerts and pushes only the
   * newly-appeared ones to the `admin:ops` room. Reuses `buildAlerts` + `emit` — no new
   * alert engine. Called on a short maintenance interval (leader-locked).
   */
  async dispatchLiveAlerts(): Promise<{
    active: number;
    emitted: number;
    skipped: number;
    deduplicated: number;
    rateLimited: number;
    subscribers: number;
  }> {
    const subscribers = getAdminAlertSubscriberCount();
    if (subscribers === 0) {
      return { active: 0, emitted: 0, skipped: 0, deduplicated: 0, rateLimited: 0, subscribers: 0 };
    }

    const providers = await prisma.provider.findMany({
      where: { isApproved: true, isActive: true },
      select: { id: true },
    });
    const activeBookings = await prisma.booking.findMany({
      where: { status: { in: [...ACTIVE_BOOKING] }, providerId: { not: null } },
      select: { id: true, status: true, providerId: true, eta: true, scheduledDate: true },
    });
    const onlineIds = new Set(await trackingService.onlineProviderIds(providers.map((p) => p.id)));
    const now = Date.now();
    const alerts = buildAlerts(activeBookings, onlineIds, now);

    for (const [k, ts] of lastSeenActive) {
      if (now - ts > ALERT_DEDUP_TTL_MS) lastSeenActive.delete(k);
    }

    let emitted = 0;
    let skipped = 0;
    let deduplicated = 0;
    let rateLimited = 0;

    for (const a of alerts) {
      const k = alertKey(a);
      lastSeenActive.set(k, now);

      const result = tryBroadcastAdminAlert(
        k,
        { ...a, key: k, firstSeen: new Date(now).toISOString() },
        now,
        emitted,
      );

      switch (result.action) {
        case "sent":
          emitted++;
          break;
        case "skipped":
          skipped++;
          break;
        case "deduplicated":
          deduplicated++;
          break;
        case "rate_limited":
        case "throttled":
          rateLimited++;
          break;
      }
    }

    return { active: alerts.length, emitted, skipped, deduplicated, rateLimited, subscribers };
  },

  async snapshot(opts?: { gridSize?: number; bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number } }) {
    const gridSize = opts?.gridSize ?? 0.05;
    const cacheKey = `ops-map:snapshot:${gridSize}`;
    return cacheService.getOrFetch(cacheKey, 8, () => this.snapshotUncached(opts), 5);
  },

  async snapshotUncached(opts?: { gridSize?: number; bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number } }) {
    const [providers, activeBookings, geofences] = await Promise.all([
      prisma.provider.findMany({
        where: { isApproved: true, isActive: true },
        select: { id: true, currentLocation: { select: { latitude: true, longitude: true, lastUpdated: true } }, user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.booking.findMany({
        where: { status: { in: [...ACTIVE_BOOKING] }, providerId: { not: null } },
        select: { id: true, status: true, providerId: true, eta: true, scheduledDate: true, finalAmount: true, address: { select: { latitude: true, longitude: true } }, tracking: { select: { status: true } } },
      }),
      geofenceService.list({ activeOnly: true }),
    ]);

    const busyProviderIds = new Set(activeBookings.map((b) => b.providerId));
    const onlineIds = new Set(await trackingService.onlineProviderIds(providers.map((p) => p.id)));

    const providerMarkers = providers
      .filter((p) => p.currentLocation)
      .map((p) => ({
        providerId: p.id,
        name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        lat: p.currentLocation!.latitude,
        lng: p.currentLocation!.longitude,
        status: busyProviderIds.has(p.id) ? ("BUSY" as const) : onlineIds.has(p.id) ? ("ONLINE" as const) : ("OFFLINE" as const),
        lastUpdate: p.currentLocation!.lastUpdated,
      }));

    const bookingMarkers = activeBookings
      .filter((b) => b.address)
      .map((b) => ({ bookingId: b.id, providerId: b.providerId, status: (b.tracking?.status ?? b.status), lat: b.address!.latitude, lng: b.address!.longitude, eta: b.eta }));

    // Operational alerts (provider offline mid-job, delayed start, ETA breach) — shared builder.
    const now = Date.now();
    const alerts = buildAlerts(activeBookings as ActiveBookingRow[], onlineIds, now);

    const heatmap = await heatmapService.generate({ gridSize: opts?.gridSize, bbox: opts?.bbox, days: 30 });

    const etas = activeBookings.map((b) => b.eta).filter((e): e is number => typeof e === "number" && e > 0);
    const metrics = {
      onlineProviders: providerMarkers.filter((m) => m.status !== "OFFLINE").length,
      busyProviders: providerMarkers.filter((m) => m.status === "BUSY").length,
      totalProviders: providerMarkers.length,
      activeBookings: bookingMarkers.length,
      averageEtaMin: etas.length ? Math.round(etas.reduce((s, e) => s + e, 0) / etas.length) : 0,
      revenue30dByZone: heatmap.cells.slice(0, 10).map((c) => ({ lat: c.lat, lng: c.lng, revenue: c.revenue })),
      serviceGaps: heatmap.cells.filter((c) => c.supplyGap > 0).length, // cells with demand > online supply
      alerts: alerts.length,
    };

    return { providers: providerMarkers, bookings: bookingMarkers, geofences: geofences.map((g) => ({ id: g.id, name: g.name, centerLat: g.centerLat, centerLng: g.centerLng, radiusMeters: g.radiusMeters, zoneType: g.zoneType })), heatmap: heatmap.cells, alerts, metrics };
  },
};
