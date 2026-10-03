import type { PartnerLeadSource, PartnerLeadStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { analyticsWhereVia } from "../lib/analytics-scope";
import { acquisitionSpendService } from "./acquisition-spend.service";

const APPLICATION_STATUSES: PartnerLeadStatus[] = [
  "APPLICATION_STARTED",
  "APPLICATION_SUBMITTED",
  "KYC_PENDING",
  "VERIFICATION",
  "TRAINING",
];

const VERIFIED_STATUSES: PartnerLeadStatus[] = [...APPLICATION_STATUSES, "APPROVED", "ACTIVATED"];
const STALLED_STATUSES: PartnerLeadStatus[] = [
  "APPLICATION_STARTED",
  "APPLICATION_SUBMITTED",
  "KYC_PENDING",
  "VERIFICATION",
  "TRAINING",
];
const ACTIVE_PIPELINE: PartnerLeadStatus[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "APPLICATION_STARTED",
  "APPLICATION_SUBMITTED",
  "KYC_PENDING",
  "VERIFICATION",
  "TRAINING",
  "APPROVED",
];

export type DashboardRange = "7d" | "30d" | "90d";

function rangeDays(range: DashboardRange): number {
  if (range === "7d") return 7;
  if (range === "90d") return 90;
  return 30;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function fillSeries(
  start: Date,
  days: number,
  rows: Array<{ day: Date; count: number }>,
): Array<{ date: string; count: number }> {
  const byDay = new Map(rows.map((r) => [startOfDay(r.day).toISOString().slice(0, 10), r.count]));
  const series: Array<{ date: string; count: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400_000);
    const key = startOfDay(d).toISOString().slice(0, 10);
    series.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return series;
}

export class PartnerAcquisitionAnalyticsService {
  async getDashboard(range: DashboardRange = "30d") {
    const now = new Date();
    const dayStart = startOfDay(now);
    const days = rangeDays(range);
    const currentStart = new Date(dayStart.getTime() - (days - 1) * 86400_000);
    const previousStart = new Date(currentStart.getTime() - days * 86400_000);
    const tomorrowStart = new Date(dayStart.getTime() + 86400_000);
    const tomorrowEnd = new Date(dayStart.getTime() + 2 * 86400_000 - 1);
    const stalledBefore = new Date(now.getTime() - 7 * 86400_000);

    const [
      totalLeads,
      newToday,
      applications,
      verified,
      training,
      activated,
      activePartners,
      followUpToday,
      followUpOverdue,
      followUpTomorrow,
      stalled,
      noNextAction,
      sourceBreakdown,
      funnelCounts,
      recentActivity,
      currentPeriodLeads,
      previousPeriodLeads,
      currentPeriodApps,
      previousPeriodApps,
      currentPeriodActivated,
      previousPeriodActivated,
    ] = await Promise.all([
      prisma.partnerLead.count({ where: { status: { notIn: ["DUPLICATE", "INVALID"] }, mergedIntoLeadId: null } }),
      prisma.partnerLead.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.partnerLead.count({ where: { status: { in: APPLICATION_STATUSES } } }),
      prisma.partnerLead.count({ where: { status: { in: ["VERIFICATION", "TRAINING", "APPROVED", "ACTIVATED"] } } }),
      prisma.partnerLead.count({ where: { status: "TRAINING" } }),
      prisma.partnerLead.count({ where: { status: "ACTIVATED" } }),
      // Active-partner supply is a business figure; fixture partners inherit their user's origin.
      prisma.provider.count({ where: { registrationStatus: "APPROVED", isActive: true, ...analyticsWhereVia("provider") } }),
      prisma.partnerLead.count({
        where: { nextFollowUpAt: { gte: dayStart, lt: tomorrowStart }, status: { in: ACTIVE_PIPELINE } },
      }),
      prisma.partnerLead.count({
        where: { nextFollowUpAt: { lt: dayStart }, status: { in: ACTIVE_PIPELINE } },
      }),
      prisma.partnerLead.count({
        where: { nextFollowUpAt: { gte: tomorrowStart, lte: tomorrowEnd }, status: { in: ACTIVE_PIPELINE } },
      }),
      prisma.partnerLead.count({
        where: {
          status: { in: STALLED_STATUSES },
          lastActivityAt: { lt: stalledBefore },
          mergedIntoLeadId: null,
        },
      }),
      prisma.partnerLead.count({
        where: {
          nextFollowUpAt: null,
          status: { in: ACTIVE_PIPELINE },
          mergedIntoLeadId: null,
        },
      }),
      this.sourcePerformance({ rangeStart: currentStart, rangeEnd: now }),
      this.funnelCounts(),
      prisma.partnerLeadActivity.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { lead: { select: { id: true, name: true, status: true } } },
      }),
      prisma.partnerLead.count({ where: { createdAt: { gte: currentStart }, status: { notIn: ["DUPLICATE", "INVALID"] } } }),
      prisma.partnerLead.count({
        where: { createdAt: { gte: previousStart, lt: currentStart }, status: { notIn: ["DUPLICATE", "INVALID"] } },
      }),
      prisma.partnerLead.count({ where: { applicationAt: { gte: currentStart } } }),
      prisma.partnerLead.count({ where: { applicationAt: { gte: previousStart, lt: currentStart } } }),
      prisma.partnerLead.count({ where: { status: "ACTIVATED", activationAt: { gte: currentStart } } }),
      prisma.partnerLead.count({
        where: { status: "ACTIVATED", activationAt: { gte: previousStart, lt: currentStart } },
      }),
    ]);

    const conversionRate = totalLeads > 0 ? Math.round((activated / totalLeads) * 1000) / 10 : 0;
    const series = await this.trendSeries(currentStart, days).catch(() => ({
      conversion7Day: 0,
      conversion30Day: 0,
      points: [] as Array<{ date: string; leads: number; applications: number; activated: number }>,
    }));
    const historyLimited = previousPeriodLeads === 0 && currentPeriodLeads > 0;
    const spend = await acquisitionSpendService.totalsForRange(currentStart, now).catch(() => ({
      available: false,
      totalSpend: null as number | null,
    }));
    const cost = this.costMetrics(spend.totalSpend, currentPeriodLeads, currentPeriodApps, currentPeriodActivated, spend.available);

    return {
      range,
      historyLimited,
      historyNote: historyLimited
        ? "Previous-period comparison is limited because there is no data before the current window."
        : null,
      kpis: {
        totalLeads,
        newToday,
        applications,
        verified,
        training,
        activated,
        activePartners,
        conversionRate,
        followUpToday,
        followUpOverdue,
        followUpTomorrow,
        stalled,
        noNextAction,
      },
      kpiDeltas: {
        leads: pctChange(currentPeriodLeads, previousPeriodLeads),
        applications: pctChange(currentPeriodApps, previousPeriodApps),
        activated: pctChange(currentPeriodActivated, previousPeriodActivated),
        previousPeriodDays: days,
      },
      period: {
        leads: currentPeriodLeads,
        applications: currentPeriodApps,
        activated: currentPeriodActivated,
        previousLeads: previousPeriodLeads,
        previousApplications: previousPeriodApps,
        previousActivated: previousPeriodActivated,
      },
      trends: {
        conversion7Day: series.conversion7Day,
        conversion30Day: series.conversion30Day,
        series: series.points,
      },
      cost,
      funnel: funnelCounts,
      sources: sourceBreakdown,
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        leadId: a.leadId,
        leadName: a.lead.name,
        leadStatus: a.lead.status,
        type: a.type,
        title: a.title,
        description: a.description,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  private costMetrics(
    spend: number | null,
    leads: number,
    applications: number,
    activated: number,
    available: boolean,
  ) {
    if (!available || spend == null) {
      return {
        available: false,
        spend: null,
        cpl: null,
        costPerApplication: null,
        costPerActivation: null,
        activationRate: leads > 0 ? Math.round((activated / leads) * 1000) / 10 : 0,
        note: "No acquisition spend has been recorded for this period.",
      };
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      available: true,
      spend,
      cpl: leads > 0 ? round(spend / leads) : null,
      costPerApplication: applications > 0 ? round(spend / applications) : null,
      costPerActivation: activated > 0 ? round(spend / activated) : null,
      activationRate: leads > 0 ? Math.round((activated / leads) * 1000) / 10 : 0,
      note: null,
    };
  }

  private async trendSeries(start: Date, days: number) {
    const leadRows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*)::bigint AS count
      FROM partner_leads
      WHERE created_at >= ${start}
        AND status NOT IN ('DUPLICATE', 'INVALID')
      GROUP BY 1
      ORDER BY 1
    `);
    const appRows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT DATE_TRUNC('day', application_at)::date AS day, COUNT(*)::bigint AS count
      FROM partner_leads
      WHERE application_at >= ${start}
      GROUP BY 1
      ORDER BY 1
    `);
    const activatedRows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT DATE_TRUNC('day', activation_at)::date AS day, COUNT(*)::bigint AS count
      FROM partner_leads
      WHERE activation_at >= ${start}
        AND status = 'ACTIVATED'
      GROUP BY 1
      ORDER BY 1
    `);

    const toCount = (rows: Array<{ day: Date; count: bigint }>) =>
      rows.map((r) => ({ day: r.day, count: Number(r.count) }));

    const leads = fillSeries(start, days, toCount(leadRows));
    const applications = fillSeries(start, days, toCount(appRows));
    const activated = fillSeries(start, days, toCount(activatedRows));
    const leads7 = leads.slice(-7).reduce((s, d) => s + d.count, 0);
    const act7 = activated.slice(-7).reduce((s, d) => s + d.count, 0);
    const leads30 = leads.slice(-30).reduce((s, d) => s + d.count, 0);
    const act30 = activated.slice(-30).reduce((s, d) => s + d.count, 0);

    return {
      conversion7Day: leads7 > 0 ? Math.round((act7 / leads7) * 1000) / 10 : 0,
      conversion30Day: leads30 > 0 ? Math.round((act30 / leads30) * 1000) / 10 : 0,
      points: leads.map((d, i) => ({
        date: d.date,
        leads: d.count,
        applications: applications[i]?.count ?? 0,
        activated: activated[i]?.count ?? 0,
      })),
    };
  }

  async sourcePerformance(opts?: { rangeStart?: Date; rangeEnd?: Date }) {
    const allSources: PartnerLeadSource[] = [
      "APNA",
      "JOBHAI",
      "REFERRAL",
      "RWA",
      "CONTRACTOR",
      "LOCAL_SHOP",
      "DIRECT",
      "SOCIAL",
      "CAMPAIGN",
      "PARTNER_REFERRAL",
    ];

    const createdAt =
      opts?.rangeStart && opts?.rangeEnd
        ? { gte: opts.rangeStart, lte: opts.rangeEnd }
        : undefined;
    const spend =
      opts?.rangeStart && opts?.rangeEnd
        ? await acquisitionSpendService.totalsForRange(opts.rangeStart, opts.rangeEnd).catch(() => ({
            available: false,
            bySource: {} as Record<string, number>,
            totalSpend: null as number | null,
          }))
        : { available: false, bySource: {} as Record<string, number>, totalSpend: null };

    const results = [];
    for (const source of allSources) {
      const [leads, applications, activated, active] = await Promise.all([
        prisma.partnerLead.count({ where: { source, createdAt, mergedIntoLeadId: null } }),
        prisma.partnerLead.count({ where: { source, status: { in: APPLICATION_STATUSES }, createdAt } }),
        prisma.partnerLead.count({ where: { source, status: "ACTIVATED", createdAt } }),
        prisma.partnerLead.count({
          where: {
            source,
            provider: { registrationStatus: "APPROVED", isActive: true },
          },
        }),
      ]);

      const sourceSpend = spend.available ? spend.bySource[source] ?? 0 : null;
      results.push({
        source,
        leads,
        applications,
        kycStarted: await prisma.partnerLead.count({
          where: { source, status: { in: ["KYC_PENDING", ...VERIFIED_STATUSES] }, createdAt },
        }),
        verified: await prisma.partnerLead.count({
          where: { source, status: { in: ["VERIFICATION", "TRAINING", "APPROVED", "ACTIVATED"] }, createdAt },
        }),
        training: await prisma.partnerLead.count({ where: { source, status: "TRAINING", createdAt } }),
        activated,
        active,
        activationRate: leads > 0 ? Math.round((activated / leads) * 1000) / 10 : 0,
        applicationRate: leads > 0 ? Math.round((applications / leads) * 1000) / 10 : 0,
        spend: sourceSpend,
        costPerActivation:
          sourceSpend != null && sourceSpend > 0 && activated > 0
            ? Math.round((sourceSpend / activated) * 100) / 100
            : null,
      });
    }

    return results.sort((a, b) => b.leads - a.leads);
  }

  private async funnelCounts() {
    const stages: { key: PartnerLeadStatus | "NEW"; label: string }[] = [
      { key: "NEW", label: "New Leads" },
      { key: "CONTACTED", label: "Contacted" },
      { key: "INTERESTED", label: "Interested" },
      { key: "APPLICATION_STARTED", label: "Application Started" },
      { key: "APPLICATION_SUBMITTED", label: "Submitted" },
      { key: "KYC_PENDING", label: "KYC Pending" },
      { key: "VERIFICATION", label: "Verification" },
      { key: "TRAINING", label: "Training" },
      { key: "APPROVED", label: "Approved" },
      { key: "ACTIVATED", label: "Activated" },
    ];

    const counts = await Promise.all(
      stages.map(async (s) => ({
        ...s,
        count: await prisma.partnerLead.count({ where: { status: s.key, mergedIntoLeadId: null } }),
      })),
    );

    return counts;
  }
}

export const partnerAcquisitionAnalyticsService = new PartnerAcquisitionAnalyticsService();
