import { createClient } from "redis";
import { incCounter, registerRedisMetricsProvider } from "./metrics";

/**
 * Optional Redis client.
 *
 * HOMIGO is single-instance by default and PostgreSQL is the source of truth.
 * Redis is a pure performance/scaling layer: it is only used when REDIS_URL is
 * set AND reachable. When it is absent or down, every caller falls back to the
 * existing in-memory implementation, so local dev needs no Redis running and
 * there are zero breaking changes.
 *
 * Capabilities:
 *   - get/set/del              → read-through cache (cache.service.ts)
 *   - consume                  → atomic distributed rate limiting (rate-limit.middleware)
 *   - publish/subscribe        → cross-instance fan-out for WebSocket rooms
 *   - getMetrics               → live INFO stats (clients, memory, hit-rate) for /metrics
 *   - startHealthChecking      → periodic PING so a silent drop is detected promptly
 */

export type LimitResult = { allowed: boolean; remaining: number; resetAt: number };

export type RedisMetrics = {
  enabled: boolean;
  available: boolean;
  topology: "disabled" | "standalone" | "cluster";
  connectedClients: number;
  usedMemoryHuman: string;
  usedMemoryBytes?: number;
  evictedKeys?: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number; // 0..1; 0 when no reads yet
  subscriptions: number;
  lastError: string | null;
};

type RedisClientType = ReturnType<typeof createClient>;

const REDIS_URL = process.env.REDIS_URL?.trim() ?? "";
const MAX_RETRIES = Number(process.env.REDIS_MAX_RETRIES || 3);
/**
 * How long any single Redis command may take before it is treated as a failure.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 *
 * `reconnectStrategy` handles a DEAD Redis: the socket refuses, `error` fires, `connected` goes
 * false, and every caller falls through to the in-memory path. It does nothing for a FROZEN Redis —
 * one that still holds the TCP connection open but never answers. There is no error to catch, so
 * `connected` stays true, `isAvailable` stays true, and `await client.incr(...)` never settles. The
 * try/catch around every command cannot fire, because nothing throws.
 *
 * Measured on an isolated instance frozen with `docker pause` (Section 7C):
 *
 *     GET  /api/services            4 ms   — unaffected
 *     GET  /api/bookings/upcoming  31 ms   — unaffected
 *     POST /api/auth/send-otp      HUNG    — ended only by the client's 20s timeout
 *     POST /api/auth/login         HUNG    — ended only by the client's 20s timeout
 *
 * Both doors into the system, held open indefinitely, each hung request holding a connection. A
 * degraded optional dependency became a total authentication outage — and "slow" produced a worse
 * result than "down", because only "down" reaches the fallback.
 *
 * Five seconds is far above any healthy local or managed-Redis command (observed here: 6-9 ms) and
 * far below a user's patience. Tunable for environments with a genuinely distant Redis.
 */
const COMMAND_TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 5000);
// Cluster URLs use rediss+cluster:// or comma-separated nodes via REDIS_CLUSTER.
// We keep a single managed endpoint (Upstash / ElastiCache / Redis Cloud) as the
// default production path — that endpoint is itself an HA primary, so the app
// code stays topology-agnostic.
const IS_CLUSTER = (process.env.REDIS_TOPOLOGY || "").toLowerCase() === "cluster";

class RedisClient {
  private client: RedisClientType | null = null;
  private connected = false;
  private hadConnectedOnce = false;
  private readonly enabled = REDIS_URL.length > 0;
  private warned = false;
  private lastError: string | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  // Dedicated duplicated connections for Pub/Sub (node-redis requires a separate
  // connection in subscriber mode). Tracked so disconnect() tears them down.
  private subscribers: RedisClientType[] = [];

