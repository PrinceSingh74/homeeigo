import crypto from "crypto";
import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { logger } from "../lib/logger";

/**
 * Whether a feature is on, for this user, right now.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `platform_feature_flags` and its history table were already here, along with an admin write path
 * that validates the rollout percentage and records who changed what. What was missing was the
 * other half: nothing anywhere answered "is flag X enabled for user Y". Six Phase-7 features are
 * each supposed to be independently switchable, and none of them could be until something could
 * read a flag at runtime.
 *
 * This is that one reader. It is deliberately the only one — six features gating themselves six
 * different ways is how a kill switch ends up not killing anything.
 *
 * ── What a flag is, and is not ──────────────────────────────────────────────
 *
 * A flag may ENABLE a feature. It may never GRANT PERMISSION. Authorization, certification, risk
 * classification and notification governance all run regardless of what any flag says: a flag
 * being on is not evidence that an action is allowed, and every one of those checks is somewhere
 * else on purpose. Turning `AI_CONCIERGE` on does not let the concierge execute a tool the policy
 * engine would refuse.
 */

/**
 * Cache lifetime, and the worst case a disable can take to land.
 *
 * This is the ceiling, not the expectation. With Redis reachable an admin write is broadcast and
 * every process drops the key within a round trip; this TTL is what remains when the broadcast
 * cannot be delivered, which is exactly when a bound matters most.
 */
const CACHE_TTL_SECONDS = 30;

/**
 * The maximum time an admin's disable can take to stop being served, anywhere.
 *
 * Stated as a number so it can be asserted rather than believed. A measured window longer than this
 * is a defect in the invalidation path, not a slow day.
 */
export const FLAG_DISABLE_PROPAGATION_MAX_MS = CACHE_TTL_SECONDS * 1000;

/** The channel every process listens on so one admin write reaches all of them. */
const INVALIDATION_CHANNEL = "feature-flags:invalidate";

/**
 * Per-process cache, checked before Redis.
 *
 * Checking it first is what makes a flag read cheap, and it is also what made a disable take a full
 * TTL to land: a process cannot be told to forget something by another process deleting a Redis key
 * it is no longer reading. The broadcast below is what closes that gap — the local map stays the
 * fast path, and an admin write actively evicts it everywhere instead of waiting for it to rot.
 */
const memoryCache = new Map<string, { value: FlagRecord | null; expiresAt: number }>();

export type FlagRecord = {
  key: string;
  enabled: boolean;
  rolloutPct: number;
  environment: string;
  isKillSwitch: boolean;
};

export type FlagDecision = {
  enabled: boolean;
  /** Why, in a form worth logging. Never "true"/"false" alone. */
  reason:
    | "FLAG_MISSING"
    | "FLAG_DISABLED"
    | "KILL_SWITCH"
    | "ROLLOUT_EXCLUDED"
    | "ROLLOUT_INCLUDED"
    | "FULLY_ENABLED"
    | "LOOKUP_FAILED";
  bucket?: number;
};

/**
 * The environment a flag read is scoped to.
 *
 * Flags carry an `environment` column and the admin path defaults it to "production". Reading
 * without scoping would let a flag switched on in one environment change behaviour in another.
 */
/**
 * The environment this process considers itself to be in.
 *
 * Exported so the support automation gate reads the *same* value the flag store keys on. Two
 * independent notions of "which environment is this" is how a flag enabled for `dev` ends up
 * evaluated against `production`.
 */
