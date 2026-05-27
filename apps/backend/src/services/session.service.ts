import type { PrismaClient } from "@prisma/client";
import type { RefreshTokenService } from "./refresh-token.service";

/**
 * Part 8 — sessions are backed by refresh-token rows (device-bound, revocable).
 */
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly refreshTokens: RefreshTokenService
  ) {}

  async createSession(payload: {
    userId: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<string> {
    const token = await this.refreshTokens.createRefreshToken(payload);
    const row = await this.prisma.refreshToken.findUnique({
      where: { token },
      select: { id: true },
    });
    return row?.id ?? "";
  }

  async updateSessionActivity(sessionId: string, userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { lastActivityAt: new Date() },
    });
  }

  getUserSessions(userId: string) {
    return this.refreshTokens.getUserSessions(userId);
  }

  async logoutSession(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count > 0;
  }

  async logoutAllSessions(userId: string): Promise<number> {
    return this.refreshTokens.revokeAllUserTokens(userId);
  }

  async logoutOtherSessions(userId: string, currentDeviceId?: string): Promise<number> {
    return this.refreshTokens.revokeOtherDeviceTokens(userId, currentDeviceId);
  }

  async deleteExpiredSessions(): Promise<number> {
    return this.refreshTokens.deleteExpiredTokens();
  }
}
