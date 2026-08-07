import prisma from "../../../lib/prisma";

export async function collectPartnerContext(partnerId: string): Promise<Record<string, unknown>> {
  const provider = await prisma.provider.findUnique({
    where: { id: partnerId },
    select: {
      id: true,
      businessName: true,
      rating: true,
      totalBookings: true,
      isOnline: true,
      serviceCategories: true,
      serviceRegions: true,
      acceptanceRate: true,
      cancellationRate: true,
      onlineSince: true,
      isApproved: true,
      isVerified: true,
      thisWeekEarnings: true,
      thisMonthEarnings: true,
    },
  });

  if (!provider) return {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayJobs, activeJobs, todayEarnings, pendingDocs] = await Promise.all([
    prisma.booking.count({
      where: { providerId: partnerId, createdAt: { gte: todayStart } },
    }),
    prisma.booking.findMany({
      where: { providerId: partnerId, status: { in: ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
      take: 5,
      select: { id: true, status: true, service: { select: { name: true } } },
    }),
    prisma.earning.aggregate({
      where: { providerId: partnerId, createdAt: { gte: todayStart } },
      _sum: { netEarning: true },
    }),
    prisma.providerDocument.count({
      where: { providerId: partnerId, isVerified: false },
    }).catch(() => 0),
  ]);

  return {
    profile: {
      id: provider.id,
      businessName: provider.businessName,
      rating: provider.rating,
      totalBookings: provider.totalBookings,
      isOnline: provider.isOnline,
      onlineSince: provider.onlineSince?.toISOString(),
      categories: provider.serviceCategories,
      regions: provider.serviceRegions,
      verified: provider.isVerified,
      approved: provider.isApproved,
    },
    performance: {
      acceptanceRate: provider.acceptanceRate,
      cancellationRate: provider.cancellationRate,
    },
    todayJobs,
    currentJobs: activeJobs,
    earnings: {
      today: todayEarnings._sum.netEarning ?? 0,
      week: provider.thisWeekEarnings,
      month: provider.thisMonthEarnings,
    },
    compliance: { pendingDocuments: pendingDocs },
  };
}
