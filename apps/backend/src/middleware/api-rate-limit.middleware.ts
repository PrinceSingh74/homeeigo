import { Elysia } from "elysia";
import { errorResponse } from "../lib/api-response";
import { JWTService } from "../services/jwt.service";
import { consumeRateLimitSmart } from "./rate-limit.middleware";
import { incCounter } from "../lib/metrics";

const jwtService = new JWTService();

import { getClientIp } from "../lib/client-ip";

type LimitResult = { allowed: boolean; remaining: number; resetAt: number };

/** Standard, client-readable rate-limit headers (RFC-style). */
function setRateLimitHeaders(
  set: { headers: Record<string, string | number> },
  limit: number,
  result: LimitResult,
): void {
  set.headers["X-RateLimit-Limit"] = String(limit);
  set.headers["X-RateLimit-Remaining"] = String(Math.max(0, result.remaining));
  // Reset as unix epoch seconds (when the window clears).
  set.headers["X-RateLimit-Reset"] = String(Math.ceil(result.resetAt / 1000));
}

/** Seconds until the window resets, floored at 1. */
const retryAfterSeconds = (resetAt: number) =>
  Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

/**
 * Global API rate limit (spec Part 13): ~30/min unauthenticated, ~100/min authenticated, ~20% burst headroom.
 */
// A global `onBeforeHandle` fires once per mounted Elysia instance a request passes
// through, so a single HTTP request can consume the rate-limit budget several times
// over (throttling real users early). This WeakSet de-duplicates the firings that
// share the same underlying Request, sharply reducing the over-count.
const counted = new WeakSet<Request>();

export const apiRateLimitPlugin = new Elysia({ name: "api-rate-limit" }).onBeforeHandle(
  { as: "global" },
  async ({ request, path, set }) => {
  if (!path.startsWith("/api")) return;
  // Dev/staging load harness: set LOAD_TEST_MODE=1 on the server to bypass global limits.
  if (process.env.NODE_ENV !== "production" && process.env.LOAD_TEST_MODE === "1") return;
  if (counted.has(request)) return;
  counted.add(request);

  const authHeader = request.headers.get("authorization");
  // Verify the bearer once and reuse it for both bucketing and the per-user key.
  const payload =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? jwtService.verifyAccessToken(authHeader)
      : null;
  const hasValidBearer = !!payload;

  const burst = 1.2;
  const baseLimit = path.startsWith("/api/admin") ? 200 : hasValidBearer ? 100 : 30;
  const limit = Math.max(1, Math.floor(baseLimit * burst));
  const ip = getClientIp(request);
  const bucket = hasValidBearer ? "auth" : "anon";
  // Key authenticated traffic PER-USER (not per shared IP) so users behind a
  // common NAT/CGNAT/proxy — or a dev box with no x-forwarded-for — aren't
  // throttled collectively. Anonymous traffic stays keyed by IP for abuse control.
  const identity = payload?.userId ? `user:${payload.userId}` : `ip:${ip}`;
  const result = await consumeRateLimitSmart(`global-api:${bucket}:${identity}`, limit, 60_000);
  setRateLimitHeaders(set, limit, result);

  if (!result.allowed) {
    set.status = 429;
    incCounter("rate_limit_triggered_total", { scope: "global", bucket });
    const retryAfter = retryAfterSeconds(result.resetAt);
    set.headers["Retry-After"] = String(retryAfter);
    return errorResponse("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", { retryAfter });
  }

  const userKey = payload?.userId ? `user:${payload.userId}` : `ip:${ip}`;

  // Auth abuse — always enforced (dev included) so brute-force probes get 429, not endless 401s.
  const authPaths = new Set([
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/send-otp",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
  ]);
  if (authPaths.has(path)) {
    const scope = path.endsWith("/login")
      ? "login"
      : path.endsWith("/register")
        ? "register"
        : path.endsWith("/send-otp")
          ? "send-otp"
          : "forgot-password";
    const authBurstLimit = Number(process.env.AUTH_BURST_LIMIT || 15);
    const authBurst = await consumeRateLimitSmart(`auth-burst:${scope}:${ip}`, authBurstLimit, 60_000);
    setRateLimitHeaders(set, authBurstLimit, authBurst);
    if (!authBurst.allowed) {
      set.status = 429;
      incCounter("rate_limit_triggered_total", { scope: "auth_burst", bucket: "anon" });
      const retryAfter = retryAfterSeconds(authBurst.resetAt);
      set.headers["Retry-After"] = String(retryAfter);
      return errorResponse("Too many authentication attempts", "RATE_LIMIT_EXCEEDED", { retryAfter });
    }
  }

  // Endpoint-specific limits from Part 3 spec
  if (path === "/api/payments/create-order") {
    const paymentLimit = await consumeRateLimitSmart(`payments:create-order:${userKey}`, 10, 60 * 60 * 1000);
    setRateLimitHeaders(set, 10, paymentLimit);
    if (!paymentLimit.allowed) {
      set.status = 429;
      incCounter("rate_limit_triggered_total", { scope: "payments_create_order" });
      const retryAfter = retryAfterSeconds(paymentLimit.resetAt);
      set.headers["Retry-After"] = String(retryAfter);
      return errorResponse("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", { retryAfter });
    }
  }

  if (path === "/api/services/search" || path === "/api/providers/search") {
    const searchLimit = await consumeRateLimitSmart(`search:${userKey}`, 100, 60_000);
    setRateLimitHeaders(set, 100, searchLimit);
    if (!searchLimit.allowed) {
      set.status = 429;
      incCounter("rate_limit_triggered_total", { scope: "search" });
      const retryAfter = retryAfterSeconds(searchLimit.resetAt);
      set.headers["Retry-After"] = String(retryAfter);
      return errorResponse("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", { retryAfter });
    }
  }
  },
);
