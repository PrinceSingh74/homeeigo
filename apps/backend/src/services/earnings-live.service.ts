import prisma from "@/lib/prisma";
import { roomManager, MessageType, WSMessage } from "@/lib/websocket";

export interface EarningsUpdate {
  totalEarnings: number;
  todayEarnings: number;
  weeklyEarnings: number;
  monthlyEarnings: number;
  completedBookings: number;
  walletBalance: number;
  pendingAmount: number;
  /** Most recent earning event (Part 6C addition). */
  lastEarning?: {
    amount: number;
    bookingId: string | null;
    timestamp: Date;
  };
}

export interface EarningsDataPoint {
  date: string;
  amount: number;
  /** Part 6C addition — used by daily chart tooltips. */
  bookingsCount: number;
}

/**
 * Resolve the caller's User.id to the corresponding Provider.id.
 *
 * The WebSocket route at /ws/earnings/:providerId authorises by comparing
 * `payload.userId === :providerId`, so the param is always the **User id**.
 * The Earning + Provider tables key off `Provider.id`, so we must do this
 * one-time lookup before any queries.
 */
async function resolveProviderProfileId(userId: string): Promise<string | null> {
  const provider = await prisma.provider.findUnique({
    where: { userId },
    select: { id: true },
  });
  return provider?.id ?? null;
}

