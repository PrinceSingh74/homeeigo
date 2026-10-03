import type { PartnerPresence } from "@prisma/client";
import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  BadRequestError,
} from "../lib/app-error";
import {
  HEARTBEAT_RATE_LIMIT,
  HEARTBEAT_RATE_WINDOW_SEC,
  LEGACY_PRESENCE_REDIS_KEY,
  PRESENCE_HEARTBEAT_INTERVAL_SEC,
  PRESENCE_REDIS_KEY,
  PRESENCE_REDIS_TTL_SEC,
} from "../lib/partner-presence.config";
import {
  deriveLocationFreshness,
  derivePresenceFreshness,
  isOperationallyLive,
} from "../lib/partner-presence-freshness";
import {
  validateClientTimestamp,
  validatePresenceLocation,
} from "../lib/partner-presence-location";
import type {
  PartnerLocationPingInput,
  PartnerPresenceHeartbeatInput,
} from "../schemas/partner-presence.schema";
import { incCounter, observeHist } from "../lib/metrics";
import { AuditLogService } from "./audit-log.service";
import { logger } from "../lib/logger";

const memPresence = new Map<string, { payload: string; exp: number }>();

type RedisPresencePayload = {
  sessionId: string;
  deviceId: string;
  lastHeartbeatAt: string;
  lastLocationAt?: string;
};

export type PresenceSnapshot = {
  providerId: string;
  sessionId: string | null;
  deviceId: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
  presenceFreshness: ReturnType<typeof derivePresenceFreshness>;
  locationFreshness: ReturnType<typeof deriveLocationFreshness>;
  /** Seconds since the last heartbeat — null when the partner has never beaten. */
  presenceAgeSeconds: number | null;
  /** Seconds since the last fix was *captured* on the device. */
  locationAgeSeconds: number | null;
  operationallyLive: boolean;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    capturedAt: string | null;
    receivedAt: string | null;
    /** receivedAt - capturedAt: how stale the GPS already was when it reached us. */
    transportLagSeconds: number | null;
    source: string | null;
    sequence: number | null;
  } | null;
  appState: string | null;
  platform: string | null;
  appVersion: string | null;
  /** Client-facing heartbeat cadence, so the app never hardcodes the interval. */
  heartbeatIntervalSeconds: number;
};

export type HeartbeatContext = {
  providerId: string;
  userId: string;
  requestId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type HeartbeatResult = {
  accepted: boolean;
  duplicate?: boolean;
  snapshot: PresenceSnapshot;
};

async function cacheSetPresence(providerId: string, payload: RedisPresencePayload): Promise<void> {
  const json = JSON.stringify(payload);
  const ttl = PRESENCE_REDIS_TTL_SEC;
  memPresence.set(providerId, { payload: json, exp: Date.now() + ttl * 1000 });
  await Promise.all([
    redisClient.set(PRESENCE_REDIS_KEY(providerId), json, ttl).catch(() => {}),
    redisClient.set(LEGACY_PRESENCE_REDIS_KEY(providerId), "1", ttl).catch(() => {}),
  ]);
}

async function cacheGetPresence(providerId: string): Promise<RedisPresencePayload | null> {
  const fromRedis = await redisClient.get(PRESENCE_REDIS_KEY(providerId)).catch(() => null);
  const raw = fromRedis ?? (() => {
    const e = memPresence.get(providerId);
    if (!e || e.exp < Date.now()) {
      memPresence.delete(providerId);
      return null;
    }
    return e.payload;
  })();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RedisPresencePayload;
  } catch {
    return null;
  }
}

function ageSeconds(at: Date | null, now: Date): number | null {
  if (!at) return null;
  return Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
}

