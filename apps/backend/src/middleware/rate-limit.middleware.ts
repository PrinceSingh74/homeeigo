import { redisClient } from "../lib/redis";

type CounterEntry = { count: number; resetAt: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

const store = new Map<string, CounterEntry>();

/**
 * Expired buckets are removed, not merely ignored.
 *
 * This Map is the fallback used while Redis is unavailable. An entry whose `resetAt` has passed is
 * already treated as absent by every reader below, but nothing ever deleted one: it was overwritten
 * only if the same key came back. Measured in Section 7K, every distinct client seen during a Redis
 * outage stayed in memory for the life of the process — 30,000 after one outage, 60,000 after a
 * second, unchanged minutes later — and once Redis recovered the Map was never consulted again, so
 * nothing could ever reclaim them.
 *
 * Pruning only EXPIRED entries changes no limiting decision, so there is no size cap: evicting a live
 * bucket would hand that client a fresh allowance. The sweep is throttled and piggybacks on traffic
 * rather than owning a timer, and `consumeRateLimitSmart` runs it even when Redis is serving requests,
 * which is what clears what an outage left behind once Redis is back.
 */
const SWEEP_INTERVAL_MS = 30_000;
let lastSweep = 0;

function sweepExpired(now: number): void {
  if (store.size === 0 || now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, e] of store) {
    if (e.resetAt <= now) store.delete(k);
  }
}

export const consumeRateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
  sweepExpired(now);
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  entry.count += 1;
  store.set(key, entry);
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
};

/**
 * Rate-limit entry point used by the global API limiter. Uses Redis when it is
 * configured and reachable (so limits hold across multiple backend instances),
 * and transparently falls back to the in-memory `consumeRateLimit` above when
 * Redis is absent or errors — same limit logic either way, no duplication.
 */
export const consumeRateLimitSmart = async (
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> => {
  sweepExpired(Date.now());
  const viaRedis = await redisClient.consume(key, limit, Math.ceil(windowMs / 1000));
  return viaRedis ?? consumeRateLimit(key, limit, windowMs);
};

const peekRateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    return { allowed: true, remaining: limit, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
};

/** Check limit without incrementing (used before recording a login failure). */
export const peekRateLimitSmart = async (
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> => {
  const viaRedis = await redisClient.peek(key, limit, Math.ceil(windowMs / 1000));
  return viaRedis ?? peekRateLimit(key, limit, windowMs);
};

/** Clear a rate-limit bucket (e.g. after successful login). */
export const resetRateLimitSmart = async (key: string): Promise<void> => {
  await redisClient.resetRateLimit(key);
  store.delete(key);
};

/** True if this key already hit its limit within the active window (no increment). */
export const isRateLimitExceeded = (key: string, limit: number) => {
  const entry = store.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= limit;
};
