import { Elysia } from "elysia";
import { JWTService } from "../services/jwt.service";
import { consumeRateLimit } from "./rate-limit.middleware";

const jwtService = new JWTService();

const getIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

/**
 * Global API rate limit (spec Part 13): ~30/min unauthenticated, ~100/min authenticated, ~20% burst headroom.
 */
export const apiRateLimitPlugin = new Elysia({ name: "api-rate-limit" }).onBeforeHandle(({ request, path, set }) => {
  if (!path.startsWith("/api")) return;

  const authHeader = request.headers.get("authorization");
  const hasValidBearer =
    !!authHeader &&
    authHeader.toLowerCase().startsWith("bearer ") &&
    !!jwtService.verifyAccessToken(authHeader);

  const burst = 1.2;
  const baseLimit = hasValidBearer ? 100 : 30;
  const limit = Math.max(1, Math.floor(baseLimit * burst));
  const ip = getIp(request);
  const bucket = hasValidBearer ? "auth" : "anon";
  const result = consumeRateLimit(`global-api:${bucket}:${ip}`, limit, 60_000);

  if (!result.allowed) {
    set.status = 429;
    return {
      success: false,
      error: "Too many requests. Please slow down.",
      code: "RATE_LIMIT_EXCEEDED" as const,
    };
  }
});
