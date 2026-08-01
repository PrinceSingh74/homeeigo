import type { PrismaClient } from "@prisma/client";
import { JWTService, JWT_CONFIG } from "./jwt.service";
import { AuditLogService } from "./audit-log.service";
import { partnerRegistrationService } from "./partner-registration.service";
import { refreshTokenFamilyService } from "./refresh-token-family.service";
import { tokenRevocationService } from "./token-revocation.service";

export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtService: JWTService,
  ) {}

  async createRefreshToken(payload: {
    userId: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
    familyId?: string;
    parentTokenId?: string;
    createdBy?: string;
  }): Promise<string> {
    const familyId = payload.familyId ?? refreshTokenFamilyService.createFamily();
    const authEpoch = await tokenRevocationService.getAuthEpoch(payload.userId);
    const token = this.jwtService.generateRefreshToken({
      userId: payload.userId,
      familyId,
      authEpoch,
    });
    const expiresAt = new Date(Date.now() + JWT_CONFIG.REFRESH_TOKEN_SECONDS * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId: payload.userId,
        expiresAt,
        familyId,
        parentTokenId: payload.parentTokenId,
        createdBy: payload.createdBy ?? (payload.parentTokenId ? "REFRESH" : "LOGIN"),
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        userAgent: payload.userAgent,
        ipAddress: payload.ipAddress,
        lastActivityAt: new Date(),
      },
    });

    return token;
  }

  async createSessionTokens(payload: {
    userId: string;
    email: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const familyId = refreshTokenFamilyService.createFamily();
    const authEpoch = await tokenRevocationService.getAuthEpoch(payload.userId);
    const accessToken = this.jwtService.generateAccessToken({
      userId: payload.userId,
      email: payload.email,
      deviceId: payload.deviceId,
      authEpoch,
    });
    const refreshToken = await this.createRefreshToken({
      ...payload,
      familyId,
      createdBy: "LOGIN",
    });
    return { accessToken, refreshToken };
  }

  async verifyRefreshToken(
    token: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    isValid: boolean;
    error?: string;
    userId?: string;
    deviceId?: string | null;
    dbTokenId?: string;
    familyId?: string | null;
  }> {
    const payload = this.jwtService.verifyRefreshToken(token);
    if (!payload?.userId) return { isValid: false, error: "Invalid or expired token" };

    const dbToken = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!dbToken) return { isValid: false, error: "Token not found in database" };

    if (dbToken.revokedAt) {
      await refreshTokenFamilyService.handleReuseAttack(
        dbToken.userId,
        dbToken.familyId,
        dbToken.id,
        meta,
      );
      return { isValid: false, error: "Token has been revoked" };
    }

    if (dbToken.expiresAt < new Date()) {
      return { isValid: false, error: "Token has expired" };
    }

    if (payload.authEpoch !== undefined) {
      const currentEpoch = await tokenRevocationService.getAuthEpoch(payload.userId);
      if (payload.authEpoch < currentEpoch) {
        return { isValid: false, error: "Token has been revoked" };
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: dbToken.userId } });
    if (!user?.isActive || user.isBanned) {
      return { isValid: false, error: "User not found or inactive" };
    }

    return {
      isValid: true,
      userId: dbToken.userId,
      deviceId: dbToken.deviceId,
      dbTokenId: dbToken.id,
      familyId: dbToken.familyId,
    };
  }

  async refreshAccessToken(payload: {
    refreshToken: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; error?: string; accessToken?: string; refreshToken?: string }> {
    const verification = await this.verifyRefreshToken(payload.refreshToken, {
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
    });
    if (!verification.isValid || !verification.userId || !verification.dbTokenId) {
      return { success: false, error: verification.error };
    }

    const user = await this.prisma.user.findUnique({ where: { id: verification.userId } });
    if (!user) return { success: false, error: "User not found" };

    if (user.role === "VENDOR") {
      const approvalBlock = await partnerRegistrationService.assertPartnerCanLogin(user.id);
      if (approvalBlock) return { success: false, error: approvalBlock };
    }

    const storedDeviceId = verification.deviceId ?? null;
    const clientDeviceId = payload.deviceId ?? null;
    if (storedDeviceId && clientDeviceId && storedDeviceId !== clientDeviceId) {
      await this.revokeRefreshToken(payload.refreshToken, "DEVICE_REVOCATION");
      void AuditLogService.failure("DEVICE_MISMATCH", {
        userId: user.id,
        ipAddress: payload.ipAddress,
        userAgent: payload.userAgent,
        details: { storedDeviceId, clientDeviceId },
      });
      return { success: false, error: "Device mismatch — session revoked" };
    }

    const familyId =
      verification.familyId ?? refreshTokenFamilyService.createFamily();

    await this.prisma.refreshToken.update({
      where: { id: verification.dbTokenId },
      data: {
        revokedAt: new Date(),
        revokedReason: "ROTATION",
        lastActivityAt: new Date(),
      },
    });

    const deviceId = storedDeviceId ?? clientDeviceId ?? undefined;
    const authEpoch = await tokenRevocationService.getAuthEpoch(user.id);
    const { userPiiService } = await import("./user-pii.service");
    const sessionEmail = (await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true })) ?? "";
    const accessToken = this.jwtService.generateAccessToken({
      userId: user.id,
      email: sessionEmail,
      deviceId,
      authEpoch,
    });
    const refreshToken = await this.createRefreshToken({
      userId: user.id,
      deviceId,
      deviceName: payload.deviceName,
      userAgent: payload.userAgent,
      ipAddress: payload.ipAddress,
      familyId,
      parentTokenId: verification.dbTokenId,
      createdBy: "REFRESH",
    });

    void AuditLogService.success("TOKEN_REFRESH", {
      userId: user.id,
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
      details: { familyId },
    });

    return { success: true, accessToken, refreshToken };
  }

  async revokeRefreshToken(
    token: string,
    reason = "LOGOUT",
  ): Promise<boolean> {
    try {
      await this.prisma.refreshToken.update({
        where: { token },
        data: {
          revokedAt: new Date(),
          revokedReason: reason,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async revokeAllUserTokens(
    userId: string,
    reason: Parameters<typeof tokenRevocationService.revokeAllUserTokens>[1] = "MANUAL_REVOCATION",
    revokedBy = userId,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<number> {
    return tokenRevocationService.revokeAllUserTokens(userId, reason, revokedBy, meta);
  }

  async revokeOtherDeviceTokens(userId: string, deviceId?: string): Promise<number> {
    if (!deviceId) return this.revokeAllUserTokens(userId, "DEVICE_REVOCATION", userId);
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ deviceId: { not: deviceId } }, { deviceId: null }],
      },
      data: {
        revokedAt: new Date(),
        revokedReason: "DEVICE_REVOCATION",
      },
    });
    if (result.count > 0) {
      await tokenRevocationService.bumpAuthEpoch(userId);
    }
    return result.count;
  }

  async revokeDeviceToken(userId: string, deviceId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "DEVICE_REVOCATION",
      },
    });
    return result.count;
  }

  async deleteExpiredTokens(): Promise<number> {
    const [expired, families] = await Promise.all([
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      refreshTokenFamilyService.cleanupOldFamilies(),
    ]);
    return expired.count + families;
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
        familyId: true,
        createdBy: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
