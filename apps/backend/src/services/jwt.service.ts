import jsonwebtoken from "jsonwebtoken";
import type { JwtPayload } from "../types/auth.types";

/** Parse durations like "1h", "30d", "15m", "900s" (or a raw number of seconds). */
function parseDurationToSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;
  const trimmed = value.trim();
  const match = /^(\d+)\s*([smhd])?$/i.exec(trimmed);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multiplier = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return amount * multiplier;
}

const ACCESS_TOKEN_SECONDS = parseDurationToSeconds(process.env.JWT_EXPIRY, 60 * 60);
const REFRESH_TOKEN_SECONDS = parseDurationToSeconds(process.env.JWT_REFRESH_EXPIRY, 30 * 24 * 60 * 60);

export const JWT_CONFIG = {
  ACCESS_TOKEN: { expiresIn: process.env.JWT_EXPIRY || "1h", algorithm: "HS256" as const },
  REFRESH_TOKEN: { expiresIn: process.env.JWT_REFRESH_EXPIRY || "30d", algorithm: "HS256" as const },
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
  ALGORITHM: "HS256" as const,
};

/** Reject obviously-insecure placeholder secrets. */
function isInsecureSecret(secret: string): boolean {
  return (
    secret.length < 16 ||
    /change|your-super-secret|placeholder|example/i.test(secret)
  );
}

function resolveSecret(envValue: string | undefined, devFallback: string): string {
  if (envValue && !isInsecureSecret(envValue)) return envValue;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "A strong JWT_SECRET and JWT_REFRESH_SECRET are required in production. Generate with: openssl rand -hex 32",
    );
  }
  if (envValue && isInsecureSecret(envValue)) {
    console.warn("[jwt] Using an insecure JWT secret — set a strong value before deploying.");
  }
  return envValue || devFallback;
}

export const JWT_SECRETS = {
  ACCESS: resolveSecret(process.env.JWT_SECRET, "change-me-access-secret"),
  REFRESH: resolveSecret(process.env.JWT_REFRESH_SECRET, "change-me-refresh-secret"),
};

export class JWTService {
  private readonly accessSecret = JWT_SECRETS.ACCESS;
  private readonly refreshSecret = JWT_SECRETS.REFRESH;

  generateAccessToken(payload: { userId: string; email: string; deviceId?: string }): string {
    const now = Math.floor(Date.now() / 1000);
    return jsonwebtoken.sign(
      {
        ...payload,
        type: "access",
        iat: now,
        exp: now + JWT_CONFIG.ACCESS_TOKEN_SECONDS,
      },
      this.accessSecret,
      { algorithm: JWT_CONFIG.ALGORITHM }
    );
  }

  generateRefreshToken(payload: { userId: string }): string {
    const now = Math.floor(Date.now() / 1000);
    return jsonwebtoken.sign(
      {
        ...payload,
        type: "refresh",
        iat: now,
        exp: now + JWT_CONFIG.REFRESH_TOKEN_SECONDS,
      },
      this.refreshSecret,
      { algorithm: JWT_CONFIG.ALGORITHM }
    );
  }

  generateTokenPair(payload: { userId: string; email: string; deviceId?: string }) {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken({ userId: payload.userId }),
    };
  }

  verifyAccessToken(token: string): JwtPayload | null {
    try {
      const decoded = jsonwebtoken.verify(token.replace(/^Bearer\s+/i, ""), this.accessSecret, {
        algorithms: [JWT_CONFIG.ALGORITHM],
      }) as JwtPayload;
      if (decoded.type !== "access") return null;
      return decoded;
    } catch {
      return null;
    }
  }

  verifyRefreshToken(token: string): JwtPayload | null {
    try {
      const decoded = jsonwebtoken.verify(token.replace(/^Bearer\s+/i, ""), this.refreshSecret, {
        algorithms: [JWT_CONFIG.ALGORITHM],
      }) as JwtPayload;
      if (decoded.type !== "refresh") return null;
      return decoded;
    } catch {
      return null;
    }
  }

  decodeToken(token: string): JwtPayload | null {
    try {
      const decoded = jsonwebtoken.decode(token.replace(/^Bearer\s+/i, "")) as JwtPayload | null;
      return decoded;
    } catch {
      return null;
    }
  }

  getTokenExpiration(token: string): Date | null {
    const decoded = this.decodeToken(token);
    if (!decoded?.exp) return null;
    return new Date(decoded.exp * 1000);
  }

  isTokenExpired(token: string): boolean {
    const exp = this.getTokenExpiration(token);
    if (!exp) return true;
    return exp < new Date();
  }

  getTimeUntilExpiration(token: string): number {
    const exp = this.getTokenExpiration(token);
    if (!exp) return 0;
    return Math.max(0, Math.floor((exp.getTime() - Date.now()) / 1000));
  }

  getUserIdFromToken(token: string): string | null {
    return this.verifyAccessToken(token)?.userId ?? null;
  }

  getEmailFromToken(token: string): string | null {
    return this.verifyAccessToken(token)?.email ?? null;
  }
}
