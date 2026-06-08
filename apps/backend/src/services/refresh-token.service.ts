import type { PrismaClient } from "@prisma/client";
import { JWTService } from "./jwt.service";
import { AuditLogService } from "./audit-log.service";
import { partnerRegistrationService } from "./partner-registration.service";

export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService
  ) {}

  async createRefreshToken(payload: {
    userId: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<string> {
    const token = this.jwtService.generateRefreshToken({ userId: payload.userId });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        token,
        userId: payload.userId,
        expiresAt,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        userAgent: payload.userAgent,
        ipAddress: payload.ipAddress,
        lastActivityAt: new Date(),
      },
    });
    return token;
  }

  async verifyRefreshToken(
    token: string,
  ): Promise<{ isValid: boolean; error?: string; userId?: string; deviceId?: string | null }> {
    const payload = this.jwtService.verifyRefreshToken(token);
    if (!payload?.userId) return { isValid: false, error: "Invalid or expired token" };

    const dbToken = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!dbToken) return { isValid: false, error: "Token not found in database" };
    if (dbToken.revokedAt) return { isValid: false, error: "Token has been revoked" };
    if (dbToken.expiresAt < new Date()) return { isValid: false, error: "Token has expired" };

    const user = await this.prisma.user.findUnique({ where: { id: dbToken.userId } });
    if (!user?.isActive || user.isBanned) return { isValid: false, error: "User not found or inactive" };
    return { isValid: true, userId: dbToken.userId, deviceId: dbToken.deviceId };
  }

  async refreshAccessToken(payload: {
    refreshToken: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; error?: string; accessToken?: string; refreshToken?: string }> {
    const verification = await this.verifyRefreshToken(payload.refreshToken);
    if (!verification.isValid || !verification.userId) return { success: false, error: verification.error };

    const user = await this.prisma.user.findUnique({ where: { id: verification.userId } });
    if (!user) return { success: false, error: "User not found" };

    if (user.role === "VENDOR") {
      const approvalBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
      if (approvalBlock) return { success: false, error: approvalBlock };
    }

    const storedDeviceId = verification.deviceId ?? null;
    const clientDeviceId = payload.deviceId ?? null;
    if (storedDeviceId && clientDeviceId && storedDeviceId !== clientDeviceId) {
      await this.revokeRefreshToken(payload.refreshToken);
      void AuditLogService.failure("DEVICE_MISMATCH", {
        userId: user.id,
        ipAddress: payload.ipAddress,
        userAgent: payload.userAgent,
        details: { storedDeviceId, clientDeviceId },
      });
      return { success: false, error: "Device mismatch — session revoked" };
    }

    await this.prisma.refreshToken.update({
      where: { token: payload.refreshToken },
      data: { revokedAt: new Date(), lastActivityAt: new Date() },
    });

    // Database deviceId is authoritative; client may only supply it for legacy rows.
    const deviceId = storedDeviceId ?? clientDeviceId ?? undefined;
    const accessToken = this.jwtService.generateAccessToken({ userId: user.id, email: user.email, deviceId });
    const refreshToken = await this.createRefreshToken({
      userId: user.id,
      deviceId,
      deviceName: payload.deviceName,
      userAgent: payload.userAgent,
      ipAddress: payload.ipAddress,
    });

    return { success: true, accessToken, refreshToken };
  }

  async revokeRefreshToken(token: string): Promise<boolean> {
    try {
      await this.prisma.refreshToken.update({ where: { token }, data: { revokedAt: new Date() } });
      return true;
    } catch {
      return false;
    }
  }

  async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeOtherDeviceTokens(userId: string, deviceId?: string): Promise<number> {
    if (!deviceId) return this.revokeAllUserTokens(userId);
    // Revoke every active session except the current device — including legacy
    // rows with a NULL deviceId (SQL `!=` skips NULLs, so match them explicitly).
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ deviceId: { not: deviceId } }, { deviceId: null }],
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeDeviceToken(userId: string, deviceId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async deleteExpiredTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  async getUserSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
        lastActivityAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
