import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

export type GiftCardAttemptMeta = {
  ipAddress: string;
  userAgent: string;
  userId?: string;
  deviceId?: string;
};

type BruteForceConfig = {
  maxAttempts: number;
  timeWindowMinutes: number;
  lockoutDurationMinutes: number;
  progressiveMultiplier: number;
};

const DEFAULT_CONFIG: BruteForceConfig = {
  maxAttempts: 5,
  timeWindowMinutes: 15,
  lockoutDurationMinutes: 30,
  progressiveMultiplier: 1.5,
};

export function calculateGiftCardBlockDurationMinutes(
  failedCount: number,
  config: BruteForceConfig = DEFAULT_CONFIG,
): number {
  const excess = Math.max(0, failedCount - config.maxAttempts);
  return Math.floor(
    config.lockoutDurationMinutes * Math.pow(config.progressiveMultiplier, excess),
  );
}

class GiftCardProtectionService {
  private readonly config = DEFAULT_CONFIG;

  private windowStart(): Date {
    return new Date(Date.now() - this.config.timeWindowMinutes * 60 * 1000);
  }

  private async countRecentAttempts(keys: {
    ipAddress: string;
    userId?: string;
    deviceId?: string;
  }): Promise<number> {
    const since = this.windowStart();
    const or: Array<Record<string, unknown>> = [{ ipAddress: keys.ipAddress }];
    if (keys.userId) or.push({ userId: keys.userId });
    if (keys.deviceId) or.push({ deviceId: keys.deviceId });

    return prisma.giftCardRedemptionAttempt.count({
      where: {
        createdAt: { gte: since },
        success: false,
        OR: or,
      },
    });
  }

  private async activeBlock(keys: {
    ipAddress: string;
    userId?: string;
    deviceId?: string;
  }): Promise<Date | null> {
    const now = new Date();
    const or: Array<Record<string, unknown>> = [{ ipAddress: keys.ipAddress }];
    if (keys.userId) or.push({ userId: keys.userId });
    if (keys.deviceId) or.push({ deviceId: keys.deviceId });

    const row = await prisma.giftCardRedemptionAttempt.findFirst({
      where: {
        blockedUntil: { gt: now },
        OR: or,
      },
      orderBy: { blockedUntil: "desc" },
      select: { blockedUntil: true },
    });
    return row?.blockedUntil ?? null;
  }

  /**
   * Check whether a redemption attempt should proceed.
   * SECURITY: Call before processing redemption.
   */
  async trackRedemptionAttempt(
    giftCardCode: string,
    meta: GiftCardAttemptMeta,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    blockedUntil?: Date;
    attemptsRemaining?: number;
  }> {
    try {
      const normalizedCode = giftCardCode.trim().toUpperCase();
      const blockedUntil = await this.activeBlock(meta);
      if (blockedUntil) {
        return {
          allowed: false,
          reason: "Too many attempts. Please try later.",
          blockedUntil,
          attemptsRemaining: 0,
        };
      }

      const recentAttempts = await this.countRecentAttempts(meta);
      if (recentAttempts >= this.config.maxAttempts) {
        const blockMinutes = calculateGiftCardBlockDurationMinutes(recentAttempts);
        const blockUntil = new Date(Date.now() + blockMinutes * 60 * 1000);

        await prisma.giftCardRedemptionAttempt.create({
          data: {
            giftCardCode: normalizedCode,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            userId: meta.userId,
            deviceId: meta.deviceId,
            success: false,
            reason: "rate_limited",
            attemptNumber: recentAttempts + 1,
            blockedUntil: blockUntil,
          },
        });

        void AuditLogService.record("RATE_LIMIT_EXCEEDED", "failure", {
          userId: meta.userId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          details: {
            resource: "GIFT_CARD",
            giftCardCode: `${normalizedCode.slice(0, 4)}…`,
            attemptCount: recentAttempts + 1,
            blockMinutes,
          },
        });

        return {
          allowed: false,
          reason: "Too many failed attempts. Account locked.",
          blockedUntil: blockUntil,
          attemptsRemaining: 0,
        };
      }

      return {
        allowed: true,
        attemptsRemaining: this.config.maxAttempts - recentAttempts,
      };
    } catch (err) {
      console.error("Gift card brute force check failed:", err);
      return { allowed: false, reason: "Security check failed" };
    }
  }

  async recordFailedAttempt(
    giftCardCode: string,
    meta: GiftCardAttemptMeta,
    reason: string,
    giftCardId?: string,
  ): Promise<void> {
    try {
      const normalizedCode = giftCardCode.trim().toUpperCase();
      const recentAttempts = await this.countRecentAttempts(meta);

      await prisma.giftCardRedemptionAttempt.create({
        data: {
          giftCardCode: normalizedCode,
          giftCardId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          userId: meta.userId,
          deviceId: meta.deviceId,
          success: false,
          reason,
          attemptNumber: recentAttempts + 1,
        },
      });

      if (giftCardId) {
        await prisma.giftCard.update({
          where: { id: giftCardId },
          data: {
            failedAttempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("Failed to record gift card attempt:", err);
    }
  }

  async recordSuccessfulRedemption(
    giftCardCode: string,
    meta: GiftCardAttemptMeta,
    giftCardId: string,
  ): Promise<void> {
    try {
      const normalizedCode = giftCardCode.trim().toUpperCase();

      await prisma.$transaction([
        prisma.giftCardRedemptionAttempt.create({
          data: {
            giftCardCode: normalizedCode,
            giftCardId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            userId: meta.userId,
            deviceId: meta.deviceId,
            success: true,
            attemptNumber: 1,
          },
        }),
        prisma.giftCard.update({
          where: { id: giftCardId },
          data: { lastAttemptAt: new Date() },
        }),
        prisma.giftCardRedemptionAttempt.deleteMany({
          where: {
            giftCardCode: normalizedCode,
            ipAddress: meta.ipAddress,
            success: false,
            createdAt: { gte: this.windowStart() },
          },
        }),
      ]);
    } catch (err) {
      console.error("Failed to record successful gift card redemption:", err);
    }
  }

  async cleanupOldAttempts(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.giftCardRedemptionAttempt.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });
    return result.count;
  }
}

export const giftCardProtectionService = new GiftCardProtectionService();
