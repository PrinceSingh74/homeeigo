import prisma from "../../../lib/prisma";

export async function collectFinanceContext(): Promise<Record<string, unknown>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    pendingRefunds,
    pendingSettlements,
    revenueToday,
    walletAgg,
    recentRefunds,
  ] = await Promise.all([
    prisma.refundRequest.count({ where: { status: "REQUESTED" } }).catch(() => 0),
    prisma.payoutReconciliation.count().catch(() => 0),
    prisma.booking.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: todayStart } },
      _sum: { totalAmount: true },
    }).catch(() => ({ _sum: { totalAmount: 0 } })),
    prisma.user.aggregate({ _sum: { walletBalance: true } }).catch(() => ({ _sum: { walletBalance: 0 } })),
    prisma.refundRequest.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, amount: true, status: true, reason: true, createdAt: true },
    }).catch(() => []),
  ]);

  const ledgerEntries = await prisma.journalEntry.count({
    where: { createdAt: { gte: todayStart } },
  }).catch(() => 0);

  return {
    payments: {
      revenueToday: revenueToday._sum.totalAmount ?? 0,
      totalWalletLiability: walletAgg._sum.walletBalance ?? 0,
    },
    refunds: { pending: pendingRefunds, recent: recentRefunds },
    settlements: { pending: pendingSettlements },
    ledger: { entriesToday: ledgerEntries },
  };
}