export class EarningsLiveService {
  /**
   * Snapshot of all earnings tiles for the provider's dashboard.
   *
   * Accepts the **user id** as it comes from the WebSocket auth claim, then
   * internally resolves to the Provider profile id used by `Earning` rows.
   * Returns a zeroed snapshot if the user has no provider profile yet
   * (newly-signed-up customer flipping role, registration pending, etc.).
   */
  async getEarningsData(userId: string): Promise<EarningsUpdate> {
    const providerProfileId = await resolveProviderProfileId(userId);
    if (!providerProfileId) {
      return {
        totalEarnings: 0,
        todayEarnings: 0,
        weeklyEarnings: 0,
        monthlyEarnings: 0,
        completedBookings: 0,
        walletBalance: 0,
        pendingAmount: 0,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const earnings = await prisma.earning.findMany({
      where: { providerId: providerProfileId },
      orderBy: { earningDate: "desc" },
    });

    const totalEarnings = earnings.reduce((sum, e) => sum + e.netEarning, 0);
    const todayEarnings = earnings
      .filter((e) => new Date(e.earningDate) >= today)
      .reduce((sum, e) => sum + e.netEarning, 0);
    const weeklyEarnings = earnings
      .filter((e) => new Date(e.earningDate) >= weekStart)
      .reduce((sum, e) => sum + e.netEarning, 0);
    const monthlyEarnings = earnings
      .filter((e) => new Date(e.earningDate) >= monthStart)
      .reduce((sum, e) => sum + e.netEarning, 0);

    const completedBookings = earnings.length;
    const pendingEarnings = earnings
      .filter((e) => e.paymentStatus === "pending")
      .reduce((sum, e) => sum + e.netEarning, 0);

    const provider = await prisma.provider.findUnique({
      where: { id: providerProfileId },
      select: { walletBalance: true },
    });

    const lastEarning = earnings[0];

    return {
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      todayEarnings: Math.round(todayEarnings * 100) / 100,
      weeklyEarnings: Math.round(weeklyEarnings * 100) / 100,
      monthlyEarnings: Math.round(monthlyEarnings * 100) / 100,
      completedBookings,
      walletBalance: provider?.walletBalance ?? 0,
      pendingAmount: Math.round(pendingEarnings * 100) / 100,
      lastEarning: lastEarning
        ? {
            amount: Math.round(lastEarning.netEarning * 100) / 100,
            bookingId: lastEarning.bookingId,
            timestamp: lastEarning.earningDate,
          }
        : undefined,
    };
  }

  async broadcastEarningsUpdate(userId: string): Promise<void> {
    const earningsData = await this.getEarningsData(userId);

    const message: WSMessage = {
      type: MessageType.EARNINGS_UPDATE,
      data: earningsData,
      timestamp: new Date(),
    };

    roomManager.sendToUser(userId, message);
    console.log(`[Earnings] Update sent to ${userId}`);
  }

  async notifyWithdrawalInitiated(
    userId: string,
    amount: number,
    withdrawalId: string
  ): Promise<void> {
    const message: WSMessage = {
      type: MessageType.WITHDRAWAL_INITIATED,
      data: {
        withdrawalId,
        amount: Math.round(amount * 100) / 100,
        status: "initiated",
        estimatedTime: "2-3 business days",
        timestamp: new Date(),
      },
      timestamp: new Date(),
    };

    roomManager.sendToUser(userId, message);
  }

  /**
   * Daily earnings breakdown, grouped by ISO date.
   * Now includes `bookingsCount` per day so consumers can tooltip them.
   */
  async getEarningsBreakdown(
    userId: string,
    days: number = 7
  ): Promise<EarningsDataPoint[]> {
    const providerProfileId = await resolveProviderProfileId(userId);
    if (!providerProfileId) return [];

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const earnings = await prisma.earning.findMany({
      where: {
        providerId: providerProfileId,
        earningDate: { gte: startDate },
      },
      orderBy: { earningDate: "asc" },
    });

    const grouped = new Map<string, { amount: number; count: number }>();

    for (const earning of earnings) {
      const day = earning.earningDate.toISOString().split("T")[0];
      const current = grouped.get(day) ?? { amount: 0, count: 0 };
      grouped.set(day, {
        amount: current.amount + earning.netEarning,
        count: current.count + 1,
      });
    }

    return Array.from(grouped.entries()).map(([date, { amount, count }]) => ({
      date,
      amount: Math.round(amount * 100) / 100,
      bookingsCount: count,
    }));
  }

  /**
   * Top earning days over the last `lookbackDays` window (default 90).
   * Returns the `limit` highest-earning days sorted by amount.
   * Part 6C addition.
   */
  async getTopEarningDays(
    userId: string,
    limit: number = 10,
    lookbackDays: number = 90
  ): Promise<EarningsDataPoint[]> {
    const providerProfileId = await resolveProviderProfileId(userId);
    if (!providerProfileId) return [];

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const earnings = await prisma.earning.findMany({
      where: {
        providerId: providerProfileId,
        earningDate: { gte: startDate },
      },
      orderBy: { earningDate: "asc" },
    });

    const grouped = new Map<string, { amount: number; count: number }>();

    for (const earning of earnings) {
      const day = earning.earningDate.toISOString().split("T")[0];
      const current = grouped.get(day) ?? { amount: 0, count: 0 };
      grouped.set(day, {
        amount: current.amount + earning.netEarning,
        count: current.count + 1,
      });
    }

    return Array.from(grouped.entries())
      .map(([date, { amount, count }]) => ({
        date,
        amount: Math.round(amount * 100) / 100,
        bookingsCount: count,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }

  async getMonthlyEarningsTrend(userId: string, months: number = 6) {
    const providerProfileId = await resolveProviderProfileId(userId);
    if (!providerProfileId) return [];

    const earnings = await prisma.earning.findMany({
      where: { providerId: providerProfileId },
      orderBy: { earningDate: "asc" },
    });

    const grouped = new Map<string, number>();

    for (const earning of earnings) {
      const monthKey = earning.earningDate.toISOString().substring(0, 7);
      grouped.set(monthKey, (grouped.get(monthKey) ?? 0) + earning.netEarning);
    }

    return Array.from(grouped.entries())
      .slice(-months)
      .map(([month, amount]) => ({
        month,
        amount: Math.round(amount * 100) / 100,
      }));
  }
}

export const earningsLiveService = new EarningsLiveService();
