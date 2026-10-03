import type { PushPlatform } from "@prisma/client";
import prisma from "../lib/prisma";

export type RegisterPushTokenInput = {
  userId: string;
  deviceId: string;
  expoPushToken: string;
  platform: PushPlatform;
  deviceName?: string;
  appVersion?: string;
  osVersion?: string;
};

export class DevicePushService {
  async upsertToken(input: RegisterPushTokenInput) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      /**
       * A push token identifies one app install on one phone. If it is held by ANOTHER
       * (userId, deviceId) — a different account signed in on the same phone, or a stale row — that
       * row is removed, not deactivated: `expo_push_token` is UNIQUE, so a deactivated row kept the
       * token and the new owner's registration failed with P2002, while the old owner's row was
       * already switched off. The token must reach exactly one account.
       *
       * Scoped with NOT (userId, deviceId): concurrent registrations of the SAME device must never
       * remove each other's row (4 concurrent identical registrations once left zero active devices).
       */
      await tx.userDevice.deleteMany({
        where: {
          expoPushToken: input.expoPushToken,
          NOT: { userId: input.userId, deviceId: input.deviceId },
        },
      });

      const existing = await tx.userDevice.findUnique({
        where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
        select: { expoPushToken: true },
      });
      const tokenChanged = !existing || existing.expoPushToken !== input.expoPushToken;
      const fields = {
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceName: input.deviceName,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
        lastSeenAt: now,
        isActive: true,
        revokedAt: null,
      };

      // Upsert, so the losers of a concurrent same-device race converge onto the winner's row.
      return tx.userDevice.upsert({
        where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
        create: { userId: input.userId, deviceId: input.deviceId, ...fields, tokenUpdatedAt: now },
        update: { ...fields, ...(tokenChanged ? { tokenUpdatedAt: now } : {}) },
      });
    });
  }

  async listActive(userId: string) {
    return prisma.userDevice.findMany({
      where: { userId, isActive: true },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  async revokeDevice(userId: string, deviceId: string) {
    const now = new Date();
    await prisma.userDevice.updateMany({
      where: { userId, deviceId, isActive: true },
      data: { isActive: false, revokedAt: now },
    });
  }

  async revokeAll(userId: string) {
    const now = new Date();
    await prisma.userDevice.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt: now },
    });
  }

  /**
   * The push tokens a user can be reached on.
   *
   * ── Two questions, deliberately separable ──────────────────────────────────
   *
   * "Does this person have a device?" is a capability question. "May we push to them?" is a policy
   * question, and the notification router already answers it through `evaluatePreference`, which
   * knows that SECURITY and TRANSACTIONAL categories cannot be refused.
   *
   * Answering both here — as this method did unconditionally — meant a recipient who had ever
   * turned push off lost it for *every* category, including the mandatory ones. The router could
   * not even see the channel to make its own decision: the target simply vanished before
   * governance ran.
   *
   * The legacy default keeps the preference gate, because `pushDeliveryService` is called directly
   * by the imperative notification path, which has no governance layer of its own and would
   * otherwise start pushing to people who opted out. `includeOptedOut` is for callers that apply
   * preference themselves — today only the recipient resolver.
   */
  async getActiveTokens(
    userId: string,
    options: { includeOptedOut?: boolean } = {},
  ): Promise<string[]> {
    if (!options.includeOptedOut) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pushNotifications: true },
      });
      if (!user?.pushNotifications) return [];
    }

    const devices = await prisma.userDevice.findMany({
      where: { userId, isActive: true },
      select: { expoPushToken: true },
    });
    return devices.map((d) => d.expoPushToken);
  }

  async markTokensInvalid(tokens: string[]) {
    if (!tokens.length) return;
    const now = new Date();
    await prisma.userDevice.updateMany({
      where: { expoPushToken: { in: tokens }, isActive: true },
      data: { isActive: false, revokedAt: now },
    });
  }
}

export const devicePushService = new DevicePushService();
