import type { TokenRevocationReason } from "@prisma/client";
import type { JwtPayload } from "../types/auth.types";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { notificationService } from "./notification.service";
import { JWT_CONFIG } from "./jwt.service";

class TokenRevocationService {
  async getAuthEpoch(userId: string): Promise<number> {
    const row = await prisma.userAuthEpoch.findUnique({ where: { userId } });
    return row?.epoch ?? 0;
  }

  async bumpAuthEpoch(userId: string): Promise<number> {
    const row = await prisma.userAuthEpoch.upsert({
      where: { userId },
      create: { userId, epoch: 1 },
      update: { epoch: { increment: 1 } },
    });
    return row.epoch;
  }

  async revokeAccessToken(input: {
    tokenJti: string;
    userId: string;
    reason: TokenRevocationReason;
    revokedBy: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await prisma.tokenBlacklist.upsert({
        where: { tokenJti: input.tokenJti },
        create: {
          tokenJti: input.tokenJti,
          userId: input.userId,
          revokedBy: input.revokedBy,
          reason: input.reason,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        update: {
          revokedBy: input.revokedBy,
          reason: input.reason,
          expiresAt: input.expiresAt,
          revokedAt: new Date(),
        },
      });

      void AuditLogService.record("TOKEN_REVOKED", "success", {
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: {
          tokenJti: `${input.tokenJti.slice(0, 8)}…`,
          reason: input.reason,
          revokedBy: input.revokedBy,
        },
      });
    } catch (err) {
      console.error("Failed to revoke token:", err);
      throw err;
    }
  }

  async isTokenRevoked(tokenJti: string): Promise<boolean> {
    try {
      const revoked = await prisma.tokenBlacklist.findUnique({
        where: { tokenJti },
        select: { id: true },
      });
      return !!revoked;
    } catch (err) {
      console.error("Failed to check token revocation:", err);
      return true;
    }
  }

  /**
   * Validates access token claims against blacklist + auth epoch.
   * Legacy tokens without jti/authEpoch remain valid until JWT exp.
   */
  async isAccessTokenValid(payload: JwtPayload): Promise<boolean> {
    if (payload.jti && (await this.isTokenRevoked(payload.jti))) {
      return false;
    }

    if (payload.authEpoch !== undefined) {
      const currentEpoch = await this.getAuthEpoch(payload.userId);
      if (payload.authEpoch < currentEpoch) {
        return false;
      }
    }

    return true;
  }

  async assertAccessTokenValid(payload: JwtPayload): Promise<void> {
    const valid = await this.isAccessTokenValid(payload);
    if (valid) return;

    void AuditLogService.record("REVOKED_TOKEN_USED", "failure", {
      userId: payload.userId,
      details: {
        tokenJti: payload.jti ? `${payload.jti.slice(0, 8)}…` : undefined,
        authEpoch: payload.authEpoch,
      },
    });

    throw new Error("Token has been revoked");
  }

  async revokeAllUserTokens(
    userId: string,
    reason: TokenRevocationReason,
    revokedBy: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<number> {
    const refreshResult = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });

    await this.bumpAuthEpoch(userId);

    void AuditLogService.record("ALL_USER_TOKENS_REVOKED", "success", {
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      details: {
        revokedRefreshCount: refreshResult.count,
        reason,
        revokedBy,
      },
    });

    return refreshResult.count;
  }

  async forceLogoutUser(
    userId: string,
    reason: TokenRevocationReason,
    adminId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.revokeAllUserTokens(userId, reason, adminId, meta);

    void notificationService.createForUser({
      userId,
      type: "SYSTEM",
      title: "Security alert",
      message:
        "Your account was signed out from all devices for security reasons. Please sign in again.",
      priority: "high",
    });
  }

  async revokeAccessTokenFromRaw(
    token: string,
    userId: string,
    reason: TokenRevocationReason,
    revokedBy: string,
    meta?: { ipAddress?: string; userAgent?: string },
    decode?: (token: string) => JwtPayload | null,
  ): Promise<void> {
    const payload = decode?.(token);
    if (!payload?.jti) return;

    const expiresAt =
      payload.exp != null
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + JWT_CONFIG.ACCESS_TOKEN_SECONDS * 1000);

    await this.revokeAccessToken({
      tokenJti: payload.jti,
      userId,
      reason,
      revokedBy,
      expiresAt,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  async cleanupExpiredRevocations(): Promise<number> {
    try {
      const result = await prisma.tokenBlacklist.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return result.count;
    } catch (err) {
      console.error("Failed to cleanup revocations:", err);
      return 0;
    }
  }
}

export const tokenRevocationService = new TokenRevocationService();