  /**
   * Run a Redis command under a deadline, and make a timeout indistinguishable from an error.
   *
   * Every command method already wraps its work in `try { ... } catch { <fallback> }`. This races the
   * command against a timer and THROWS on expiry, so an unanswering server lands in that same catch
   * and reaches the same in-memory fallback the error path already uses. No caller changes, no second
   * abstraction, no new retry or backoff logic — the existing degradation strategy simply becomes
   * reachable for the failure mode that previously bypassed it.
   *
   * The losing promise is left to settle on its own: node-redis has already queued the command, and
   * there is nothing useful to do with a reply that arrives after the deadline. The timer is always
   * cleared so a slow command cannot keep the process alive.
   */
  private async withDeadline<T>(operation: string, run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            incCounter("redis_command_timeout_total", { operation });
            /**
             * A timeout means this server is not answering, so stop asking.
             *
             * Bounding each command was not enough on its own. With `connected` left true,
             * `isAvailable` stayed true and EVERY subsequent request paid the full deadline again —
             * measured at 15.9s for `send-otp`, which issues two rate-limit calls, and 15.4s for the
             * one after it. Bounded, but still unusable.
             *
             * Marking the client unavailable is exactly what the `error` handler already does for a
             * dead Redis, and it makes the same fallbacks engage immediately for a frozen one. No new
             * circuit breaker: `startHealthChecking` already PINGs periodically and its own `ready`
             * event flips `connected` back, so recovery needs nothing added either.
             */
            this.connected = false;
            this.lastError = `${operation} exceeded ${COMMAND_TIMEOUT_MS}ms`;
            if (!this.warned) {
              console.warn(`[redis] unresponsive — using in-memory fallback. ${this.lastError}`);
              this.warned = true;
            }
            reject(new Error(`redis ${operation} exceeded ${COMMAND_TIMEOUT_MS}ms`));
          }, COMMAND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Configured via REDIS_URL (regardless of current connection state). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Safe to issue commands right now. */
  get isAvailable(): boolean {
    return this.enabled && this.connected && this.client !== null;
  }

  /** Reported topology for observability. */
  get topology(): RedisMetrics["topology"] {
    if (!this.enabled) return "disabled";
    return IS_CLUSTER ? "cluster" : "standalone";
  }

