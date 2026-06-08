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
    const existing = await prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
    });

    if (existing) {
      const tokenChanged = existing.expoPushToken !== input.expoPushToken;
      if (tokenChanged) {
        await prisma.userDevice.updateMany({
          where: { expoPushToken: input.expoPushToken, id: { not: existing.id } },
          data: { isActive: false, revokedAt: now },
        });
      }
      return prisma.userDevice.update({
        where: { id: existing.id },
        data: {
          expoPushToken: input.expoPushToken,
          platform: input.platform,
          deviceName: input.deviceName,
          appVersion: input.appVersion,
          osVersion: input.osVersion,
          tokenUpdatedAt: tokenChanged ? now : existing.tokenUpdatedAt,
          lastSeenAt: now,
          isActive: true,
          revokedAt: null,
        },
      });
    }

    await prisma.userDevice.updateMany({
      where: { expoPushToken: input.expoPushToken },
      data: { isActive: false, revokedAt: now },
    });

    return prisma.userDevice.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        deviceName: input.deviceName,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
        tokenUpdatedAt: now,
        lastSeenAt: now,
        isActive: true,
      },
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

  async getActiveTokens(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushNotifications: true },
    });
    if (!user?.pushNotifications) return [];

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
