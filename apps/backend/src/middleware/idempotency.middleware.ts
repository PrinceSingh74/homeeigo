import { Elysia } from "elysia";
import { createHash } from "node:crypto";
import { redisClient } from "../lib/redis";
import { JWTService } from "../services/jwt.service";

/**
 * Idempotency middleware.
 *
 * Mobile (and any client) may send an `Idempotency-Key` header on mutating requests
 * — notably the offline queue replays mutations whose original response was lost on a
 * flaky network. Without server-side handling, a replay re-executes the handler and
 * creates a DUPLICATE side effect (e.g. two bookings / two addresses). This middleware
 * makes such replays safe:
 *
 *   - First request for a (caller, key): an in-flight lock is taken; the handler runs;
 *     the final response (status < 500) is cached and returned.
 *   - Replay with the same key: the cached response is returned WITHOUT re-running the
 *     handler — exactly once side effect, original outcome preserved.
 *   - Concurrent duplicate while the first is still in-flight: 409 IDEMPOTENCY_IN_PROGRESS
 *     so the client retries and then gets the cached result.
 *
 * The key is namespaced by the authenticated customer (the verified access token's user id) so one
 * caller can never read another caller's cached response — and a replay that carries a REFRESHED
 * token for the same customer still finds its original outcome. It used to be namespaced by the raw
 * Authorization header, so the offline queue's replay after a token refresh executed a second time
 * (coding-phase gap closure 2026-09-28). An unverifiable header falls back to its hash; the route
 * refuses such a request anyway.
 *
 * Each cached outcome carries a fingerprint of the request it answers (method, path, canonical
 * body). A key reused for a DIFFERENT request is refused with 409 IDEMPOTENCY_KEY_REUSED — the
 * contract the booking route already had — instead of answering with the first request's response
 * while the new request silently never runs. Server errors (>=500) are NOT cached and the
 * lock is released so the client can safely retry. Degrades gracefully (in-memory store +
 * in-memory lock fallback) when Redis is unavailable, matching the codebase's Redis-optional design.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SKIP_PREFIXES = ["/ws", "/swagger", "/metrics", "/health", "/ready"];
/**
 * Routes that read Idempotency-Key themselves and own a stronger contract (persisted, request-hashed,
 * "a refused request does not burn the key", 201-then-200 replay): booking create, and the
 * execution-step and requirement-check actions that pass the key into their services. This layer
 * standing in front of them would answer from its own cache and the route's contract would never run.
 */
const ROUTE_OWNED = [
  /^\/api\/bookings\/?$/,
  /^\/api\/bookings\/[^/]+\/execution\/[^/]+\/[^/]+$/,
  /^\/api\/bookings\/[^/]+\/requirements\/[^/]+\/(check|customer)$/,
];
const LOCK_TTL_SEC = 30; // > max expected handler duration
const RESPONSE_TTL_SEC = 60 * 60 * 24; // 24h replay window

type CachedResponse = { status: number; body: unknown; fingerprint?: string };

// In-memory fallback cache (used only when Redis is unavailable). TTL-pruned on access.
const memCache = new Map<string, { value: CachedResponse; expiresAt: number }>();
function memGet(key: string): CachedResponse | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}
function memSet(key: string, value: CachedResponse, ttlSec: number): void {
  memCache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  if (memCache.size > 5000) {
    // Bounded: drop the oldest ~10% to avoid unbounded growth without Redis.
    const drop = Math.ceil(memCache.size * 0.1);
    let i = 0;
    for (const k of memCache.keys()) {
      if (i++ >= drop) break;
      memCache.delete(k);
    }
  }
}

