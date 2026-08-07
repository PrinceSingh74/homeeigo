import prisma from "../../../lib/prisma";

export async function collectOperationsContext(): Promise<Record<string, unknown>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    activeBookings,
    pendingBookings,
    onlineProviders,
    totalProviders,
    completedToday,
    cancelledToday,
  ] = await Promise.all([
    prisma.booking.count({
      where: { status: { in: ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
    }),
    prisma.booking.count({ where: { status: "PENDING" } }),
    prisma.provider.count({ where: { isOnline: true } }),
    prisma.provider.count({ where: { isActive: true } }),
    prisma.booking.count({ where: { status: "COMPLETED", completedAt: { gte: todayStart } } }).catch(() => 0),
    prisma.booking.count({
      where: {
        status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] },
        updatedAt: { gte: todayStart },
      },
    }).catch(() => 0),
  ]);

  const utilization = totalProviders > 0 ? onlineProviders / totalProviders : 0;
  const completionRate = completedToday + cancelledToday > 0
    ? completedToday / (completedToday + cancelledToday)
    : 1;

  return {
    dispatch: {
      activeBookings,
      pendingBookings,
      backlog: pendingBookings,
    },
    capacity: {
      onlineProviders,
      totalProviders,
      utilizationPct: Math.round(utilization * 100),
    },
    sla: {
      completedToday,
      cancelledToday,
      completionRatePct: Math.round(completionRate * 100),
    },
    fleet: {
      online: onlineProviders,
      offline: totalProviders - onlineProviders,
    },
  };
}