export function currentEnvironment(): string {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

/**
 * Which bucket (0–99) this user falls in for this flag.
 *
 * Deterministic by construction: the same user and flag always land in the same bucket, so a 10%
 * rollout is a stable 10% of people rather than 10% of requests. `Math.random()` would give a user
 * the feature on one page load and take it away on the next.
 *
 * The flag key is part of the hash so that two flags at 10% do not select the same tenth of users.
 */
export function bucketFor(flagKey: string, subjectId: string): number {
  const digest = crypto.createHash("sha256").update(`${flagKey}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

async function loadFlag(key: string): Promise<FlagRecord | null> {
  const env = currentEnvironment();
  const cacheKey = `ff:${env}:${key}`;

  const mem = memoryCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) return mem.value;

  if (redisClient.isEnabled) {
    try {
      const raw = await redisClient.get(cacheKey);
      if (raw !== null) {
        const parsed = raw === "null" ? null : (JSON.parse(raw) as FlagRecord);
        memoryCache.set(cacheKey, { value: parsed, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
        return parsed;
      }
    } catch {
      // A cache miss and a broken cache are the same thing here: fall through to the database.
    }
  }

  const row = await prisma.platformFeatureFlag.findFirst({
    where: { key, environment: env },
    select: { key: true, enabled: true, rolloutPct: true, environment: true, isKillSwitch: true },
  });

  const value: FlagRecord | null = row ?? null;
  memoryCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
  if (redisClient.isEnabled) {
    await redisClient.set(cacheKey, JSON.stringify(value), CACHE_TTL_SECONDS).catch(() => undefined);
  }
  return value;
}

/**
 * Evaluate a flag for a subject, with the reason.
 *
 * ── The safe default ────────────────────────────────────────────────────────
 *
 * Every path that is not an explicit, enabled, in-rollout flag returns `false`. A missing row is
 * off. A lookup failure is off. An unparseable rollout is off. The alternative — defaulting to on
 * when the flag store is unreachable — would turn a database blip into an unreviewed feature
 * launch.
 */
export async function evaluateFlag(key: string, subjectId?: string): Promise<FlagDecision> {
  let flag: FlagRecord | null;
  try {
    flag = await loadFlag(key);
  } catch (err) {
    logger.warn("feature_flag_lookup_failed", {
      key,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return { enabled: false, reason: "LOOKUP_FAILED" };
  }

  if (!flag) return { enabled: false, reason: "FLAG_MISSING" };

  /**
   * A kill switch is checked before `enabled`, because its whole purpose is to override.
   * `isKillSwitch` with `enabled: false` means "this is off and stays off".
   */
  if (flag.isKillSwitch && !flag.enabled) return { enabled: false, reason: "KILL_SWITCH" };
  if (!flag.enabled) return { enabled: false, reason: "FLAG_DISABLED" };

  const pct = Number.isFinite(flag.rolloutPct) ? Math.trunc(flag.rolloutPct) : 0;
  if (pct >= 100) return { enabled: true, reason: "FULLY_ENABLED" };
  if (pct <= 0) return { enabled: false, reason: "ROLLOUT_EXCLUDED", bucket: undefined };

  /**
   * A partial rollout needs someone to roll out to. Without a subject there is no stable bucket,
   * and picking one at random would make the percentage meaningless — so it is off.
   */
  if (!subjectId) return { enabled: false, reason: "ROLLOUT_EXCLUDED" };

  const bucket = bucketFor(key, subjectId);
  return bucket < pct
    ? { enabled: true, reason: "ROLLOUT_INCLUDED", bucket }
    : { enabled: false, reason: "ROLLOUT_EXCLUDED", bucket };
}

/** The common case, when the caller only needs the answer. */
export async function isFeatureEnabled(key: string, subjectId?: string): Promise<boolean> {
  return (await evaluateFlag(key, subjectId)).enabled;
}

/** Drop cached values so an admin change takes effect without waiting out the TTL. */
export async function invalidateFlagCache(key: string): Promise<void> {
  const cacheKey = `ff:${currentEnvironment()}:${key}`;
  memoryCache.delete(cacheKey);
  if (redisClient.isEnabled) {
    await redisClient.del(cacheKey).catch(() => undefined);
    /**
     * Tell every other process to forget it too.
     *
     * Deleting the shared key is not enough on its own: each process holds its own copy and reads
     * that copy before it ever looks at Redis, so without this a disable lands here immediately and
     * everywhere else up to a TTL later. Reuses the pub/sub the platform already runs for WebSocket
     * fan-out rather than adding another cache layer to keep in step.
     */
    await redisClient.publish(INVALIDATION_CHANNEL, cacheKey).catch(() => undefined);
  }
}

let invalidationListener: (() => Promise<void>) | null = null;

/**
 * Start listening for flag invalidations broadcast by other processes.
 *
 * Called from the server bootstrap and nowhere else. Subscribing on import would open a Redis
 * subscriber connection in every script and test that so much as reads a flag, and those processes
 * have nothing to invalidate.
 */
export async function startFeatureFlagInvalidationListener(): Promise<void> {
  if (invalidationListener || !redisClient.isEnabled) return;
  try {
    invalidationListener = await redisClient.subscribe(INVALIDATION_CHANNEL, (cacheKey: string) => {
      memoryCache.delete(cacheKey);
      logger.info("feature_flag_cache_invalidated", { cacheKey });
    });
  } catch (err) {
    /**
     * A subscription that cannot be established degrades to the TTL, which is why the TTL is short
     * and declared. It must never stop the process from booting.
     */
    logger.warn("feature_flag_invalidation_listener_failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
  }
}

/** Stop listening. Used by graceful shutdown and by tests that opened a listener. */
export async function stopFeatureFlagInvalidationListener(): Promise<void> {
  const stop = invalidationListener;
  invalidationListener = null;
  if (stop) await stop().catch(() => undefined);
}

/** Test-only: clear the in-process layer between cases. */
export function __clearFlagMemoryCache(): void {
  memoryCache.clear();
}

/**
 * The Phase-7 flags.
 *
 * One flag per customer-visible capability, not one per function. Each is created disabled: a flag
 * that arrives switched on has skipped the review it exists to gate. `AI_FOLLOW_UP`, `AI_REBOOKING`
 * and `AI_SATISFACTION_INTELLIGENCE` extend this set for Step 7's post-service capabilities, added
 * the same way the first five were — no row in `platform_feature_flags` yet, which `evaluateFlag`
 * already treats as `FLAG_MISSING` → disabled. Provisioning a row is a separate, later act by an
 * admin through `PlatformIntelligenceService.upsertFlag`, not something this registration performs.
 */
export const PHASE7_FLAGS = {
  AI_CONCIERGE: "AI_CONCIERGE",
  AI_MAINTENANCE_INTELLIGENCE: "AI_MAINTENANCE_INTELLIGENCE",
  AI_PERSONALIZED_RECOMMENDATIONS: "AI_PERSONALIZED_RECOMMENDATIONS",
  AI_BOOKING_RECOVERY: "AI_BOOKING_RECOVERY",
  AI_VISION: "AI_VISION",
  AI_FOLLOW_UP: "AI_FOLLOW_UP",
  AI_REBOOKING: "AI_REBOOKING",
  AI_SATISFACTION_INTELLIGENCE: "AI_SATISFACTION_INTELLIGENCE",
} as const;
