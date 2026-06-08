import { redisClient } from "../lib/redis";

/**
 * Generic read-through cache for hot, rarely-changing reads (e.g. the service
 * catalog). PostgreSQL stays the source of truth — this only accelerates reads:
 *
 *   - Redis available  → shared cache across all backend instances.
 *   - Redis absent      → small in-memory per-instance cache (single-instance dev
 *                         still benefits), so behaviour is identical, just faster.
 *   - Cache miss        → run the fetch fn (DB) and populate the cache.
 *
 * A cache outage can never lose data or change results; it only costs a DB hit.
 */

type MemEntry = { value: string; expiresAt: number };

const PREFIX = "cache:";
const memStore = new Map<string, MemEntry>();

class CacheService {
  /** Return cached value for `key`, or run `fetchFn`, cache it for `ttlSec`, and return it. */
  async getOrFetch<T>(key: string, ttlSec: number, fetchFn: () => Promise<T>): Promise<T> {
    const k = PREFIX + key;

    // 1. Shared cache (preferred when Redis is up).
    const fromRedis = await redisClient.get(k);
    if (fromRedis !== null) return JSON.parse(fromRedis) as T;

    // 2. In-memory fallback only when Redis is off (avoids serving stale local
    //    data once a shared Redis is available).
    if (!redisClient.isAvailable) {
      const entry = memStore.get(k);
      if (entry && entry.expiresAt > Date.now()) return JSON.parse(entry.value) as T;
      if (entry) memStore.delete(k); // expired
    }

    // 3. Miss → source of truth, then populate whichever cache is active.
    const data = await fetchFn();
    const serialized = JSON.stringify(data);
    const storedInRedis = await redisClient.set(k, serialized, ttlSec);
    if (!storedInRedis) {
      memStore.set(k, { value: serialized, expiresAt: Date.now() + ttlSec * 1000 });
    }
    return data;
  }

  /** Drop a cached key from both Redis and the in-memory store (use after a mutation). */
  async invalidate(key: string): Promise<void> {
    const k = PREFIX + key;
    await redisClient.del(k);
    memStore.delete(k);
  }
}

export const cacheService = new CacheService();
