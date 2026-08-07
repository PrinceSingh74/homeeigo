import { TrackingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";
import { createWsEnvelope, pushToBookingTracking } from "./notification-hub";
import { roomManager, MessageType, WSMessage } from "../lib/websocket";
import { redisClient } from "../lib/redis";
import { mapsService } from "./maps.service";
import { recordFeatureEvent, observeHist } from "../lib/metrics";
import { geofenceService } from "./geofence.service";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildPartnerArrivedEvent, buildPartnerEnRouteEvent } from "../events/catalog/partner.events";

// Phase 17.1 — throttling + presence constants.
const THROTTLE_DISTANCE_M = 10; // ignore moves smaller than this …
const THROTTLE_WINDOW_MS = 5_000; // … within this window
const PRESENCE_TTL_SEC = 60; // provider considered online for 60s after a ping
const presenceKey = (providerId: string) => `provider:${providerId}:online`;
const lastLocKey = (providerId: string, bookingId: string) => `track:lastloc:${providerId}:${bookingId}`;
const ETA_REFRESH_SEC = Number(process.env.TRACKING_ETA_REFRESH_SEC ?? 30); // refresh traffic ETA at most every 30s
const ETA_REFRESH_MS = ETA_REFRESH_SEC * 1000;
const etaCacheKey = (bookingId: string) => `track:eta:${bookingId}`;
const arrivalNearKey = (bookingId: string) => `track:arrival:near:${bookingId}`;
const ARRIVAL_NEAR_TTL_SEC = 60;
const MIN_ARRIVAL_NEAR_PINGS = 2;

// Presence/throttle cache: Redis when configured (multi-instance), with an in-memory TTL
// fallback so it stays correct on single-instance / Redis-down (mirrors the rate limiter).
const memCache = new Map<string, { v: string; exp: number }>();
async function cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
  await redisClient.set(key, value, ttlSec).catch(() => {});
  memCache.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
}
async function cacheGet(key: string): Promise<string | null> {
  const fromRedis = await redisClient.get(key).catch(() => null);
  if (fromRedis != null) return fromRedis;
  const e = memCache.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return e.v;
}

export interface LocationUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
}

export interface TrackingData {
  bookingId: string;
  currentLat: number;
  currentLng: number;
  destLat: number;
  destLng: number;
  distance: number;
  eta: number;
  bearing?: number;
  speed?: number;
}

export class TrackingService {
  private calculateBearing(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }

