import { redisClient } from "../lib/redis";

type CounterEntry = { count: number; resetAt: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

const store = new Map<string, CounterEntry>();

export const consumeRateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
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
  const viaRedis = await redisClient.consume(key, limit, Math.ceil(windowMs / 1000));
  return viaRedis ?? consumeRateLimit(key, limit, windowMs);
};

/** True if this key already hit its limit within the active window (no increment). */
export const isRateLimitExceeded = (key: string, limit: number) => {
  const entry = store.get(key);
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= limit;
};