function toSnapshot(
  providerId: string,
  row: PartnerPresence | null,
  isOnline: boolean,
  now = new Date(),
): PresenceSnapshot {
  const lastHeartbeatAt = row?.lastHeartbeatAt ?? null;
  const lastLocationAt = row?.lastLocationAt ?? null;
  const lastLocationReceivedAt = row?.lastLocationReceivedAt ?? null;
  return {
    providerId,
    sessionId: row?.activeSessionId ?? null,
    deviceId: row?.activeDeviceId ?? null,
    lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
    lastSeenAt: row?.lastSeenAt?.toISOString() ?? null,
    presenceFreshness: derivePresenceFreshness({ lastHeartbeatAt, now }),
    locationFreshness: deriveLocationFreshness({ lastLocationAt, now }),
    presenceAgeSeconds: ageSeconds(lastHeartbeatAt, now),
    locationAgeSeconds: ageSeconds(lastLocationAt, now),
    operationallyLive: isOperationallyLive({ isOnline, lastHeartbeatAt, now }),
    location:
      row?.lastLocationLat != null && row?.lastLocationLng != null
        ? {
            latitude: row.lastLocationLat,
            longitude: row.lastLocationLng,
            accuracy: row.lastLocationAccuracy ?? null,
            capturedAt: lastLocationAt?.toISOString() ?? null,
            receivedAt: lastLocationReceivedAt?.toISOString() ?? null,
            transportLagSeconds:
              lastLocationAt && lastLocationReceivedAt
                ? Math.max(0, Math.round((lastLocationReceivedAt.getTime() - lastLocationAt.getTime()) / 1000))
                : null,
            source: row.lastLocationSource ?? null,
            sequence: row.lastLocationSeq ?? null,
          }
        : null,
    appState: row?.appState ?? null,
    platform: row?.platform ?? null,
    appVersion: row?.appVersion ?? null,
    heartbeatIntervalSeconds: PRESENCE_HEARTBEAT_INTERVAL_SEC,
  };
}

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: Date;
  sequence?: number;
};

type LocationUpdate = {
  lastLocationAt: Date;
  lastLocationReceivedAt: Date;
  lastLocationLat: number;
  lastLocationLng: number;
  lastLocationAccuracy?: number;
  lastLocationSource: string;
  lastLocationSeq?: number;
};

/**
 * Validate an incoming fix against the stored one and shape the DB patch.
 * `capturedAt` is the device clock, `lastLocationReceivedAt` is ours — both are kept
 * so a fix that was already 45s old on arrival is visible in audit instead of hidden.
 */
function buildLocationUpdate(
  location: LocationInput | null,
  existing: PartnerPresence | null,
  now: Date,
  source: string,
): { duplicate: boolean; update: LocationUpdate | null } {
  if (!location) return { duplicate: false, update: null };

  const prior =
    existing?.lastLocationLat != null && existing.lastLocationLng != null && existing.lastLocationAt
      ? {
          latitude: existing.lastLocationLat,
          longitude: existing.lastLocationLng,
          capturedAt: existing.lastLocationAt,
          sequence: existing.lastLocationSeq,
        }
      : null;

  const check = validatePresenceLocation(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      capturedAt: location.capturedAt,
      sequence: location.sequence,
    },
    prior,
    now,
  );

  if (!check.ok) {
    incCounter("partner_presence_location_error_total", { reason: check.code });
    throw new BadRequestError(check.message, { code: check.code });
  }

  if (check.duplicate) return { duplicate: true, update: null };

  return {
    duplicate: false,
    update: {
      lastLocationAt: location.capturedAt,
      lastLocationReceivedAt: now,
      lastLocationLat: location.latitude,
      lastLocationLng: location.longitude,
      lastLocationAccuracy: location.accuracy,
      lastLocationSource: source,
      lastLocationSeq: location.sequence,
    },
  };
}

export class PartnerPresenceService {
  /** Called on login / token refresh — Session B becomes current. */
  async promoteSession(providerId: string, sessionId: string, deviceId?: string | null): Promise<void> {
    const now = new Date();
    await prisma.partnerPresence.upsert({
      where: { providerId },
      create: {
        providerId,
        activeSessionId: sessionId,
        activeDeviceId: deviceId ?? null,
        lastSeenAt: now,
      },
      update: {
        activeSessionId: sessionId,
        activeDeviceId: deviceId ?? null,
        lastSeenAt: now,
      },
    });
    logger.info("[presence] session promoted", { providerId, sessionId, deviceId });
  }