  /** Connect if configured. Never throws — failure leaves us on the in-memory path. */
  async connect(): Promise<void> {
    if (!this.enabled || this.client) return;

    const client = createClient({
      url: REDIS_URL,
      socket: {
        /**
         * Give up only if Redis has NEVER been reachable in this process.
         *
         * The retry ceiling exists so a Redis that is absent at boot cannot hold `connect()` open
         * forever. Applied to a client that HAD connected, it turned any hard outage outlasting the
         * budget into a permanent one: measured in Section 7K, a 90-second stop of the isolated Redis
         * left the server on the in-memory fallback for as long as it was watched (five minutes after
         * Redis was healthy again), with zero Redis clients, zero `ws:fanout` subscribers while
         * `roomManager` still reported itself subscribed, and every new client written into the
         * never-evicted rate-limit fallback store. A 5-second and a 40-second outage recovered; the
         * cliff was the budget, not the outage.
         *
         * Once connected, the client keeps retrying at the capped backoff. That costs nothing while
         * Redis is away — callers already consult `isAvailable` and fall back immediately, and every
         * command carries its own deadline — and it means recovery needs no restart. Subscriber
         * connections are `duplicate()`s of this client and inherit the same strategy, so fan-out and
         * the feature-flag listener resubscribe on their own.
         */
        reconnectStrategy: (retries) =>
          !this.hadConnectedOnce && retries > MAX_RETRIES ? false : Math.min(retries * 200, 2000),
      },
    });

    client.on("error", (err: unknown) => {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      if (!this.warned) {
        console.warn(`[redis] unavailable — using in-memory fallback. ${this.lastError}`);
        this.warned = true;
      }
    });
    client.on("ready", () => {
      const wasReconnect = this.hadConnectedOnce && !this.connected;
      this.connected = true;
      this.hadConnectedOnce = true;
      this.warned = false;
      this.lastError = null;
      if (wasReconnect) incCounter("redis_reconnect_total");
      console.log(`[redis] connected (${this.topology})`);
    });
    client.on("end", () => {
      this.connected = false;
    });

    this.client = client;
    try {
      await client.connect();
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[redis] initial connect failed — using in-memory fallback. ${this.lastError}`);
    }
  }

  /** Graceful shutdown — closes the main client and every subscriber connection. */
  async disconnect(): Promise<void> {
    this.stopHealthChecking();
    for (const sub of this.subscribers) {
      try {
        await sub.quit();
      } catch {
        /* already closed */
      }
    }
    this.subscribers = [];
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      /* already closed */
    }
    this.client = null;
    this.connected = false;
  }

  /** PING for /health. */
  /**
   * Ping, and let the answer DECIDE availability — in both directions.
   *
   * ── Why the guard had to change ─────────────────────────────────────────
   *
   * This began `if (!this.isAvailable || !this.client) return false;`, so the moment `connected`
   * went false the health check stopped pinging and returned false forever. A check that refuses to
   * run while unhealthy cannot observe recovery: it is only capable of confirming health it already
   * assumed.
   *
   * That was survivable while `connected` only went false on a socket error, because node-redis's
   * own `ready` event restored it on reconnect. It stopped being survivable once a command timeout
   * could also clear the flag: a Redis frozen and then unfrozen keeps its TCP connection throughout,
   * so no reconnect ever fires. Measured before this change — Redis restored, and the process still
   * reported `degraded` 76 seconds later, permanently pinned to the in-memory path.
   *
   * Gated on `enabled` and a live client only. The ping itself is the evidence, and it carries the
   * same deadline as every other command, so a still-frozen server costs one bounded wait rather
   * than a hang.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      const alive = (await this.withDeadline("ping", () => this.client!.ping())) === "PONG";
      if (alive && !this.connected) {
        this.connected = true;
        this.warned = false;
        this.lastError = null;
        incCounter("redis_reconnect_total");
        console.log("[redis] responsive again — leaving the in-memory fallback");
      } else if (!alive) {
        this.connected = false;
      }
      return alive;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /**
   * Periodic PING. node-redis surfaces hard failures via the "error" event, but a
   * lightweight liveness probe catches a silently half-open socket and keeps
   * `connected` honest so isAvailable can't lie to callers. No-op when disabled.
   */
  startHealthChecking(intervalMs = Number(process.env.REDIS_HEALTH_CHECK_INTERVAL || 30000)): void {
    if (!this.enabled || this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      void this.healthCheck();
    }, intervalMs);
    // Don't keep the process alive solely for the health timer.
    (this.healthTimer as { unref?: () => void }).unref?.();
  }

  stopHealthChecking(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /** GET a string value. Returns null when Redis is unavailable (caller falls back). */
  async get(key: string): Promise<string | null> {
    if (!this.isAvailable || !this.client) return null;
    try {
      return await this.withDeadline("get", () => this.client!.get(key));
    } catch {
      return null;
    }
  }

  /** SET a string value with optional TTL (seconds). Returns false when not stored. */
  async set(key: string, value: string, ttlSec?: number): Promise<boolean> {
    if (!this.isAvailable || !this.client) return false;
    try {
      await this.withDeadline("set", () => this.client!.set(key, value, ttlSec ? { EX: ttlSec } : undefined));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a key and delete it in one server-side step (GETDEL) — for single-use tokens, where a GET
   * followed by a DEL would let two concurrent readers both see the value.
   * `answered: false` means Redis could not be asked; the caller decides its own fallback.
   */
  async take(key: string): Promise<{ answered: true; value: string | null } | { answered: false }> {
    if (!this.isAvailable || !this.client) return { answered: false };
    try {
      const value = await this.withDeadline("getdel", () => this.client!.getDel(key));
      return { answered: true, value: value ?? null };
    } catch {
      return { answered: false };
    }
  }

  /** DEL a key. No-op when Redis is unavailable. */
  async del(key: string): Promise<void> {
    if (!this.isAvailable || !this.client) return;
    try {
      await this.withDeadline("del", () => this.client!.del(key));
    } catch {
      /* ignore */
    }
  }

  /**
   * Delete every key matching `prefix*`. Used when a write invalidates a family of
   * cache keys (every catalogue page and filter), not one exact key.
   */
  async delByPrefix(prefix: string): Promise<void> {
    if (!this.isAvailable || !this.client || !prefix) return;
    try {
      await this.withDeadline("scan", async () => {
        const keys: string[] = [];
        for await (const key of this.client!.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
          if (typeof key === "string") keys.push(key);
          else if (Array.isArray(key)) keys.push(...key);
        }
        if (keys.length > 0) await this.client!.del(keys);
      });
    } catch {
      /* ignore — the next read refetches */
    }
  }

  /**
   * Distributed lock (SET NX + EX). Returns true when the lock is acquired.
   * Falls back to in-memory when Redis is unavailable (single-instance safe).
   */
  async acquireLock(key: string, token: string, ttlSec: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (this.isAvailable && this.client) {
      try {
        const ok = await this.withDeadline("setnx", () => this.client!.set(lockKey, token, { NX: true, EX: ttlSec }));
        return ok === "OK";
      } catch {
        /**
         * Redis was reachable enough to be `isAvailable` yet this specific command still failed
         * (a mid-request drop). Falling back here is silently correct on a single instance, but
         * on N instances every one of them independently falls back to its OWN in-memory lock —
         * losing cross-instance mutual exclusion with no external signal that coordination has
         * degraded. This counter is that signal.
         */
        incCounter("homigo_lock_fallback_total", { key, reason: "redis_error" });
        return memAcquireLock(lockKey, token, ttlSec);
      }
    }
    incCounter("homigo_lock_fallback_total", { key, reason: "redis_unavailable" });
    return memAcquireLock(lockKey, token, ttlSec);
  }

  /**
   * Extend TTL for a lock this token already holds. Returns false when the key is
   * missing, expired, or owned by someone else — never SET NX / re-acquire.
   *
   * `acquireLock` is SET NX: calling it to "refresh" cannot extend Redis TTL, and on
   * the in-memory fallback it re-takes a cleared/expired key, which leaks leadership
   * across ticks (and across tests that reset the map while a tick is still running).
   */
  async refreshLock(key: string, token: string, ttlSec: number): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (this.isAvailable && this.client) {
      try {
        // Compare-and-expire in one server-side step. GET followed by EXPIRE is two round trips:
        // between them the lease can lapse and another node acquire, and the EXPIRE would then
        // extend a lock we no longer own.
        const res = await this.withDeadline("eval:refresh", () =>
          this.client!.eval(LUA_REFRESH_IF_OWNER, {
            keys: [lockKey],
            arguments: [token, String(ttlSec)],
          }),
        );
        return Number(res) === 1;
      } catch {
        incCounter("homigo_lock_fallback_total", { key, reason: "redis_error" });
        return memRefreshLock(lockKey, token, ttlSec);
      }
    }
    return memRefreshLock(lockKey, token, ttlSec);
  }

  /** Release lock only if token matches (prevents releasing another holder's lock). */
  async releaseLock(key: string, token: string): Promise<void> {
    const lockKey = `lock:${key}`;
    if (this.isAvailable && this.client) {
      try {
        // Compare-and-delete in one server-side step (the textbook Redlock release). GET + DEL
        // over two round trips can delete a lock that a new owner acquired in between.
        await this.withDeadline("eval:release", () =>
          this.client!.eval(LUA_RELEASE_IF_OWNER, { keys: [lockKey], arguments: [token] }),
        );
        return;
      } catch {
        // The lease will lapse on its own at TTL; record that the release path degraded so a
        // pattern of these is visible rather than silent.
        incCounter("homigo_lock_fallback_total", { key, reason: "redis_error_release" });
      }
    }
    memReleaseLock(lockKey, token);
  }

  /**
   * Distributed-only acquire: never falls back to process memory. Returns "unavailable" when Redis
   * cannot answer so the caller can choose a real cross-node fallback (Postgres advisory lock) or
   * fail closed, instead of every node quietly electing itself leader.
   */
  async tryAcquireDistributedLock(
    key: string,
    token: string,
    ttlSec: number,
  ): Promise<"acquired" | "held" | "unavailable"> {
    const lockKey = `lock:${key}`;
    if (!(this.isAvailable && this.client)) return "unavailable";
    try {
      const ok = await this.withDeadline("setnx", () => this.client!.set(lockKey, token, { NX: true, EX: ttlSec }));
      return ok === "OK" ? "acquired" : "held";
    } catch {
      incCounter("homigo_lock_fallback_total", { key, reason: "redis_error" });
      return "unavailable";
    }
  }

  /**
   * Atomic fixed-window rate-limit counter (INCR + first-hit EXPIRE).
   * Returns null when Redis is unavailable so the caller can fall back to the
   * in-memory limiter — this keeps a single source of limit logic per tier.
   */
  async consume(key: string, limit: number, windowSec: number): Promise<LimitResult | null> {
    if (!this.isAvailable || !this.client) return null;
    try {
      const k = `ratelimit:${key}`;
      const count = await this.withDeadline("incr", () => this.client!.incr(k));
      let ttl: number;
      if (count === 1) {
        await this.withDeadline("expire", () => this.client!.expire(k, windowSec));
        ttl = windowSec;
      } else {
        ttl = await this.withDeadline("ttl", () => this.client!.ttl(k));
        if (ttl < 0) {
          await this.withDeadline("expire", () => this.client!.expire(k, windowSec));
          ttl = windowSec;
        }
      }
      const resetAt = Date.now() + ttl * 1000;
      if (count > limit) return { allowed: false, remaining: 0, resetAt };
      return { allowed: true, remaining: Math.max(0, limit - count), resetAt };
    } catch {
      return null; // transient error → in-memory fallback
    }
  }

  /** Read current counter without incrementing (for pre-check before recording a failure). */
  async peek(key: string, limit: number, windowSec: number): Promise<LimitResult | null> {
    if (!this.isAvailable || !this.client) return null;
    try {
      const k = `ratelimit:${key}`;
      const raw = await this.withDeadline("get", () => this.client!.get(k));
      if (!raw) {
        return { allowed: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
      }
      const count = Number.parseInt(raw, 10) || 0;
      const ttl = await this.withDeadline("ttl", () => this.client!.ttl(k));
      const resetAt = Date.now() + (ttl > 0 ? ttl : windowSec) * 1000;
      if (count > limit) return { allowed: false, remaining: 0, resetAt };
      return { allowed: true, remaining: Math.max(0, limit - count), resetAt };
    } catch {
      return null;
    }
  }

  /** Clear a rate-limit counter (e.g. after successful login). */
  async resetRateLimit(key: string): Promise<void> {
    await this.del(`ratelimit:${key}`);
  }

  /**
   * Publish a message to a channel for cross-instance fan-out (e.g. WebSocket
   * broadcasts). Returns the number of subscribers that received it, or 0 when
   * Redis is unavailable (single-instance dev just delivers locally).
   */
  async publish(channel: string, message: string): Promise<number> {
    if (!this.isAvailable || !this.client) return 0;
    try {
      return await this.withDeadline("publish", () => this.client!.publish(channel, message));
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return 0;
    }
  }

  /**
   * Subscribe to a channel on a dedicated connection (node-redis requires a
   * separate client in subscriber mode). Returns an async unsubscribe function,
   * or null when Redis is unavailable so the caller knows fan-out is local-only.
   */
  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<(() => Promise<void>) | null> {
    if (!this.isAvailable || !this.client) return null;
    try {
      const sub = this.client.duplicate();
      sub.on("error", (err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
      await sub.connect();
      await sub.subscribe(channel, (message: string) => handler(message));
      this.subscribers.push(sub);
      return async () => {
        try {
          await sub.unsubscribe(channel);
          await sub.quit();
        } catch {
          /* already closed */
        }
        this.subscribers = this.subscribers.filter((s) => s !== sub);
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /**
   * Live Redis stats from INFO, for the /metrics endpoint and dashboards.
   * Always returns a well-formed object; zeroed + last error when unavailable.
   */
  async getMetrics(): Promise<RedisMetrics> {
    const base: RedisMetrics = {
      enabled: this.enabled,
      available: this.isAvailable,
      topology: this.topology,
      connectedClients: 0,
      usedMemoryHuman: "n/a",
      usedMemoryBytes: 0,
      evictedKeys: 0,
      keyspaceHits: 0,
      keyspaceMisses: 0,
      hitRate: 0,
      subscriptions: this.subscribers.length,
      lastError: this.lastError,
    };
    if (!this.isAvailable || !this.client) return base;
    try {
      const raw = await this.withDeadline("info", () => this.client!.info());
      const field = (name: string): string | undefined =>
        raw
          .split("\n")
          .find((line) => line.startsWith(`${name}:`))
          ?.split(":")[1]
          ?.trim();
      const hits = Number(field("keyspace_hits") ?? 0);
      const misses = Number(field("keyspace_misses") ?? 0);
      const total = hits + misses;
      return {
        ...base,
        connectedClients: Number(field("connected_clients") ?? 0),
        usedMemoryHuman: field("used_memory_human") ?? "n/a",
        usedMemoryBytes: Number(field("used_memory") ?? 0),
        evictedKeys: Number(field("evicted_keys") ?? 0),
        keyspaceHits: hits,
        keyspaceMisses: misses,
        hitRate: total > 0 ? Number((hits / total).toFixed(4)) : 0,
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return base;
    }
  }
}

/** Owner-checked lease scripts. KEYS[1] = lock key, ARGV[1] = owner token, ARGV[2] = ttl seconds. */
const LUA_RELEASE_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const LUA_REFRESH_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], tonumber(ARGV[2])) else return 0 end";

const memLocks = new Map<string, { token: string; expiresAt: number }>();

function memAcquireLock(key: string, token: string, ttlSec: number): boolean {
  const now = Date.now();
  const existing = memLocks.get(key);
  if (existing && existing.expiresAt > now && existing.token !== token) return false;
  memLocks.set(key, { token, expiresAt: now + ttlSec * 1000 });
  return true;
}

/** Same-token TTL extend only. Must not create a lock that is absent or expired. */
function memRefreshLock(key: string, token: string, ttlSec: number): boolean {
  const now = Date.now();
  const existing = memLocks.get(key);
  if (!existing || existing.expiresAt <= now || existing.token !== token) return false;
  memLocks.set(key, { token, expiresAt: now + ttlSec * 1000 });
  return true;
}

function memReleaseLock(key: string, token: string): void {
  const existing = memLocks.get(key);
  if (existing?.token === token) memLocks.delete(key);
}

export const redisClient = new RedisClient();

/** Test-only: drop in-memory locks so lock-isolation cases start from a clean map. */
export function resetMemoryLocksForTests(): void {
  memLocks.clear();
}

// Dependency inversion: lib/metrics renders the redis_* gauges but must not import this module
// (this module imports metrics for its counters). Register the provider once at import time.
registerRedisMetricsProvider(async () => {
  const m = await redisClient.getMetrics();
  return { available: m.available, connectedClients: m.connectedClients, hitRate: m.hitRate };
});
