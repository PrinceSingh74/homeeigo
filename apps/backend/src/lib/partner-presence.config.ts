/**
 * Configurable presence + location freshness thresholds.
 * Env overrides allow tuning without redeploying business logic.
 */
function readSec(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Expected client heartbeat cadence (informational). */
export const PRESENCE_HEARTBEAT_INTERVAL_SEC = readSec("PRESENCE_HEARTBEAT_INTERVAL_SEC", 25);

/** Redis TTL — key expires after this many seconds without refresh. */
export const PRESENCE_REDIS_TTL_SEC = readSec("PRESENCE_REDIS_TTL_SEC", 90);

/** Age ≤ this → FRESH (derived, not stored). */
export const PRESENCE_FRESH_SEC = readSec("PRESENCE_FRESH_SEC", 30);

/** Age ≤ this → STALE; beyond → EXPIRED. */
export const PRESENCE_STALE_SEC = readSec("PRESENCE_STALE_SEC", 60);

/** Location capturedAt age ≤ this → location fresh. */
export const LOCATION_FRESH_SEC = readSec("PRESENCE_LOCATION_FRESH_SEC", 60);

export const LOCATION_STALE_SEC = readSec("PRESENCE_LOCATION_STALE_SEC", 600);

/** Reject client timestamps more than this many seconds in the future. */
export const TIMESTAMP_FUTURE_TOLERANCE_SEC = readSec("PRESENCE_TIMESTAMP_FUTURE_TOLERANCE_SEC", 30);

/** Reject client timestamps older than this (replay guard). */
export const TIMESTAMP_MAX_AGE_SEC = readSec("PRESENCE_TIMESTAMP_MAX_AGE_SEC", 300);

/** Max plausible speed for impossible-jump detection (km/h). */
export const LOCATION_MAX_SPEED_KMH = readSec("PRESENCE_LOCATION_MAX_SPEED_KMH", 200);

/** Duplicate location: same coords within this window are ignored (no DB write). */
export const LOCATION_DUPLICATE_WINDOW_SEC = readSec("PRESENCE_LOCATION_DUPLICATE_WINDOW_SEC", 5);

/** Per-partner heartbeat rate limit (fixed window). */
export const HEARTBEAT_RATE_LIMIT = readSec("PRESENCE_HEARTBEAT_RATE_LIMIT", 6);
export const HEARTBEAT_RATE_WINDOW_SEC = readSec("PRESENCE_HEARTBEAT_RATE_WINDOW_SEC", 10);

export const PRESENCE_REDIS_KEY = (providerId: string) => `partner:presence:${providerId}`;

/** Legacy ops-map key — refreshed alongside canonical key for backward compatibility. */
export const LEGACY_PRESENCE_REDIS_KEY = (providerId: string) => `provider:${providerId}:online`;

export type DerivedFreshness = "FRESH" | "STALE" | "EXPIRED";
