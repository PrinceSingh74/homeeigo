/**
 * Presence monitor — turns silence into an observable, auditable fact.
 *
 * Redis TTL expiry is invisible: a partner whose phone died simply stops appearing in the
 * cache, and nothing in the system says so. Dispatch is already safe without this sweep
 * (every gate derives freshness from timestamps at read time and fails closed), so this
 * worker exists for observability and automation, not for correctness of the gate.
 *
 * FOUR-AXIS LOCK: this worker writes NOTHING on the lifecycle, availability, job, or
 * finance axes. Stale presence is not a suspension, not an availability change, not a job
 * cancellation, and not a money event. It only emits events and moves gauges.
 */
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { setGauge } from "../lib/metrics";
import { redisClient } from "../lib/redis";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildPartnerPresenceStaleEvent,
  buildPartnerPresenceExpiredEvent,
  buildPartnerLocationStaleEvent,
} from "../events/catalog/partner.events";
import {
  derivePresenceFreshness,
  deriveLocationFreshness,
} from "../lib/partner-presence-freshness";
import { trackProviderEligibilityTransition } from "./dispatch-eligibility.service";
import { PRESENCE_STALE_SEC, LOCATION_STALE_SEC } from "../lib/partner-presence.config";
import type { DerivedFreshness } from "../lib/partner-presence.config";

/** Cap per tick so one sweep can never become a write storm. */
const SWEEP_BATCH = Number(process.env.PRESENCE_SWEEP_BATCH ?? 500);

/** Remembers the last emitted degradation so a partner offline for a week emits once, not forever. */
const PRESENCE_NOTIFIED_KEY = (providerId: string) => `presence:degraded:${providerId}`;
const LOCATION_NOTIFIED_KEY = (providerId: string) => `presence:loc_degraded:${providerId}`;
const NOTIFIED_TTL_SEC = 86_400;

const presenceNotifiedMem = new Map<string, string>();
const locationNotifiedMem = new Map<string, string>();

async function readNotified(key: string, mem: Map<string, string>): Promise<string | null> {
  try {
    const raw = await redisClient.get(key);
    if (raw) return raw;
  } catch {
    /* Redis is optional here — the in-memory map keeps a single node de-duplicated. */
  }
  return mem.get(key) ?? null;
}

async function writeNotified(key: string, mem: Map<string, string>, value: string): Promise<void> {
  mem.set(key, value);
  try {
    await redisClient.set(key, value, NOTIFIED_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

async function clearNotified(key: string, mem: Map<string, string>): Promise<void> {
  mem.delete(key);
  try {
    await redisClient.del(key);
  } catch {
    /* best-effort */
  }
}

export type PresenceSweepResult = {
  scanned: number;
  stale: number;
  expired: number;
  locationStale: number;
  eventsEmitted: number;
};

/**
 * One sweep over partners who *claim* to be online.
 *
 * Only `isOnline` partners are scanned: an OFFLINE partner not sending heartbeats is
 * correct behaviour, not a degradation, and alerting on it would bury the real signal.
 */
export async function sweepStalePresence(now = new Date()): Promise<PresenceSweepResult> {
  const result: PresenceSweepResult = { scanned: 0, stale: 0, expired: 0, locationStale: 0, eventsEmitted: 0 };

  const rows = await prisma.partnerPresence.findMany({
    where: { provider: { isOnline: true, lifecycleState: "ACTIVE", isActive: true, isBanned: false } },
    select: {
      providerId: true,
      lastHeartbeatAt: true,
      lastLocationAt: true,
    },
    orderBy: { updatedAt: "asc" },
    take: SWEEP_BATCH,
  });

  result.scanned = rows.length;

  const degraded: Array<{
    providerId: string;
    presence: DerivedFreshness;
    location: DerivedFreshness;
    lastHeartbeatAt: Date | null;
    lastLocationAt: Date | null;
  }> = [];

  for (const row of rows) {
    const presence = derivePresenceFreshness({ lastHeartbeatAt: row.lastHeartbeatAt, now });
    const location = deriveLocationFreshness({ lastLocationAt: row.lastLocationAt, now });

    if (presence === "STALE") result.stale++;
    if (presence === "EXPIRED") result.expired++;
    if (location !== "FRESH") result.locationStale++;

    degraded.push({
      providerId: row.providerId,
      presence,
      location,
      lastHeartbeatAt: row.lastHeartbeatAt,
      lastLocationAt: row.lastLocationAt,
    });
  }

  setGauge("partner_presence_stale_total", result.stale);
  setGauge("partner_presence_expired_total", result.expired);
  setGauge("partner_location_stale_total", result.locationStale);

  const eventsOn = eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled;

  for (const entry of degraded) {
    const presenceKey = PRESENCE_NOTIFIED_KEY(entry.providerId);
    const locationKey = LOCATION_NOTIFIED_KEY(entry.providerId);

    // Recovery: heartbeat came back, so the next degradation is allowed to speak again.
    if (entry.presence === "FRESH") {
      await clearNotified(presenceKey, presenceNotifiedMem);
    } else if (eventsOn) {
      const previous = await readNotified(presenceKey, presenceNotifiedMem);
      if (previous !== entry.presence) {
        await writeNotified(presenceKey, presenceNotifiedMem, entry.presence);
        const payload = {
          providerId: entry.providerId,
          detectedAt: now.toISOString(),
          lastHeartbeatAt: entry.lastHeartbeatAt?.toISOString() ?? null,
        };
        await prisma
          .$transaction((tx) =>
            emitInTransaction(
              tx,
              entry.presence === "EXPIRED"
                ? buildPartnerPresenceExpiredEvent(payload)
                : buildPartnerPresenceStaleEvent(payload),
            ),
          )
          .then(() => {
            result.eventsEmitted++;
          })
          .catch(() => undefined);
      }
    }

    if (entry.location === "FRESH") {
      await clearNotified(locationKey, locationNotifiedMem);
    } else if (eventsOn) {
      const previous = await readNotified(locationKey, locationNotifiedMem);
      if (previous !== entry.location) {
        await writeNotified(locationKey, locationNotifiedMem, entry.location);
        await prisma
          .$transaction((tx) =>
            emitInTransaction(
              tx,
              buildPartnerLocationStaleEvent({
                providerId: entry.providerId,
                detectedAt: now.toISOString(),
                lastLocationAt: entry.lastLocationAt?.toISOString() ?? null,
              }),
            ),
          )
          .then(() => {
            result.eventsEmitted++;
          })
          .catch(() => undefined);
      }
    }

    // Recompute eligibility so `partner.dispatch_eligibility.changed` fires on the way DOWN
    // too. Without this, the transition is only ever observed on the next heartbeat — which,
    // for a partner whose phone died, never arrives.
    if (entry.presence !== "FRESH" || entry.location !== "FRESH") {
      await trackProviderEligibilityTransition(entry.providerId, now).catch(() => undefined);
    }
  }

  if (result.stale + result.expired + result.locationStale > 0) {
    logger.info("presence_sweep", {
      category: "PROVIDER",
      scanned: result.scanned,
      stale: result.stale,
      expired: result.expired,
      locationStale: result.locationStale,
      staleThresholdSec: PRESENCE_STALE_SEC,
      locationStaleThresholdSec: LOCATION_STALE_SEC,
    });
  }

  return result;
}

export const partnerPresenceMonitor = { sweepStalePresence };
