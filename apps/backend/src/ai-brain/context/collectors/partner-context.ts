import prisma from "../../../lib/prisma";
import { CREDITED_EARNING_WHERE } from "../../../lib/earning-settlement";
import type { PartnerAiIntent } from "../../../ai/intent/partner-intent";

const SENSITIVE_KEYS = new Set([
  "kyc", "bank", "accountNumber", "ifsc", "pan", "aadhaar", "fraud", "riskInvestigation", "adminNotes",
]);

function stripSensitive(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function collectPartnerContext(
  partnerId: string,
  focus: PartnerAiIntent | string = "GENERAL",
): Promise<Record<string, unknown>> {
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

  const wantEarnings = focus === "EARNINGS" || focus === "PAYOUT" || focus === "GENERAL" || focus === "DEMAND";
  const wantJobs = focus === "JOBS" || focus === "ROUTE" || focus === "SCHEDULE" || focus === "GENERAL";
  const wantPerformance = focus === "PERFORMANCE" || focus === "CAREER" || focus === "GENERAL";

  const [todayJobs, activeJobs, todayEarnings] = await Promise.all([
    wantJobs
      ? prisma.booking.count({
          where: { providerId: partnerId, createdAt: { gte: todayStart } },
        })
      : Promise.resolve(0),
    wantJobs
      ? prisma.booking.findMany({
          where: { providerId: partnerId, status: { in: ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
          take: 5,
          select: { id: true, status: true, service: { select: { name: true } } },
        })
      : Promise.resolve([]),
    wantEarnings
      ? prisma.earning.aggregate({
          where: { providerId: partnerId, createdAt: { gte: todayStart }, ...CREDITED_EARNING_WHERE },
          _sum: { netEarning: true },
        })
      : Promise.resolve({ _sum: { netEarning: 0 } }),
  ]);

  const profile = {
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
  };

  const data: Record<string, unknown> = { profile };

  if (wantPerformance) {
    data.performance = {
      acceptanceRate: provider.acceptanceRate,
      cancellationRate: provider.cancellationRate,
    };
  }
  if (wantJobs) {
    data.todayJobs = todayJobs;
    data.currentJobs = activeJobs;
  }
  if (wantEarnings) {
    data.earnings = {
      today: todayEarnings._sum.netEarning ?? 0,
      week: provider.thisWeekEarnings,
      month: provider.thisMonthEarnings,
    };
  }

  return stripSensitive(data);
}
