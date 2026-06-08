import prisma from "./prisma";

/** Signals collected server-side for fraud intelligence — never trust client-only claims. */
export type FraudContext = {
  userId?: string;
  deviceId?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  browserFingerprint?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  country?: string;
  timezone?: string;
  networkMetadata?: Record<string, unknown>;
};

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function fraudContextFromRequest(
  request: Request,
  userId?: string,
  extra: Partial<FraudContext> = {},
): FraudContext {
  const networkMetadata: Record<string, unknown> = {};
  const acceptLang = request.headers.get("accept-language");
  if (acceptLang) networkMetadata.acceptLanguage = acceptLang;
  const secChUa = request.headers.get("sec-ch-ua");
  if (secChUa) networkMetadata.secChUa = secChUa;

  return {
    userId,
    deviceId: extra.deviceId ?? request.headers.get("x-device-id") ?? undefined,
    deviceFingerprint: extra.deviceFingerprint ?? request.headers.get("x-device-fingerprint") ?? undefined,
    browserFingerprint:
      extra.browserFingerprint ?? request.headers.get("x-browser-fingerprint") ?? undefined,
    ipAddress: extra.ipAddress ?? getClientIp(request),
    userAgent: extra.userAgent ?? request.headers.get("user-agent") ?? undefined,
    timezone: extra.timezone ?? request.headers.get("x-timezone") ?? undefined,
    latitude: extra.latitude,
    longitude: extra.longitude,
    city: extra.city,
    country: extra.country ?? request.headers.get("x-country") ?? undefined,
    networkMetadata: Object.keys(networkMetadata).length ? networkMetadata : extra.networkMetadata,
  };
}

/** Build fraud context from the user's latest stored signals (e.g. booking completion). */
export async function fraudContextForUser(userId: string): Promise<FraudContext> {
  const [signal, risk] = await Promise.all([
    prisma.fraudSignal.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fraudRiskScore.findUnique({ where: { userId } }),
  ]);

  const ctx: FraudContext = { userId };
  if (signal) {
    ctx.deviceId = signal.deviceId ?? undefined;
    ctx.deviceFingerprint = signal.deviceFingerprint ?? undefined;
    ctx.ipAddress = signal.ipAddress ?? undefined;
    ctx.userAgent = signal.userAgent ?? undefined;
    ctx.browserFingerprint = signal.browserFingerprint ?? undefined;
    ctx.latitude = signal.latitude ?? undefined;
    ctx.longitude = signal.longitude ?? undefined;
    ctx.city = signal.city ?? undefined;
    ctx.country = signal.country ?? undefined;
    ctx.timezone = signal.timezone ?? undefined;
    if (signal.networkMetadata) {
      try {
        ctx.networkMetadata = JSON.parse(signal.networkMetadata) as Record<string, unknown>;
      } catch {
        ctx.networkMetadata = { raw: signal.networkMetadata };
      }
    }
  }
  if (risk) {
    ctx.networkMetadata = {
      ...ctx.networkMetadata,
      riskScore: risk.score,
      riskLevel: risk.level,
      blacklistState: risk.level === "CRITICAL" ? "flagged" : "clear",
    };
  }
  return ctx;
}
