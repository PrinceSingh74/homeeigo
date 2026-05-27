import jsonwebtoken from "jsonwebtoken";
import type { JwtPayload } from "../types/auth.types";

export const JWT_CONFIG = {
  ACCESS_TOKEN: { expiresIn: "1h", algorithm: "HS256" as const },
  REFRESH_TOKEN: { expiresIn: "30d", algorithm: "HS256" as const },
  ACCESS_TOKEN_SECONDS: 60 * 60,
  REFRESH_TOKEN_SECONDS: 30 * 24 * 60 * 60,
  ALGORITHM: "HS256" as const,
};

export const JWT_SECRETS = {
  ACCESS: process.env.JWT_SECRET || "change-me-access-secret",
  REFRESH: process.env.JWT_REFRESH_SECRET || "change-me-refresh-secret",
};

export class JWTService {
  private readonly accessSecret = JWT_SECRETS.ACCESS;
  private readonly refreshSecret = JWT_SECRETS.REFRESH;

  generateAccessToken(payload: { userId: string; email: string }): string {
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

  generateTokenPair(payload: { userId: string; email: string }) {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken({ userId: payload.userId }),
    };
  }

  verifyAccessToken(token: string): JwtPayload | null {
    try {
      const decoded = jsonwebtoken.verify(token.replace(/^Bearer\s+/i, ""), this.accessSecret) as JwtPayload;
      if (decoded.type !== "access") return null;
      return decoded;
    } catch {
      return null;
    }
  }

  verifyRefreshToken(token: string): JwtPayload | null {
    try {
      const decoded = jsonwebtoken.verify(token.replace(/^Bearer\s+/i, ""), this.refreshSecret) as JwtPayload;
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
