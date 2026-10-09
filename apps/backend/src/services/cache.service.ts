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

/**
 * The in-process store is bounded two ways: expired entries are swept, and the store is capped.
 *
 * Entries were only ever removed lazily, when the SAME key was read again after expiring. Keys embed
 * request parameters (`catalog:category:<category>:<page>:<limit>`), so while Redis is unavailable
 * every distinct page a client asks for adds an entry nobody will read again. Measured in Section 7K:
 * 3,000 distinct pages requested during an outage left 3,000 entries resident after Redis recovered.
 *
 * Unlike a rate-limit bucket, a cache entry can always be dropped — the next read refetches from the
 * source of truth — so a hard cap is safe here. It uses the same 5,000-entry / oldest-10% policy the
 * idempotency middleware already applies to its own in-memory fallback. The sweep is throttled and
 * runs on the read path, so no timer is added.
 */
const MEM_MAX_ENTRIES = 5000;
const MEM_SWEEP_INTERVAL_MS = 30_000;
let lastMemSweep = 0;

function sweepMemStore(now: number): void {
  if (memStore.size > 0 && now - lastMemSweep >= MEM_SWEEP_INTERVAL_MS) {
    lastMemSweep = now;
    for (const [k, e] of memStore) {
      if (e.expiresAt <= now) memStore.delete(k);
    }
  }
  if (memStore.size > MEM_MAX_ENTRIES) {
    let drop = Math.ceil(memStore.size * 0.1);
    for (const k of memStore.keys()) {
      if (drop-- <= 0) break;
      memStore.delete(k);
    }
  }
}

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
    sweepMemStore(Date.now());
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

  /**
   * Drop every key under a prefix. Exact-key invalidation misses `catalog:list:v2:…`
   * (page, limit and filters are part of the key), so a write stayed invisible until TTL.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    const k = PREFIX + prefix;
    for (const key of [...memStore.keys()]) {
      if (key.startsWith(k)) memStore.delete(key);
    }
    await redisClient.delByPrefix(k);
  }
}

export const cacheService = new CacheService();
