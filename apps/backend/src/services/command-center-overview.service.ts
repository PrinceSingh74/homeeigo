import prisma from "../lib/prisma";
import type { AdminRbacContext } from "./rbac.service";
import { rbacService } from "./rbac.service";
import { listWorkflows } from "../automation/registry/workflow-registry";

export type CommandTile<T> =
  | { status: "ok"; data: T }
  | { status: "unauthorized" }
  | { status: "unavailable"; reason: string };

async function tile<T>(fn: () => Promise<T>): Promise<CommandTile<T>> {
  try {
    return { status: "ok", data: await fn() };
  } catch {
    return { status: "unavailable", reason: "Source query failed" };
  }
}

function unauthorized<T>(): CommandTile<T> {
  return { status: "unauthorized" };
}

/**
 * Section 10 control-plane overview.
 *
 * Composes EXISTING domain tables. Does not invent engines, does not fabricate
 * zeros: a failed query is `unavailable`, a missing permission is `unauthorized`.
 */
export class CommandCenterOverviewService {
  async getOverview(admin: AdminRbacContext) {
    const [canFinance, canTrust, canNetwork] = await Promise.all([
      rbacService.hasPermission(admin, "PAYMENTS", "READ"),
      rbacService.hasPermission(admin, "DISPUTES", "READ"),
      rbacService.hasPermission(admin, "CAMPAIGNS", "READ"),
    ]);

    const activeJobs = ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] as const;
    const openLead = [
      "NEW",
      "CONTACTED",
      "INTERESTED",
      "APPLICATION_STARTED",
      "APPLICATION_SUBMITTED",
      "KYC_PENDING",
      "VERIFICATION",
      "TRAINING",
    ] as const;

    const [
      partners,
      applications,
      availability,
      jobs,
      kyc,
      risk,
      safety,
      referrals,
      payouts,
      earnings,
      automation,
    ] = await Promise.all([
      tile(async () => {
        const [total, active, suspended] = await Promise.all([
          prisma.provider.count(),
          prisma.provider.count({ where: { lifecycleState: { in: ["ACTIVE", "REACTIVATED"] } } }),
          prisma.provider.count({ where: { lifecycleState: "SUSPENDED" } }),
        ]);
        return { total, active, suspended };
      }),
      tile(async () => {
        const [openLeads, pendingProviders] = await Promise.all([
          prisma.partnerLead.count({ where: { status: { in: [...openLead] } } }),
          prisma.provider.count({ where: { isApproved: false } }),
        ]);
        return { openLeads, pendingProviders };
      }),
      tile(async () => {
        const [online, available] = await Promise.all([
          prisma.provider.count({ where: { isOnline: true } }),
          prisma.provider.count({ where: { isOnline: true, currentStatus: { in: ["available", "online"] } } }),
        ]);
        return { online, available };
      }),
      tile(async () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const [active, today] = await Promise.all([
          prisma.booking.count({ where: { status: { in: [...activeJobs] } } }),
          prisma.booking.count({ where: { createdAt: { gte: start } } }),
        ]);
        return { active, today };
      }),
      canTrust
        ? tile(async () => {
            const [pendingDocs, expiring] = await Promise.all([
              prisma.providerDocument.count({ where: { isVerified: false } }),
              prisma.providerDocument.count({
                where: {
                  expiryDate: {
                    gte: new Date(),
                    lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  },
                },
              }),
            ]);
            return { pendingDocs, expiring };
          })
        : Promise.resolve(unauthorized<{ pendingDocs: number; expiring: number }>()),
      canTrust
        ? tile(async () => ({
            review: await prisma.partnerRiskProfile.count({ where: { reviewStatus: "REVIEW" } }),
          }))
        : Promise.resolve(unauthorized<{ review: number }>()),
      canTrust
        ? tile(async () => {
            const [openIncidents, sosOpen] = await Promise.all([
              prisma.partnerSafetyIncident.count({
                where: { status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
              }),
              prisma.partnerSafetyIncident.count({
                where: { type: "SOS", status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
              }),
            ]);
            return { openIncidents, sosOpen };
          })
        : Promise.resolve(unauthorized<{ openIncidents: number; sosOpen: number }>()),
      canNetwork
        ? tile(async () => ({
            pendingQualification: await prisma.partnerReferral.count({
              where: { qualificationStatus: "PENDING" },
            }),
          }))
        : Promise.resolve(unauthorized<{ pendingQualification: number }>()),
      canFinance
        ? tile(async () => ({
            pending: await prisma.withdrawal.count({
              where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
            }),
          }))
        : Promise.resolve(unauthorized<{ pending: number }>()),
      canFinance
        ? tile(async () => {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const agg = await prisma.earning.aggregate({
              where: { createdAt: { gte: start } },
              _sum: { netEarning: true },
              _count: true,
            });
            return {
              todayCount: agg._count,
              todayNet: agg._sum.netEarning ?? 0,
            };
          })
        : Promise.resolve(unauthorized<{ todayCount: number; todayNet: number }>()),
      tile(async () => {
        const workflows = listWorkflows();
        const live = workflows.filter((w) => (w.executionMode ?? "LIVE") === "LIVE").length;
        const shadow = workflows.filter((w) => w.executionMode === "SHADOW").length;
        const [outboxPending, dlq] = await Promise.all([
          prisma.eventOutbox.count({ where: { status: "PENDING" } }),
          prisma.eventDeadLetter.count(),
        ]);
        return { live, shadow, outboxPending, dlq };
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      partners,
      applications,
      availability,
      jobs,
      earnings,
      payouts,
      kyc,
      risk,
      safety,
      referrals,
      automation,
    };
  }
}

export const commandCenterOverviewService = new CommandCenterOverviewService();
