import prisma from "../lib/prisma";
import { ACCOUNT_DELETION_RESTORE_DAYS } from "../lib/legal-policy";
import { AuditLogService } from "./audit-log.service";
import { RefreshTokenService } from "./refresh-token.service";
import { JWTService } from "./jwt.service";
import { devicePushService } from "./device-push.service";

const jwtService = new JWTService();
const refreshTokenService = new RefreshTokenService(prisma, jwtService);

export class AccountLifecycleService {
  /** Soft-delete with 30-day restore window. */
  async scheduleDeletion(userId: string, reason?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) return { error: "NOT_FOUND" as const };

    const deletionScheduledAt = new Date(
      Date.now() + ACCOUNT_DELETION_RESTORE_DAYS * 24 * 60 * 60 * 1000,
    );

    await prisma.user.update({
      where: { id: userId },
      data: { deletionScheduledAt, isActive: false },
    });

    await refreshTokenService.revokeAllUserTokens(userId, "ACCOUNT_DELETION", userId);
    await devicePushService.revokeAll(userId);

    void AuditLogService.success("ACCOUNT_DELETION_SCHEDULED", {
      userId,
      reason,
      details: { deletionScheduledAt: deletionScheduledAt.toISOString(), restoreDays: ACCOUNT_DELETION_RESTORE_DAYS },
    });

    return { deletionScheduledAt, restoreUntil: deletionScheduledAt };
  }

  async finalizeExpiredDeletions(): Promise<number> {
    const now = new Date();
    const due = await prisma.user.findMany({
      where: { deletionScheduledAt: { lte: now }, deletedAt: null },
      select: { id: true },
      take: 100,
    });
    let count = 0;
    for (const u of due) {
      await prisma.user.update({
        where: { id: u.id },
        data: { deletedAt: now, isActive: false, isBanned: true, bannedReason: "Account deleted" },
      });
      count++;
    }
    return count;
  }
}

export const accountLifecycleService = new AccountLifecycleService();