async function cacheGet(key: string): Promise<CachedResponse | null> {
  const raw = await redisClient.get(key);
  if (raw) {
    try {
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }
  return memGet(key);
}
async function cacheSet(key: string, value: CachedResponse): Promise<void> {
  const stored = await redisClient.set(key, JSON.stringify(value), RESPONSE_TTL_SEC);
  if (!stored) memSet(key, value, RESPONSE_TTL_SEC);
}

const jwt = new JWTService();

function callerNamespace(request: Request): string {
  const auth = request.headers.get("authorization") ?? "anon";
  const userId = auth === "anon" ? null : jwt.verifyAccessToken(auth)?.userId;
  if (userId) return `u:${userId}`;
  return createHash("sha256").update(auth).digest("hex").slice(0, 16);
}

/** JSON with object keys sorted, so key order is not mistaken for a different request. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method} ${path} ${canonical(body)}`).digest("hex");
}

type InFlight = { cacheKey: string; lockToken: string; fingerprint: string };
const inFlight = new WeakMap<Request, InFlight>();

/**
 * The raw body of a keyed mutating request, read from a CLONE before routing. The hooks below must
 * never reference Elysia's `body`: a global hook that does makes Elysia parse every request body up
 * front, and routes that verify signatures over the raw body (payment and email webhooks) then find it
 * already consumed and fail with 500 (caught by the full suite, 2026-09-28).
 */
const keyedBodies = new WeakMap<Request, string>();

function parsedOrRaw(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const idempotencyPlugin = new Elysia({ name: "idempotency" })
  .onRequest(async ({ request }) => {
    if (!MUTATING.has(request.method.toUpperCase()) || !request.headers.get("idempotency-key")) return;
    try {
      keyedBodies.set(request, await request.clone().text());
    } catch {
      keyedBodies.set(request, "");
    }
  })
  .onBeforeHandle({ as: "global" }, async ({ request, set }) => {
    const method = request.method.toUpperCase();
    if (!MUTATING.has(method)) return;
    const key = request.headers.get("idempotency-key");
    if (!key) return;
    const path = new URL(request.url).pathname;
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
    if (method === "POST" && ROUTE_OWNED.some((r) => r.test(path))) return;

    const cacheKey = `idem:${callerNamespace(request)}:${key}`;

    const fingerprint = requestFingerprint(method, path, parsedOrRaw(keyedBodies.get(request) ?? ""));

    const cached = await cacheGet(cacheKey);
    if (cached && cached.fingerprint !== undefined && cached.fingerprint !== fingerprint) {
      set.status = 409;
      return {
        success: false,
        error: "This Idempotency-Key was already used for a different request. Use a new key for a new request.",
        code: "IDEMPOTENCY_KEY_REUSED",
      };
    }
    if (cached) {
      set.status = cached.status;
      set.headers["idempotent-replay"] = "true";
      return cached.body; // short-circuit: original outcome, no duplicate side effect
    }

    const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const gotLock = await redisClient.acquireLock(cacheKey, lockToken, LOCK_TTL_SEC);
    if (!gotLock) {
      // An identical request is still processing — avoid a racing duplicate.
      set.status = 409;
      return {
        success: false,
        error: "A request with this Idempotency-Key is already being processed. Retry shortly.",
        code: "IDEMPOTENCY_IN_PROGRESS",
      };
    }
    inFlight.set(request, { cacheKey, lockToken, fingerprint });
  })
  .onAfterHandle({ as: "global" }, async ({ request, set, response }) => {
    const ctx = inFlight.get(request);
    if (!ctx) return;
    inFlight.delete(request);
    const status = typeof set.status === "number" ? set.status : 200;
    // Cache deterministic outcomes (2xx + client 4xx). Never cache 5xx (transient) —
    // release the lock so the client can retry the operation cleanly.
    if (status < 500) {
      await cacheSet(ctx.cacheKey, { status, body: response, fingerprint: ctx.fingerprint });
    }
    await redisClient.releaseLock(ctx.cacheKey, ctx.lockToken);
  })
  .onError({ as: "global" }, async ({ request }) => {
    const ctx = inFlight.get(request);
    if (!ctx) return;
    inFlight.delete(request);
    // Thrown/unhandled error → do not cache; release so a retry can proceed.
    await redisClient.releaseLock(ctx.cacheKey, ctx.lockToken);
  });
