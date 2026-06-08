import { FraudEventType } from "@prisma/client";
import prisma from "../lib/prisma";
import type { FraudContext } from "../lib/fraud-context";

export class FraudSignalService {
  async capture(
    eventType: FraudEventType,
    ctx: FraudContext,
    reference?: { id: string; type: string },
  ) {
    return prisma.fraudSignal.create({
      data: {
        userId: ctx.userId,
        eventType,
        referenceId: reference?.id,
        referenceType: reference?.type,
        deviceId: ctx.deviceId,
        deviceFingerprint: ctx.deviceFingerprint,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        browserFingerprint: ctx.browserFingerprint,
        latitude: ctx.latitude,
        longitude: ctx.longitude,
        city: ctx.city,
        country: ctx.country,
        timezone: ctx.timezone,
        networkMetadata: ctx.networkMetadata ? JSON.stringify(ctx.networkMetadata) : undefined,
      },
    });
  }

  async usersSharingDevice(deviceId: string, excludeUserId?: string): Promise<string[]> {
    if (!deviceId) return [];
    const rows = await prisma.fraudSignal.findMany({
      where: { deviceId, userId: excludeUserId ? { not: excludeUserId } : { not: null } },
      select: { userId: true },
      distinct: ["userId"],
      take: 50,
    });
    return rows.map((r) => r.userId!).filter(Boolean);
  }

  async usersSharingIp(ipAddress: string, excludeUserId?: string, hours = 72): Promise<string[]> {
    if (!ipAddress || ipAddress === "unknown") return [];
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await prisma.fraudSignal.findMany({
      where: {
        ipAddress,
        createdAt: { gte: since },
        userId: excludeUserId ? { not: excludeUserId } : { not: null },
      },
      select: { userId: true },
      distinct: ["userId"],
      take: 50,
    });
    return rows.map((r) => r.userId!).filter(Boolean);
  }

  async usersSharingBrowserFingerprint(fp: string, excludeUserId?: string): Promise<string[]> {
    if (!fp) return [];
    const rows = await prisma.fraudSignal.findMany({
      where: { browserFingerprint: fp, userId: excludeUserId ? { not: excludeUserId } : { not: null } },
      select: { userId: true },
      distinct: ["userId"],
      take: 50,
    });
    return rows.map((r) => r.userId!).filter(Boolean);
  }

  async referrerRefereeShareSignals(referrerId: string, refereeId: string, ctx: FraudContext) {
    // Only compare referee signup context against referrer identity signals.
    // REFERRAL events are logged on the referrer but carry the referee's device/IP — exclude them.
    const referrerSignals = await prisma.fraudSignal.findMany({
      where: {
        userId: referrerId,
        eventType: { in: [FraudEventType.SIGNUP, FraudEventType.BOOKING, FraudEventType.WITHDRAWAL] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const matches: string[] = [];
    for (const s of referrerSignals) {
      if (ctx.deviceId && s.deviceId === ctx.deviceId) matches.push("same_device");
      if (ctx.ipAddress && s.ipAddress === ctx.ipAddress && ctx.ipAddress !== "unknown")
        matches.push("same_ip");
      if (ctx.browserFingerprint && s.browserFingerprint === ctx.browserFingerprint)
        matches.push("same_browser");
      if (ctx.deviceFingerprint && s.deviceFingerprint === ctx.deviceFingerprint)
        matches.push("same_device_fingerprint");
    }
    return [...new Set(matches)];
  }

  async referralVelocity(referrerId: string, hours = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 3600_000);
    return prisma.fraudSignal.count({
      where: { userId: referrerId, eventType: FraudEventType.REFERRAL, createdAt: { gte: since } },
    });
  }

  async signupVelocity(ipAddress: string, hours = 1): Promise<number> {
    if (!ipAddress || ipAddress === "unknown") return 0;
    const since = new Date(Date.now() - hours * 3600_000);
    return prisma.fraudSignal.count({
      where: { ipAddress, eventType: FraudEventType.SIGNUP, createdAt: { gte: since } },
    });
  }
}

export const fraudSignalService = new FraudSignalService();
