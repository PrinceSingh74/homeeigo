import type { PrismaClient } from "@prisma/client";
import { JWTService, JWT_CONFIG } from "./jwt.service";
import { AuditLogService } from "./audit-log.service";
import { partnerRegistrationService } from "./partner-registration.service";
import { refreshTokenFamilyService } from "./refresh-token-family.service";
import { tokenRevocationService } from "./token-revocation.service";
import { incCounter } from "../lib/metrics";

/**
 * How long after a rotation the parent token is still answered with its successor instead of being
 * treated as a replay. Long enough for tabs racing on one cookie, short enough that a stolen token
 * replayed by an attacker still burns the family.
 */
const ROTATION_GRACE_MS = 20_000;

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
  }): Promise<{ token: string; sessionId: string }> {
    const familyId = payload.familyId ?? refreshTokenFamilyService.createFamily();
    const authEpoch = await tokenRevocationService.getAuthEpoch(payload.userId);
    const token = this.jwtService.generateRefreshToken({
      userId: payload.userId,
      familyId,
      authEpoch,
    });
    const expiresAt = new Date(Date.now() + JWT_CONFIG.REFRESH_TOKEN_SECONDS * 1000);

    const row = await this.prisma.refreshToken.create({
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

    return { token, sessionId: row.id };
  }

  async createSessionTokens(payload: {
    userId: string;
    email: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const familyId = refreshTokenFamilyService.createFamily();
    const authEpoch = await tokenRevocationService.getAuthEpoch(payload.userId);
    const accessToken = this.jwtService.generateAccessToken({
      userId: payload.userId,
      email: payload.email,
      deviceId: payload.deviceId,
      authEpoch,
    });
    const { token: refreshToken, sessionId } = await this.createRefreshToken({
      ...payload,
      familyId,
      createdBy: "LOGIN",
    });
    void import("./partner-presence.service").then(({ promotePartnerSessionForUser }) =>
      promotePartnerSessionForUser(payload.userId, sessionId, payload.deviceId).catch(() => {}),
    );
    return { accessToken, refreshToken, sessionId };
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
    /** Set when this call hit the rotation grace window: the live successor to answer with. */
    graceSuccessorToken?: string;
  }> {
    const payload = this.jwtService.verifyRefreshToken(token);
    if (!payload?.userId) return { isValid: false, error: "Invalid or expired token" };

    const dbToken = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!dbToken) return { isValid: false, error: "Token not found in database" };

    if (dbToken.revokedAt) {
      /**
       * Rotation grace window.
       *
       * Two tabs (or a page and its WebSocket) can refresh at the same instant. Both send the SAME
       * cookie, because the browser applies the rotated Set-Cookie asynchronously — so the loser
       * presents a token that was rotated milliseconds ago. Treating that as theft revoked the whole
       * family, bumped the auth epoch and signed the user out of every device (independent review,
       * 2026-09-20).
       *
       * A token that was rotated within the grace window AND whose successor is still live is a
       * race, not a replay: the caller is answered with that successor instead of a new rotation.
       * Outside the window, or if the successor is gone, it is still treated as reuse — a stolen
       * token replayed later burns the family exactly as before.
       */
      const rotatedRecently =
        dbToken.revokedReason === "ROTATION" &&
        Date.now() - dbToken.revokedAt.getTime() <= ROTATION_GRACE_MS;
      if (rotatedRecently) {
        const successor = await this.prisma.refreshToken.findFirst({
          where: { parentTokenId: dbToken.id, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        });
        if (successor) {
          incCounter("auth_refresh_rotation_race_total");
          return {
            isValid: true,
            userId: dbToken.userId,
            deviceId: successor.deviceId,
            dbTokenId: successor.id,
            familyId: successor.familyId,
            graceSuccessorToken: successor.token,
          };
        }
      }
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
  }): Promise<{ success: boolean; error?: string; accessToken?: string; refreshToken?: string; sessionId?: string }> {
    const verification = await this.verifyRefreshToken(payload.refreshToken, {
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
    });
    if (!verification.isValid || !verification.userId || !verification.dbTokenId) {
      return { success: false, error: verification.error };
    }

    const user = await this.prisma.user.findUnique({ where: { id: verification.userId } });
    if (!user) return { success: false, error: "User not found" };

    /**
     * Rotation race: another caller already rotated this token moments ago. Hand back a fresh access
     * token for the successor WITHOUT rotating again — rotating here would invalidate the token the
     * winner is already using and start the storm this window exists to prevent.
     */
    if (verification.graceSuccessorToken) {
      // The grace answer skipped the ban/active check the normal path makes below.
      if (!user.isActive || user.isBanned) return { success: false, error: "User not found or inactive" };
      const authEpoch = await tokenRevocationService.getAuthEpoch(user.id);
      return {
        success: true,
        accessToken: this.jwtService.generateAccessToken({
          userId: user.id,
          email: user.email ?? "",
          deviceId: payload.deviceId ?? verification.deviceId ?? undefined,
          authEpoch,
        }),
        refreshToken: verification.graceSuccessorToken,
        sessionId: verification.dbTokenId,
      };
    }

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

    /**
     * Rotate by compare-and-swap (2026-10-01). The revoke used to be unconditional, so two refreshes
     * of the same token that both passed verification both rotated it and BOTH minted a live successor
     * — a stolen token raced against the real one kept its own branch alive, and reuse detection
     * never fired. Only the caller that flips revokedAt may mint; the other is the "two tabs" race and
     * gets the winner's successor, exactly as the grace window answers it.
     */
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: verification.dbTokenId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: "ROTATION",
        lastActivityAt: new Date(),
      },
    });
    if (rotated.count === 0) {
      incCounter("auth_refresh_rotation_race_total");
      const successor = await this.awaitRotationSuccessor(verification.dbTokenId);
      if (!successor) return { success: false, error: "Token has been revoked" };
      const authEpoch = await tokenRevocationService.getAuthEpoch(user.id);
      return {
        success: true,
        accessToken: this.jwtService.generateAccessToken({
          userId: user.id,
          email: user.email ?? "",
          deviceId: payload.deviceId ?? successor.deviceId ?? undefined,
          authEpoch,
        }),
        refreshToken: successor.token,
        sessionId: successor.id,
      };
    }

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
    const { token: refreshToken, sessionId } = await this.createRefreshToken({
      userId: user.id,
      deviceId,
      deviceName: payload.deviceName,
      userAgent: payload.userAgent,
      ipAddress: payload.ipAddress,
      familyId,
      parentTokenId: verification.dbTokenId,
      createdBy: "REFRESH",
    });

    void import("./partner-presence.service").then(({ promotePartnerSessionForUser }) =>
      promotePartnerSessionForUser(user.id, sessionId, deviceId).catch(() => {}),
    );

    void AuditLogService.success("TOKEN_REFRESH", {
      userId: user.id,
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
      details: { familyId },
    });

    return { success: true, accessToken, refreshToken, sessionId };
  }

  /**
   * The successor minted by whoever won a rotation race. The winner revokes first and inserts the
   * successor a few statements later, so the loser can arrive in between; it waits up to ~1 s for it.
   * Null means the token was revoked for some other reason in that instant — refused, but never
   * escalated to a reuse attack, which would sign a legitimate user out of every device.
   */
  private async awaitRotationSuccessor(tokenId: string) {
    for (let i = 0; i < 20; i++) {
      const successor = await this.prisma.refreshToken.findFirst({
        where: { parentTokenId: tokenId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (successor) return successor;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
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

  /**
   * Revoke a token only if it belongs to `userId`.
   *
   * Logout reads the refresh cookie, and without a declared audience the jar is scanned in a fixed
   * order — so revoking purely by token value could end another account's session in a browser that
   * holds more than one (independent review, 2026-09-20). `updateMany` with both conditions makes a
   * mismatch a no-op rather than a cross-account logout.
   */
  async revokeRefreshTokenForUser(token: string, userId: string, reason = "LOGOUT"): Promise<boolean> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { token, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count > 0;
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
