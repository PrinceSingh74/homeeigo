import { consumeRateLimitSmart } from "../../middleware/rate-limit.middleware";
import { incCounter } from "../../lib/metrics";
import type { AiGatewayRole } from "@prisma/client";

const LIMITS: Record<string, { perMinute: number; perHour: number }> = {
  CUSTOMER: { perMinute: 20, perHour: 100 },
  PARTNER: { perMinute: 30, perHour: 200 },
  ADMIN: { perMinute: 60, perHour: 500 },
  SUPPORT: { perMinute: 40, perHour: 300 },
  SYSTEM: { perMinute: 200, perHour: 5000 },
  AUTOMATION: { perMinute: 100, perHour: 2000 },
};

export type AiRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

export async function checkAiRateLimit(
  actorId: string,
  actorRole: AiGatewayRole,
  ipAddress?: string,
): Promise<AiRateLimitResult> {
  if (process.env.AI_RATE_LIMIT_BYPASS === "true") {
    return { allowed: true, remaining: 9999 };
  }
  const limits = LIMITS[actorRole] ?? LIMITS.CUSTOMER;
  const minuteKey = `ai:rate:${actorRole}:${actorId}:m`;
  const hourKey = `ai:rate:${actorRole}:${actorId}:h`;
  const ipKey = ipAddress ? `ai:rate:ip:${ipAddress}:m` : null;

  const [minute, hour, ip] = await Promise.all([
    consumeRateLimitSmart(minuteKey, limits.perMinute, 60_000),
    consumeRateLimitSmart(hourKey, limits.perHour, 3_600_000),
    ipKey ? consumeRateLimitSmart(ipKey, 30, 60_000) : Promise.resolve({ allowed: true, remaining: 30, resetAt: Date.now() }),
  ]);

  if (!minute.allowed || !hour.allowed || !ip.allowed) {
    incCounter("rate_limit_triggered_total", { scope: "ai_gateway", bucket: actorRole });
    const resetAt = Math.max(minute.resetAt, hour.resetAt, ip.resetAt);
    return { allowed: false, retryAfterMs: Math.max(0, resetAt - Date.now()) };
  }

  return { allowed: true, remaining: Math.min(minute.remaining, hour.remaining) };
}