  async getSnapshot(providerId: string): Promise<PresenceSnapshot> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { isOnline: true },
    });
    if (!provider) throw new NotFoundError("Provider");

    const row = await prisma.partnerPresence.findUnique({ where: { providerId } });
    return toSnapshot(providerId, row, provider.isOnline);
  }

  async isRedisLive(providerId: string): Promise<boolean> {
    return (await cacheGetPresence(providerId)) !== null;
  }

  /**
   * Authentication → ownership → session validity → device binding → active-session →
   * rate limit. Shared by heartbeat and location ping so neither path can drift into a
   * weaker security chain than the other.
   */
  private async authorizeSession(
    ctx: HeartbeatContext,
    input: { sessionId: string; deviceId: string },
    scope: "presence_heartbeat" | "presence_location_ping",
    now: Date,
  ): Promise<{ provider: { id: string; isOnline: boolean }; existing: PartnerPresence | null }> {
    /**
     * One round trip for the three authorization reads (partner ownership, session validity,
     * current presence row). They used to be three sequential queries, so every heartbeat paid three
     * pool acquisitions and three event-loop hops before it wrote anything — under load that was the
     * larger half of the request. The checks below still run in the same order and raise the same
     * errors; only the fetching is merged.
     */
    const [joined] = await prisma.$queryRawUnsafe<
      Array<{
        provider_id: string | null;
        is_online: boolean | null;
        session_id: string | null;
        session_device_id: string | null;
        p_id: string | null;
        p_provider_id: string | null;
        p_active_session_id: string | null;
        p_active_device_id: string | null;
        p_last_heartbeat_at: Date | null;
        p_last_seen_at: Date | null;
        p_last_location_at: Date | null;
        p_last_location_received_at: Date | null;
        p_last_location_lat: number | null;
        p_last_location_lng: number | null;
        p_last_location_accuracy: number | null;
        p_last_location_source: string | null;
        p_last_location_seq: number | null;
        p_app_state: string | null;
        p_platform: string | null;
        p_app_version: string | null;
        p_created_at: Date | null;
        p_updated_at: Date | null;
      }>
    >(
      `SELECT pv.id AS provider_id, pv.is_online,
              t.id AS session_id, t.device_id AS session_device_id,
              pr.id AS p_id, pr.provider_id AS p_provider_id, pr.active_session_id AS p_active_session_id,
              pr.active_device_id AS p_active_device_id, pr.last_heartbeat_at AS p_last_heartbeat_at,
              pr.last_seen_at AS p_last_seen_at, pr.last_location_at AS p_last_location_at,
              pr.last_location_received_at AS p_last_location_received_at, pr.last_location_lat AS p_last_location_lat,
              pr.last_location_lng AS p_last_location_lng, pr.last_location_accuracy AS p_last_location_accuracy,
              pr.last_location_source AS p_last_location_source, pr.last_location_seq AS p_last_location_seq,
              pr.app_state AS p_app_state, pr.platform AS p_platform, pr.app_version AS p_app_version,
              pr.created_at AS p_created_at, pr.updated_at AS p_updated_at
         FROM providers pv
         LEFT JOIN refresh_tokens t
           ON t.id = $2 AND t.user_id = $3 AND t.revoked_at IS NULL AND t.expires_at > $4
         LEFT JOIN partner_presence pr ON pr.provider_id = pv.id
        WHERE pv.id = $1 AND pv.user_id = $3`,
      ctx.providerId,
      input.sessionId,
      ctx.userId,
      now,
    );

    if (!joined?.provider_id) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: "partner_ownership" });
      throw new ForbiddenError("Partner ownership mismatch", { code: "FORBIDDEN" });
    }
    const providerRow = { id: joined.provider_id, isOnline: Boolean(joined.is_online) };

    if (!joined.session_id) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: "invalid_session" });
      throw new UnauthorizedError("Invalid or expired session", { code: "INVALID_SESSION" });
    }

    if (joined.session_device_id && joined.session_device_id !== input.deviceId) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: "device_mismatch" });
      void AuditLogService.failure("DEVICE_MISMATCH", {
        userId: ctx.userId,
        deviceId: input.deviceId,
        details: { providerId: ctx.providerId, storedDeviceId: joined.session_device_id },
      });
      throw new ForbiddenError("Device mismatch for session", { code: "DEVICE_MISMATCH" });
    }

    const existing: PartnerPresence | null = joined.p_id
      ? {
          id: joined.p_id,
          providerId: joined.p_provider_id!,
          activeSessionId: joined.p_active_session_id,
          activeDeviceId: joined.p_active_device_id,
          lastHeartbeatAt: joined.p_last_heartbeat_at,
          lastSeenAt: joined.p_last_seen_at,
          lastLocationAt: joined.p_last_location_at,
          lastLocationReceivedAt: joined.p_last_location_received_at,
          lastLocationLat: joined.p_last_location_lat,
          lastLocationLng: joined.p_last_location_lng,
          lastLocationAccuracy: joined.p_last_location_accuracy,
          lastLocationSource: joined.p_last_location_source,
          lastLocationSeq: joined.p_last_location_seq,
          appState: joined.p_app_state,
          platform: joined.p_platform,
          appVersion: joined.p_app_version,
          createdAt: joined.p_created_at!,
          updatedAt: joined.p_updated_at!,
        }
      : null;

    // Session B replaced session A on a new login; A's beats must not keep A alive.
    if (existing?.activeSessionId && existing.activeSessionId !== input.sessionId) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: "stale_session" });
      throw new ForbiddenError("Session is no longer active", { code: "STALE_SESSION" });
    }

    const rate = await consumeRateLimitSmart(
      `presence:hb:${ctx.providerId}`,
      HEARTBEAT_RATE_LIMIT,
      HEARTBEAT_RATE_WINDOW_SEC * 1000,
    );
    if (!rate.allowed) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: "rate_limit" });
      void AuditLogService.failure("RATE_LIMIT_EXCEEDED", {
        userId: ctx.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        details: { scope, providerId: ctx.providerId },
      });
      throw new RateLimitError("Heartbeat rate limit exceeded", Math.ceil((rate.resetAt - Date.now()) / 1000));
    }

    return { provider: providerRow, existing };
  }

  /**
   * Process authenticated heartbeat.
   * Never trusts client partnerId — caller must pass server-derived providerId.
   */
  async heartbeat(ctx: HeartbeatContext, input: PartnerPresenceHeartbeatInput): Promise<HeartbeatResult> {
    const __t0 = Date.now();
    const now = new Date();

    const tsCheck = validateClientTimestamp(input.timestamp, now);
    if (!tsCheck.ok) {
      incCounter("partner_presence_heartbeat_reject_total", { reason: tsCheck.code });
      throw new BadRequestError(tsCheck.message, { code: tsCheck.code });
    }

    const { provider: providerRow, existing } = await this.authorizeSession(
      ctx,
      input,
      "presence_heartbeat",
      now,
    );

    const { duplicate: locationDuplicate, update: locationUpdate } = buildLocationUpdate(
      input.location ?? null,
      existing,
      now,
      "presence_heartbeat",
    );

    const heartbeatAt = now;

    /**
     * ONE statement, not an interactive transaction.
     *
     * This used to be a 4-statement `$transaction` (presence upsert → provider → location → session
     * token). Each statement is an application round trip, so the connection sat in
     * `idle in transaction` while the event loop was busy elsewhere; under the certification load
     * profile that was the dominant Postgres wait event and it saturated the pool, which pushed the
     * heartbeat p95 to ~680 ms while the same call served in isolation took ~118 ms.
     *
     * Data-modifying CTEs give the same atomicity (a single statement is its own transaction) with a
     * single round trip and no idle-in-transaction window. The write semantics below are exactly the
     * previous ones: keep an existing session id, only overwrite optional device fields when the
     * client sent them, and only touch the location columns when this beat carried a fresh fix.
     */
    const loc = locationUpdate;
    const hasLocation = Boolean(loc) && !locationDuplicate;
    type PresenceRow = {
      id: string;
      provider_id: string;
      active_session_id: string | null;
      active_device_id: string | null;
      last_heartbeat_at: Date | null;
      last_seen_at: Date | null;
      last_location_at: Date | null;
      last_location_received_at: Date | null;
      last_location_lat: number | null;
      last_location_lng: number | null;
      last_location_accuracy: number | null;
      last_location_source: string | null;
      last_location_seq: number | null;
      app_state: string | null;
      platform: string | null;
      app_version: string | null;
      created_at: Date;
      updated_at: Date;
    };
    const rows = await prisma.$queryRawUnsafe<PresenceRow[]>(
      `WITH presence AS (
         INSERT INTO partner_presence (
           id, provider_id, active_session_id, active_device_id, last_heartbeat_at, last_seen_at,
           app_state, platform, app_version,
           last_location_at, last_location_received_at, last_location_lat, last_location_lng,
           last_location_accuracy, last_location_source, last_location_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
         ON CONFLICT (provider_id) DO UPDATE SET
           active_session_id = COALESCE(partner_presence.active_session_id, EXCLUDED.active_session_id),
           active_device_id = EXCLUDED.active_device_id,
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           last_seen_at = EXCLUDED.last_seen_at,
           app_state = COALESCE(EXCLUDED.app_state, partner_presence.app_state),
           platform = COALESCE(EXCLUDED.platform, partner_presence.platform),
           app_version = COALESCE(EXCLUDED.app_version, partner_presence.app_version),
           last_location_at = CASE WHEN $16::boolean THEN EXCLUDED.last_location_at ELSE partner_presence.last_location_at END,
           last_location_received_at = CASE WHEN $16::boolean THEN EXCLUDED.last_location_received_at ELSE partner_presence.last_location_received_at END,
           last_location_lat = CASE WHEN $16::boolean THEN EXCLUDED.last_location_lat ELSE partner_presence.last_location_lat END,
           last_location_lng = CASE WHEN $16::boolean THEN EXCLUDED.last_location_lng ELSE partner_presence.last_location_lng END,
           last_location_accuracy = CASE WHEN $16::boolean THEN EXCLUDED.last_location_accuracy ELSE partner_presence.last_location_accuracy END,
           last_location_source = CASE WHEN $16::boolean THEN EXCLUDED.last_location_source ELSE partner_presence.last_location_source END,
           last_location_seq = CASE WHEN $16::boolean THEN EXCLUDED.last_location_seq ELSE partner_presence.last_location_seq END,
           updated_at = NOW()
         RETURNING *
       ), prov AS (
         UPDATE providers SET last_seen_at = $5, updated_at = NOW() WHERE id = $2
       ), loc AS (
         INSERT INTO locations (id, provider_id, latitude, longitude, accuracy, last_updated)
         SELECT $17, $2, $11, $12, $13, NOW() WHERE $16::boolean
         ON CONFLICT (provider_id) DO UPDATE SET
           latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           accuracy = EXCLUDED.accuracy, last_updated = NOW()
       ), tok AS (
         UPDATE refresh_tokens SET last_activity_at = $5 WHERE id = $18
       )
       SELECT * FROM presence`,
      crypto.randomUUID(),
      ctx.providerId,
      input.sessionId,
      input.deviceId,
      heartbeatAt,
      input.appState ?? null,
      input.platform ?? null,
      input.appVersion ?? null,
      loc?.lastLocationAt ?? null,
      loc?.lastLocationReceivedAt ?? null,
      loc?.lastLocationLat ?? null,
      loc?.lastLocationLng ?? null,
      loc?.lastLocationAccuracy ?? null,
      loc?.lastLocationSource ?? null,
      loc?.lastLocationSeq ?? null,
      hasLocation,
      crypto.randomUUID(),
      input.sessionId,
    );
    const r = rows[0];
    /** snake_case row → the Prisma shape the snapshot and cache already expect. */
    const row: PartnerPresence | null = r
      ? {
          id: r.id,
          providerId: r.provider_id,
          activeSessionId: r.active_session_id,
          activeDeviceId: r.active_device_id,
          lastHeartbeatAt: r.last_heartbeat_at,
          lastSeenAt: r.last_seen_at,
          lastLocationAt: r.last_location_at,
          lastLocationReceivedAt: r.last_location_received_at,
          lastLocationLat: r.last_location_lat,
          lastLocationLng: r.last_location_lng,
          lastLocationAccuracy: r.last_location_accuracy,
          lastLocationSource: r.last_location_source,
          lastLocationSeq: r.last_location_seq,
          appState: r.app_state,
          platform: r.platform,
          appVersion: r.app_version,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;

    await cacheSetPresence(ctx.providerId, {
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      lastHeartbeatAt: heartbeatAt.toISOString(),
      lastLocationAt: row?.lastLocationAt?.toISOString(),
    });

    // Seconds, per Prometheus convention and DURATION_BUCKETS (0.005…10 s). It used to pass
    // milliseconds into those buckets, so every observation landed in +Inf and no percentile was
    // computable — the metric that should have shown the heartbeat p95 regression showed nothing.
    observeHist("partner_presence_heartbeat_latency_seconds", (Date.now() - __t0) / 1000);
    /**
     * Transport lag of the GPS fix this beat carried: how stale the position already was when it
     * arrived. Distinct from the handler's own latency above — a fast handler can still be serving
     * minutes-old coordinates, which is what makes a live map wrong.
     */
    if (loc?.lastLocationAt) {
      observeHist("partner_location_transport_lag_seconds", Math.max(0, (heartbeatAt.getTime() - loc.lastLocationAt.getTime()) / 1000));
    }
    incCounter("partner_presence_heartbeat_success_total");
    if (locationDuplicate) incCounter("partner_presence_heartbeat_duplicate_total");

    // Success is already on the histogram + counter. A structured info log per beat
    // serializes on the event loop; under mixed load that was part of the p95 stall.
    // Rejects still log via authorizeSession. sessionId is not written here.

    void import("./dispatch-eligibility.service")
      .then(({ trackProviderEligibilityTransition }) =>
        trackProviderEligibilityTransition(ctx.providerId, now, {
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
        }),
      )
      .catch(() => undefined);

    return {
      accepted: true,
      duplicate: locationDuplicate,
      snapshot: toSnapshot(ctx.providerId, row, providerRow.isOnline, now),
    };
  }

  /**
   * Standalone location ping.
   *
   * Deliberately does NOT advance `lastHeartbeatAt`: presence freshness and location
   * freshness are two independent pieces of evidence (failure matrix distinguishes
   * STALE_PRESENCE from STALE_LOCATION), so a client that only streams GPS must not be
   * able to masquerade as live. It does refresh `lastSeenAt`, which is literally that.
   */
  async locationPing(ctx: HeartbeatContext, input: PartnerLocationPingInput): Promise<HeartbeatResult> {
    const __t0 = Date.now();
    const now = new Date();

    const { provider: providerRow, existing } = await this.authorizeSession(
      ctx,
      input,
      "presence_location_ping",
      now,
    );

    const { duplicate, update } = buildLocationUpdate(input.location, existing, now, "location_ping");

    if (!update) {
      incCounter("partner_presence_heartbeat_duplicate_total");
      const row = existing ?? (await prisma.partnerPresence.findUnique({ where: { providerId: ctx.providerId } }));
      return { accepted: true, duplicate: true, snapshot: toSnapshot(ctx.providerId, row, providerRow.isOnline, now) };
    }

    const row = await prisma.$transaction(async (tx) => {
      const presence = await tx.partnerPresence.upsert({
        where: { providerId: ctx.providerId },
        create: {
          providerId: ctx.providerId,
          activeSessionId: input.sessionId,
          activeDeviceId: input.deviceId,
          lastSeenAt: now,
          ...update,
        },
        update: {
          activeSessionId: existing?.activeSessionId ?? input.sessionId,
          activeDeviceId: input.deviceId,
          lastSeenAt: now,
          ...update,
        },
      });

      await tx.location.upsert({
        where: { providerId: ctx.providerId },
        create: {
          providerId: ctx.providerId,
          latitude: update.lastLocationLat,
          longitude: update.lastLocationLng,
          accuracy: update.lastLocationAccuracy,
        },
        update: {
          latitude: update.lastLocationLat,
          longitude: update.lastLocationLng,
          accuracy: update.lastLocationAccuracy,
        },
      });

      return presence;
    });

    await cacheSetPresence(ctx.providerId, {
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      lastHeartbeatAt: (row.lastHeartbeatAt ?? now).toISOString(),
      lastLocationAt: row.lastLocationAt?.toISOString(),
    });

    observeHist("partner_presence_location_latency_seconds", (Date.now() - __t0) / 1000);
    incCounter("partner_presence_location_success_total");

    void import("./dispatch-eligibility.service")
      .then(({ trackProviderEligibilityTransition }) =>
        trackProviderEligibilityTransition(ctx.providerId, now, {
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
        }),
      )
      .catch(() => undefined);

    return {
      accepted: true,
      duplicate,
      snapshot: toSnapshot(ctx.providerId, row, providerRow.isOnline, now),
    };
  }
}

export const partnerPresenceService = new PartnerPresenceService();

/** Fire-and-forget session promotion after vendor auth. */
export async function promotePartnerSessionForUser(
  userId: string,
  sessionId: string,
  deviceId?: string | null,
): Promise<void> {
  const provider = await prisma.provider.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!provider) return;
  await partnerPresenceService.promoteSession(provider.id, sessionId, deviceId);
}