  async getLatestLocation(bookingId: string) {
    const tracking = await prisma.tracking.findUnique({
      where: { bookingId },
      include: {
        locationHistory: {
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    return tracking?.locationHistory[0] || null;
  }

  async updateLocation(
    providerId: string,
    body: {
      bookingId: string;
      latitude: number;
      longitude: number;
      accuracy?: number;
      altitude?: number;
      speed?: number;
    },
  ) {
    const __t0 = Date.now();
    const booking = await prisma.booking.findFirst({
      where: {
        id: body.bookingId,
        providerId,
        status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
      },
      include: { address: true, tracking: true, service: { select: { category: true } } },
    });
    if (!booking) return null;

    // FEATURE 6 — presence: provider is "online" for 60s after any ping.
    await cacheSet(presenceKey(providerId), "1", PRESENCE_TTL_SEC);

    // FEATURE 4 — throttle: ignore sub-10 m moves within a 5 s window (cuts WS noise +
    // DB churn). Presence is still refreshed above, so the provider stays "online".
    // We also keep the PREVIOUS fix to derive heading (bearing) + ground speed for the
    // Uber-style heading-rotated marker on the client.
    const lastRaw = await cacheGet(lastLocKey(providerId, body.bookingId));
    let prev: { lat: number; lng: number; t: number } | null = null;
    if (lastRaw) {
      try {
        prev = JSON.parse(lastRaw) as { lat: number; lng: number; t: number };
        const movedM = distanceKm(prev.lat, prev.lng, body.latitude, body.longitude) * 1000;
        if (movedM < THROTTLE_DISTANCE_M && Date.now() - prev.t < THROTTLE_WINDOW_MS) {
          recordFeatureEvent("tracking", "throttled");
          return { throttled: true, bookingId: body.bookingId };
        }
      } catch {
        /* corrupt cache entry — fall through and process the update */
        prev = null;
      }
    }
    const nowMs = Date.now();
    // Heading (deg, 0=N clockwise) from prev→current; null when there is no usable previous fix.
    const bearing = prev ? this.calculateBearing(prev.lat, prev.lng, body.latitude, body.longitude) : undefined;
    // Ground speed (m/s) from prev→current over elapsed time (guards tiny/zero Δt).
    let speed: number | undefined = body.speed;
    if (speed == null && prev) {
      const dtSec = Math.max(0.5, (nowMs - prev.t) / 1000);
      const movedM = distanceKm(prev.lat, prev.lng, body.latitude, body.longitude) * 1000;
      // Cap derived speed at 90 m/s (~324 km/h) so a GPS glitch / large jump can't broadcast
      // an absurd value (mirrors the device-reported speed cap in the schema).
      speed = Math.min(90, Math.round((movedM / dtSec) * 10) / 10);
    }
    await cacheSet(lastLocKey(providerId, body.bookingId), JSON.stringify({ lat: body.latitude, lng: body.longitude, t: nowMs }), PRESENCE_TTL_SEC);

    const tracking = await prisma.tracking.upsert({
      where: { bookingId: body.bookingId },
      create: {
        bookingId: body.bookingId,
        status: TrackingStatus.ON_THE_WAY,
      },
      update: { lastUpdateAt: new Date() },
    });

    await prisma.locationHistory.create({
      data: {
        trackingId: tracking.id,
        providerId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        altitude: body.altitude,
      },
    });

    await prisma.location.upsert({
      where: { providerId },
      create: {
        providerId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
      update: {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
    });

    // FEATURE 5 (hardened) — ETA: instant haversine on the hot path; the traffic-aware
    // Google ETA is cached in Redis and refreshed ASYNCHRONOUSLY (≤ every ETA_REFRESH_SEC)
    // so no GPS ping ever blocks on a Google round-trip. Accuracy preserved: a fresh cached
    // Google ETA is used when available, otherwise the haversine estimate (refined within 30s).
    const dist = distanceKm(body.latitude, body.longitude, booking.address.latitude, booking.address.longitude);
    const eta = await this.resolveEta(
      body.bookingId,
      { lat: body.latitude, lng: body.longitude },
      { lat: booking.address.latitude, lng: booking.address.longitude },
      dist,
    );
    const estimatedArrivalTime = new Date(Date.now() + eta * 60 * 1000);

    await prisma.tracking.update({
      where: { id: tracking.id },
      data: {
        status: TrackingStatus.ON_THE_WAY,
        totalDistance: dist,
        estimatedArrivalTime,
        lastUpdateAt: new Date(),
      },
    });

    await this.maybeTransitionEnRoute({
      bookingId: body.bookingId,
      providerId,
      bookingStatus: booking.status,
      enRouteAtExisting: booking.enRouteAt,
      distanceKm: dist,
      googleEtaMin: eta,
    });

    await this.maybeRecordArrival({
      bookingId: body.bookingId,
      providerId,
      booking,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      distanceKm: dist,
      googleEtaMin: eta,
      speed,
      prev,
    });

    await prisma.booking.update({
      where: { id: body.bookingId },
      data: { eta },
    });

    const nowIso = new Date().toISOString();
    const payload = createWsEnvelope("tracking.location_update", {
      bookingId: body.bookingId,
      latitude: body.latitude,
      longitude: body.longitude,
      providerLatitude: body.latitude,
      providerLongitude: body.longitude,
      distance: Math.round(dist * 10) / 10,
      eta,
      estimatedArrivalTime: estimatedArrivalTime.toISOString(),
      status: "on_the_way",
      bearing,
      speed,
      locationUpdatedAt: nowIso,
    }, body.bookingId);
    pushToBookingTracking(body.bookingId, payload);

    // D2 fix — live geofence ENTER/EXIT detection from the provider's GPS (advisory-locked, deduped).
    void geofenceService
      .processLocationUpdate({ providerId }, body.latitude, body.longitude)
      .catch(() => undefined);

    // D1 fix — tracking-pipeline latency on the REAL production path.
    observeHist("geo_tracking_latency", (Date.now() - __t0) / 1000);
    recordFeatureEvent("tracking", "update");
    return payload;
  }

  private async maybeTransitionEnRoute(input: {
    bookingId: string;
    providerId: string;
    bookingStatus: string;
    enRouteAtExisting: Date | null;
    distanceKm: number;
    googleEtaMin: number;
  }): Promise<void> {
    if (
      !eventPlatformConfig.outboxEnabled ||
      !eventPlatformConfig.trackingEventsEnabled ||
      input.enRouteAtExisting
    ) {
      return;
    }
    if (!["ACCEPTED", "ASSIGNED"].includes(input.bookingStatus)) return;

    const enRouteAt = new Date();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: input.bookingId, enRouteAt: null, status: { in: ["ACCEPTED", "ASSIGNED"] } },
        data: { status: "EN_ROUTE", enRouteAt },
      });
      if (updated.count === 0) return;
      await emitInTransaction(
        tx,
        buildPartnerEnRouteEvent({
          providerId: input.providerId,
          bookingId: input.bookingId,
          enRouteAt,
          distanceKm: Math.round(input.distanceKm * 10) / 10,
          googleEtaMin: input.googleEtaMin,
        }),
      );
    });
  }

  private async maybeRecordArrival(input: {
    bookingId: string;
    providerId: string;
    booking: {
      arrivedAt: Date | null;
      enRouteAt: Date | null;
      assignedAt: Date | null;
      address: { city: string };
      service: { category: string };
    };
    latitude: number;
    longitude: number;
    accuracy?: number;
    distanceKm: number;
    googleEtaMin: number;
    speed?: number;
    prev: { lat: number; lng: number; t: number } | null;
  }): Promise<void> {
    if (
      !eventPlatformConfig.outboxEnabled ||
      !eventPlatformConfig.trackingEventsEnabled ||
      input.booking.arrivedAt
    ) {
      return;
    }

    const radiusM = eventPlatformConfig.arrivalRadiusM;
    const distM = input.distanceKm * 1000;
    if (distM > radiusM) {
      await cacheSet(arrivalNearKey(input.bookingId), "0", ARRIVAL_NEAR_TTL_SEC);
      return;
    }

    if (input.accuracy != null && input.accuracy > 75 && distM > radiusM * 0.5) return;
    if (input.speed != null && input.speed > 45) return;

    const nearCount = Number((await cacheGet(arrivalNearKey(input.bookingId))) ?? "0") + 1;
    await cacheSet(arrivalNearKey(input.bookingId), String(nearCount), ARRIVAL_NEAR_TTL_SEC);
    if (nearCount < MIN_ARRIVAL_NEAR_PINGS) return;

    const arrivedAt = new Date();
    const travelDurationMin = input.booking.enRouteAt
      ? Math.max(1, Math.round((arrivedAt.getTime() - input.booking.enRouteAt.getTime()) / 60_000))
      : null;

    const attempt = await prisma.assignmentAttempt.findFirst({
      where: { providerId: input.providerId, job: { bookingId: input.bookingId } },
      orderBy: { dispatchedAt: "desc" },
      select: { dispatchedAt: true },
    });

    await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: input.bookingId, arrivedAt: null },
        data: { arrivedAt, travelDurationMin },
      });
      if (updated.count === 0) return;

      await tx.tracking.updateMany({
        where: { bookingId: input.bookingId },
        data: { status: TrackingStatus.ARRIVED, actualArrivalTime: arrivedAt },
      });

      await tx.locationHistory.updateMany({
        where: { tracking: { bookingId: input.bookingId } },
        data: { hasArrived: true },
      });

      await emitInTransaction(
        tx,
        buildPartnerArrivedEvent({
          providerId: input.providerId,
          bookingId: input.bookingId,
          arrivedAt,
          dispatchedAt: attempt?.dispatchedAt ?? input.booking.assignedAt,
          enRouteAt: input.booking.enRouteAt,
          travelDurationMin,
          city: input.booking.address.city,
          serviceCategory: input.booking.service.category,
          distanceKm: Math.round(input.distanceKm * 10) / 10,
          googleEtaMin: input.googleEtaMin,
        }),
      );
    });
  }

  /**
   * ETA resolver — non-blocking. Returns a cached traffic-aware Google ETA when fresh,
   * else an instant haversine estimate and kicks off an async Google refresh.
   */
  private async resolveEta(
    bookingId: string,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    distKm: number,
  ): Promise<number> {
    const key = etaCacheKey(bookingId);
    const cached = await cacheGet(key).catch(() => null);
    if (cached) {
      try {
        const c = JSON.parse(cached) as { eta: number; at: number };
        if (Date.now() - c.at < ETA_REFRESH_MS) return c.eta; // fresh Google ETA
      } catch {
        /* corrupt entry — fall through */
      }
    }
    // Stale/missing: refresh the Google ETA in the background, return instant haversine now.
    void this.refreshGoogleEta(key, from, to, bookingId).catch(() => undefined);
    return etaMinutes(distKm);
  }

  private async refreshGoogleEta(key: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }, bookingId?: string): Promise<void> {
    const requestTimestamp = new Date();
    const r = await mapsService.eta(from, to);
    const responseTimestamp = new Date();
    await cacheSet(key, JSON.stringify({ eta: r.etaMinutes, at: Date.now() }), ETA_REFRESH_SEC * 2).catch(() => {});
    if (bookingId && r.source === "google") {
      void import("./eta-intelligence.service")
        .then(({ etaIntelligenceService }) =>
          etaIntelligenceService.captureGoogleSnapshot({
            bookingId,
            requestTimestamp,
            responseTimestamp,
            status: "OK",
            etaSeconds: r.etaMinutes * 60,
            distanceMeters: r.distanceKm * 1000,
            trafficModel: r.withTraffic ? "best_guess" : "static",
            source: r.source,
          }),
        )
        .catch(() => undefined);
    }
  }

  async get(bookingId: string, userId?: string, providerId?: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...(userId ? { userId } : {}),
        ...(providerId ? { providerId } : {}),
      },
      include: {
        tracking: true,
        provider: { include: { currentLocation: true } },
        address: true,
      },
    });
    if (!booking) return null;

    const loc = booking.provider?.currentLocation;

    // Fallback: no live per-booking GPS stream yet (partner hasn't gone en-route
    // for THIS booking), but the assigned partner has a last-known location.
    // Surface it so oversight (admin console) + apps always show where the
    // partner is, flagged `live:false` so the UI can label it "last known".
    if (!booking.tracking) {
      if (!loc) return null;
      const distFallback = booking.address
        ? distanceKm(loc.latitude, loc.longitude, booking.address.latitude, booking.address.longitude)
        : null;
      return {
        id: `lastknown-${bookingId}`,
        bookingId,
        live: false,
        status: (booking.status ?? "assigned").toString().toLowerCase(),
        providerLatitude: loc.latitude,
        providerLongitude: loc.longitude,
        destinationLatitude: booking.address?.latitude,
        destinationLongitude: booking.address?.longitude,
        distance: distFallback != null ? Math.round(distFallback * 10) / 10 : null,
        eta: booking.eta,
        estimatedArrivalTime: null,
        locationUpdatedAt: loc.lastUpdated?.toISOString?.() ?? null,
      };
    }

    let dist = booking.tracking.totalDistance;
    if (loc && booking.address) {
      dist = distanceKm(loc.latitude, loc.longitude, booking.address.latitude, booking.address.longitude);
    }

    return {
      id: booking.tracking.id,
      bookingId,
      live: true,
      status: booking.tracking.status.toLowerCase(),
      providerLatitude: loc?.latitude,
      providerLongitude: loc?.longitude,
      // Customer-home coordinates so map consumers (admin console, apps) can
      // draw the route without a second booking-detail round trip.
      destinationLatitude: booking.address?.latitude,
      destinationLongitude: booking.address?.longitude,
      distance: dist ? Math.round(dist * 10) / 10 : null,
      eta: booking.eta,
      estimatedArrivalTime: booking.tracking.estimatedArrivalTime,
      locationUpdatedAt: booking.tracking.lastUpdateAt,
    };
  }

  /** FEATURE 6 — presence lookup (admin ops map, online detection). */
  async isProviderOnline(providerId: string): Promise<boolean> {
    return Boolean(await cacheGet(presenceKey(providerId)));
  }

  /** Filter a set of provider ids down to those currently online (presence TTL not expired). */
  async onlineProviderIds(providerIds: string[]): Promise<string[]> {
    const online = await Promise.all(providerIds.map(async (id) => ((await this.isProviderOnline(id)) ? id : null)));
    return online.filter((x): x is string => x !== null);
  }

  /** FEATURE 7 — tracking-history retention: drop location pings older than N days (default 30). */
  async cleanupHistory(days = 30): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const result = await prisma.locationHistory.deleteMany({ where: { timestamp: { lt: cutoff } } });
    return result.count;
  }
}

export const trackingService = new TrackingService();
