import prisma from "../../../lib/prisma";

export async function collectAdminContext(): Promise<Record<string, unknown>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    bookingsToday,
    activeBookings,
    onlineProviders,
    totalProviders,
    pendingRefunds,
    unresolvedDlq,
    pendingOutbox,
  ] = await Promise.all([
    prisma.booking.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.booking.count({
      where: { status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
    }),
    prisma.provider.count({ where: { isOnline: true } }),
    prisma.provider.count({ where: { isActive: true } }),
    prisma.refundRequest.count({ where: { status: "REQUESTED" } }).catch(() => 0),
    prisma.eventDeadLetter.count({ where: { resolvedAt: null } }).catch(() => 0),
    prisma.eventOutbox.count({ where: { status: "PENDING" } }).catch(() => 0),
  ]);

  const revenueToday = await prisma.booking.aggregate({
    where: { createdAt: { gte: todayStart }, status: "COMPLETED" },
    _sum: { totalAmount: true },
  }).catch(() => ({ _sum: { totalAmount: 0 } }));

  const recentFraud = await prisma.fraudAlert.count({
    where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, status: "OPEN" },
  }).catch(() => 0);

  return {
    operations: {
      bookingsToday,
      activeBookings,
      onlineProviders,
      totalProviders,
      supplyRatio: totalProviders > 0 ? onlineProviders / totalProviders : 0,
    },
    finance: {
      revenueToday: revenueToday._sum.totalAmount ?? 0,
      pendingRefunds,
    },
    risk: { openFraudAlerts24h: recentFraud },
    platform: {
      outboxPending: pendingOutbox,
      dlqUnresolved: unresolvedDlq,
    },
  };
}
