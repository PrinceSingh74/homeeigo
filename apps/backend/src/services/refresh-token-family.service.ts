import crypto from "crypto";
import type { TokenRevocationReason } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { notificationService } from "./notification.service";
import { tokenRevocationService } from "./token-revocation.service";

class RefreshTokenFamilyService {
  createFamily(): string {
    return crypto.randomUUID();
  }

  async revokeFamily(
    familyId: string,
    reason: TokenRevocationReason,
    userId?: string,
  ): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: {
        familyId,
        ...(userId ? { userId } : {}),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
    return result.count;
  }

  /**
   * Detect refresh-token reuse (presenting a token that was already rotated/revoked).
   * Invalidates the entire family and bumps the user's auth epoch.
   */
  async handleReuseAttack(
    userId: string,
    familyId: string | null | undefined,
    usedTokenId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    void AuditLogService.record("REFRESH_TOKEN_REUSE_ATTACK", "failure", {
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      details: {
        familyId,
        usedTokenId,
      },
    });

    if (familyId) {
      await this.revokeFamily(familyId, "REUSE_ATTACK_DETECTED", userId);
    } else {
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: "REUSE_ATTACK_DETECTED",
        },
      });
    }

    await tokenRevocationService.bumpAuthEpoch(userId);

    void notificationService.createForUser({
      userId,
      type: "SYSTEM",
      title: "Security alert",
      message:
        "Suspicious sign-in activity was detected. All sessions were signed out. Please sign in again.",
      priority: "high",
    });
  }

  async cleanupOldFamilies(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        revokedAt: { not: null },
      },
    });
    return result.count;
  }
}

export const refreshTokenFamilyService = new RefreshTokenFamilyService();
