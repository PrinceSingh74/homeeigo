import { createClient } from "redis";
import { incCounter } from "./metrics";

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
        // Give up after MAX_RETRIES so a dead Redis can't block the event loop;
        // once we give up, isAvailable stays false and callers use in-memory.
        reconnectStrategy: (retries) =>
          retries > MAX_RETRIES ? false : Math.min(retries * 200, 2000),
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
  async healthCheck(): Promise<boolean> {
    if (!this.isAvailable || !this.client) return false;
    try {
      return (await this.client.ping()) === "PONG";
    } catch (err) {
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
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  /** SET a string value with optional TTL (seconds). Returns false when not stored. */
  async set(key: string, value: string, ttlSec?: number): Promise<boolean> {
    if (!this.isAvailable || !this.client) return false;
    try {
      await this.client.set(key, value, ttlSec ? { EX: ttlSec } : undefined);
      return true;
    } catch {
      return false;
    }
  }

  /** DEL a key. No-op when Redis is unavailable. */
  async del(key: string): Promise<void> {
    if (!this.isAvailable || !this.client) return;
    try {
      await this.client.del(key);
    } catch {
      /* ignore */
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
        const ok = await this.client.set(lockKey, token, { NX: true, EX: ttlSec });
        return ok === "OK";
      } catch {
        return memAcquireLock(lockKey, token, ttlSec);
      }
    }
    return memAcquireLock(lockKey, token, ttlSec);
  }

  /** Release lock only if token matches (prevents releasing another holder's lock). */
  async releaseLock(key: string, token: string): Promise<void> {
    const lockKey = `lock:${key}`;
    if (this.isAvailable && this.client) {
      try {
        const current = await this.client.get(lockKey);
        if (current === token) await this.client.del(lockKey);
        return;
      } catch {
        /* fall through */
      }
    }
    memReleaseLock(lockKey, token);
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
      const count = await this.client.incr(k);
      let ttl: number;
      if (count === 1) {
        await this.client.expire(k, windowSec);
        ttl = windowSec;
      } else {
        ttl = await this.client.ttl(k);
        if (ttl < 0) {
          await this.client.expire(k, windowSec);
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
      const raw = await this.client.get(k);
      if (!raw) {
        return { allowed: true, remaining: limit, resetAt: Date.now() + windowSec * 1000 };
      }
      const count = Number.parseInt(raw, 10) || 0;
      const ttl = await this.client.ttl(k);
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
      return await this.client.publish(channel, message);
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
      const raw = await this.client.info();
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

const memLocks = new Map<string, { token: string; expiresAt: number }>();

function memAcquireLock(key: string, token: string, ttlSec: number): boolean {
  const now = Date.now();
  const existing = memLocks.get(key);
  if (existing && existing.expiresAt > now && existing.token !== token) return false;
  memLocks.set(key, { token, expiresAt: now + ttlSec * 1000 });
  return true;
}

function memReleaseLock(key: string, token: string): void {
  const existing = memLocks.get(key);
  if (existing?.token === token) memLocks.delete(key);
}

export const redisClient = new RedisClient();
