import { redisClient } from "../lib/redis";
import { incCounter } from "../lib/metrics";

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
  /**
   * Return cached value for `key`, or run `fetchFn`, cache it for `ttlSec`, and return it.
   *
   * `l1Sec` enables a short-lived in-process L1 in FRONT of Redis: under thousands
   * of concurrent requests, a per-request Redis round-trip becomes the latency
   * floor; a 5–15s L1 keeps hot catalog reads at memory speed while Redis remains
   * the shared L2 across instances.
   */
  async getOrFetch<T>(key: string, ttlSec: number, fetchFn: () => Promise<T>, l1Sec = 0): Promise<T> {
    const k = PREFIX + key;
    const domain = key.split(":")[0] || "other"; // weather | catalog | heatmap | ops-map …

    // 0. L1 micro-cache (opt-in, very short TTL).
    if (l1Sec > 0) {
      const entry = memStore.get(k);
      if (entry && entry.expiresAt > Date.now()) {
        incCounter("cache_hits_total", { tier: "l1", domain });
        return JSON.parse(entry.value) as T;
      }
    }

    // 1. Shared cache (preferred when Redis is up).
    const fromRedis = await redisClient.get(k);
    if (fromRedis !== null) {
      if (l1Sec > 0) memStore.set(k, { value: fromRedis, expiresAt: Date.now() + l1Sec * 1000 });
      incCounter("cache_hits_total", { tier: "l2", domain });
      return JSON.parse(fromRedis) as T;
    }

    // 2. In-memory fallback only when Redis is off (avoids serving stale local
    //    data once a shared Redis is available).
    if (!redisClient.isAvailable) {
      const entry = memStore.get(k);
      if (entry && entry.expiresAt > Date.now()) {
        incCounter("cache_hits_total", { tier: "mem", domain });
        return JSON.parse(entry.value) as T;
      }
      if (entry) memStore.delete(k); // expired
    }

    // 3. Miss → source of truth, then populate whichever cache is active.
    incCounter("cache_misses_total", { domain });
    const data = await fetchFn();
    const serialized = JSON.stringify(data);
    const storedInRedis = await redisClient.set(k, serialized, ttlSec);
    if (!storedInRedis || l1Sec > 0) {
      const memTtl = l1Sec > 0 ? l1Sec : ttlSec;
      memStore.set(k, { value: serialized, expiresAt: Date.now() + memTtl * 1000 });
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
