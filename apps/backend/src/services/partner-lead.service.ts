import type { PartnerLeadActivityType, PartnerLeadSource, PartnerLeadStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { userPiiService } from "./user-pii.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { assertLeadTransition, leadStatusForOnboardingStep } from "./partner-lead-state-machine";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import {
  assertLeadInviteUsable,
  issuePartnerLeadInvite,
  partnerWebOrigin,
} from "./partner-application-invite";

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `******${digits.slice(-4)}`;
}

export type DuplicateMatch = {
  type: "lead" | "provider" | "user";
  id: string;
  name: string;
  phoneMasked: string;
  status: string;
  skill?: string | null;
  city?: string | null;
  source?: string | null;
  lastActivityAt: string | null;
};

export class PartnerLeadService {
  async checkDuplicates(input: { phone?: string; email?: string }): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];

    if (input.phone) {
      const phoneHash = userPiiService.hashPhone(input.phone);
      const [leads, users] = await Promise.all([
        prisma.partnerLead.findMany({
          where: { phoneHash, status: { notIn: ["DUPLICATE", "INVALID"] } },
          take: 5,
        }),
        prisma.user.findMany({
          where: { phoneHash },
          include: { provider: true },
          take: 5,
        }),
      ]);

      for (const lead of leads) {
        matches.push({
          type: "lead",
          id: lead.id,
          name: lead.name,
          phoneMasked: maskPhone(lead.phone),
          status: lead.status,
          skill: lead.skillInterest,
          city: lead.city,
          source: lead.source,
          lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
        });
      }

      for (const user of users) {
        if (user.provider) {
          matches.push({
            type: "provider",
            id: user.provider.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
            phoneMasked: maskPhone(input.phone),
            status: user.provider.registrationStatus,
            lastActivityAt: user.lastActivityAt?.toISOString() ?? null,
          });
        } else {
          matches.push({
            type: "user",
            id: user.id,
            name: `${user.firstName} ${user.lastName}`.trim(),
            phoneMasked: maskPhone(input.phone),
            status: user.role,
            lastActivityAt: user.lastActivityAt?.toISOString() ?? null,
          });
        }
      }
    }

    if (input.email) {
      const email = input.email.toLowerCase();
      const emailHash = userPiiService.hashEmail(email);
      const leads = await prisma.partnerLead.findMany({
        where: { emailHash, status: { notIn: ["DUPLICATE", "INVALID"] } },
        take: 5,
      });
      for (const lead of leads) {
        if (!matches.some((m) => m.type === "lead" && m.id === lead.id)) {
          matches.push({
            type: "lead",
            id: lead.id,
            name: lead.name,
            phoneMasked: maskPhone(lead.phone),
            status: lead.status,
            skill: lead.skillInterest,
            city: lead.city,
            source: lead.source,
            lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
          });
        }
      }
    }

    return matches;
  }

  async createLead(
    input: {
      name: string;
      phone: string;
      email?: string;
      source: PartnerLeadSource;
      sourceCampaign?: string;
      channel?: string;
      skillInterest?: string;
      city?: string;
      zone?: string;
      notes?: string;
      assignedToAdminId?: string;
      consentStatus?: string;
      preferredContactMethod?: string;
      metadata?: Record<string, unknown>;
      forceCreate?: boolean;
      duplicateJustification?: string;
    },
    actorId?: string,
  ) {
    const phone = input.phone.trim();
    const phoneHash = userPiiService.hashPhone(phone);
    const email = input.email?.toLowerCase().trim();
    const emailHash = email ? userPiiService.hashEmail(email) : undefined;

    const duplicates = await this.checkDuplicates({ phone, email });
    if (duplicates.length > 0 && !input.forceCreate) {
      throw new Error(`DUPLICATE:Possible existing record found (${duplicates.length})`);
    }

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.partnerLead.create({
        data: {
          name: sanitizeUserInput(input.name, 120),
          phone,
          phoneHash,
          email,
          emailHash,
          source: input.source,
          sourceCampaign: input.sourceCampaign ? sanitizeUserInput(input.sourceCampaign, 120) : undefined,
          channel: input.channel ? sanitizeUserInput(input.channel, 80) : undefined,
          skillInterest: input.skillInterest ? sanitizeUserInput(input.skillInterest, 80) : undefined,
          city: input.city ? sanitizeUserInput(input.city, 80) : undefined,
          zone: input.zone ? sanitizeUserInput(input.zone, 80) : undefined,
          notes: input.notes ? sanitizeUserInput(input.notes, 2000) : undefined,
          assignedToAdminId: input.assignedToAdminId,
          consentStatus: input.consentStatus,
          preferredContactMethod: input.preferredContactMethod,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          lastActivityAt: new Date(),
          leadScore: this.computeLeadScore(input),
        },
      });

      await tx.partnerLeadStatusHistory.create({
        data: {
          leadId: created.id,
          fromStatus: null,
          toStatus: "NEW",
          actorId,
          actorType: actorId ? "admin" : "system",
          reason: input.duplicateJustification,
        },
      });

      await tx.partnerLeadActivity.create({
        data: {
          leadId: created.id,
          type: "SYSTEM",
          title: "Lead created",
          description: `Source: ${input.source}`,
          actorId,
          actorType: actorId ? "admin" : "system",
        },
      });

      if (duplicates.length > 0 && input.forceCreate) {
        await tx.partnerLeadActivity.create({
          data: {
            leadId: created.id,
            type: "DUPLICATE_CHECK",
            title: "Created despite duplicate match",
            description: input.duplicateJustification ?? "No justification provided",
            actorId,
            metadata: { duplicates } as Prisma.InputJsonValue,
          },
        });
      }

      return created;
    });

    await partnerAcquisitionEvents.emitLeadCreated(lead.id, {
      source: lead.source,
      status: lead.status,
      assignedToAdminId: lead.assignedToAdminId,
    });

    if (duplicates.length > 0) {
      await partnerAcquisitionEvents.emitDuplicateDetected(lead.id, duplicates.length, actorId);
    }

    return lead;
  }

  async transitionStatus(
    leadId: string,
    toStatus: PartnerLeadStatus,
    actorId: string,
    opts?: { reason?: string; metadata?: Record<string, unknown> },
  ) {
    const lead = await prisma.partnerLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("NOT_FOUND:Lead not found");

    assertLeadTransition(lead.status, toStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerLead.update({
        where: { id: leadId },
        data: {
          status: toStatus,
          lastActivityAt: new Date(),
          firstContactAt: toStatus === "CONTACTED" && !lead.firstContactAt ? new Date() : lead.firstContactAt,
          applicationAt:
            (toStatus === "APPLICATION_STARTED" || toStatus === "APPLICATION_SUBMITTED") && !lead.applicationAt
              ? new Date()
              : lead.applicationAt,
          activationAt: toStatus === "ACTIVATED" ? new Date() : lead.activationAt,
        },
      });

      await tx.partnerLeadStatusHistory.create({
        data: {
          leadId,
          fromStatus: lead.status,
          toStatus,
          actorId,
          actorType: "admin",
          reason: opts?.reason ? sanitizeUserInput(opts.reason, 500) : undefined,
          metadata: opts?.metadata as Prisma.InputJsonValue,
        },
      });

      await tx.partnerLeadActivity.create({
        data: {
          leadId,
          type: "STATUS_CHANGE",
          title: `Status → ${toStatus}`,
          description: opts?.reason,
          actorId,
          actorType: "admin",
        },
      });

      return row;
    });

    await partnerAcquisitionEvents.emitLeadStatusChanged(leadId, lead.status, toStatus, actorId);
    return updated;
  }

  async assignLead(leadId: string, assignedToAdminId: string, actorId: string) {
    const lead = await prisma.partnerLead.update({
      where: { id: leadId },
      data: { assignedToAdminId, lastActivityAt: new Date() },
    });

    await prisma.partnerLeadActivity.create({
      data: {
        leadId,
        type: "ASSIGNMENT",
        title: "Lead assigned",
        description: `Assigned to ${assignedToAdminId}`,
        actorId,
        actorType: "admin",
      },
    });

    return lead;
  }

  async logActivity(
    leadId: string,
    input: {
      type: PartnerLeadActivityType;
      title: string;
      description?: string;
      actorId?: string;
      actorType?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const activity = await prisma.partnerLeadActivity.create({
      data: {
        leadId,
        type: input.type,
        title: sanitizeUserInput(input.title, 200),
        description: input.description ? sanitizeUserInput(input.description, 2000) : undefined,
        actorId: input.actorId,
        actorType: input.actorType ?? "admin",
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });

    await prisma.partnerLead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    });

    return activity;
  }

  async startApplication(leadId: string, actorId: string) {
    const lead = await prisma.partnerLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("NOT_FOUND:Lead not found");
    if (lead.mergedIntoLeadId || lead.status === "DUPLICATE") {
      throw new Error("CONFLICT:This lead was merged or marked duplicate and cannot start another application");
    }
    if (lead.providerId) {
      throw new Error("CONFLICT:This lead already has an application in progress");
    }
    if (["REJECTED", "DUPLICATE", "INVALID", "WITHDRAWN", "ACTIVATED"].includes(lead.status)) {
      throw new Error(`INVALID_TRANSITION:Cannot start application from ${lead.status}`);
    }

    const preApplication = ["NEW", "CONTACTED", "INTERESTED", "DORMANT"];
    if (preApplication.includes(lead.status)) {
      await this.transitionStatus(leadId, "APPLICATION_STARTED", actorId, {
        reason: "HQ started partner application",
        metadata: { source: "crm_start_application" },
      });
    }

    const inviteToken = issuePartnerLeadInvite(leadId);
    const applicationUrl = `${partnerWebOrigin()}/register?invite=${encodeURIComponent(inviteToken)}`;
    const firstName = lead.name.trim().split(/\s+/)[0] ?? lead.name;
    const smsBody = `Hi ${firstName}, HOMEEIGO invited you to complete your partner application. Continue here: ${applicationUrl}`;

    await this.logActivity(leadId, {
      type: "SYSTEM",
      title: "Application invite sent",
      description: "Applicant can continue from Partner Web or Mobile using the invite link.",
      actorId,
      metadata: { inviteIssuedAt: new Date().toISOString(), inviteExpiresInDays: 14 },
    });

    const updated = await prisma.partnerLead.update({
      where: { id: leadId },
      data: {
        applicationAt: lead.applicationAt ?? new Date(),
        lastActivityAt: new Date(),
        metadata: {
          ...((lead.metadata as Record<string, unknown> | null) ?? {}),
          inviteIssuedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      lead: updated,
      applicationUrl,
      smsBody,
      inviteExpiresInDays: 14,
    };
  }

  async previewInvite(leadId: string) {
    const lead = await prisma.partnerLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("NOT_FOUND:Lead not found");
    assertLeadInviteUsable(lead);
    const parts = lead.name.trim().split(/\s+/);
    return {
      leadId: lead.id,
      name: lead.name,
      firstName: parts[0] ?? lead.name,
      lastName: parts.slice(1).join(" ") || undefined,
      skillInterest: lead.skillInterest,
      city: lead.city,
      phoneLast4: lead.phone.replace(/\D/g, "").slice(-4),
    };
  }

  async linkApplication(leadId: string, userId: string, providerId: string) {
    const lead = await prisma.partnerLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("NOT_FOUND:Lead not found");
    if (lead.userId && lead.userId !== userId) {
      throw new Error("CONFLICT:This lead is already linked to another applicant");
    }
    if (lead.providerId && lead.providerId !== providerId) {
      throw new Error("CONFLICT:This lead already has an application in progress");
    }

    const preOrStarted = ["NEW", "CONTACTED", "INTERESTED", "DORMANT", "APPLICATION_STARTED"];
    return prisma.partnerLead.update({
      where: { id: leadId },
      data: {
        userId,
        providerId,
        applicationAt: lead.applicationAt ?? new Date(),
        lastActivityAt: new Date(),
        ...(preOrStarted.includes(lead.status) ? { status: "APPLICATION_STARTED" as const } : {}),
      },
    });
  }

  async listLeads(filters: {
    status?: PartnerLeadStatus;
    source?: PartnerLeadSource;
    assignedToAdminId?: string;
    city?: string;
    zone?: string;
    skillInterest?: string;
    campaign?: string;
    minScore?: number;
    maxScore?: number;
    createdFrom?: string;
    createdTo?: string;
    lastActivityFrom?: string;
    lastActivityTo?: string;
    followUp?: "today" | "overdue" | "upcoming" | "tomorrow" | "none";
    stalled?: boolean;
    noNextAction?: boolean;
    includeMerged?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(startOfDay.getTime() + 86400_000);
    const tomorrowEnd = new Date(startOfDay.getTime() + 2 * 86400_000 - 1);
    const stalledBefore = new Date(now.getTime() - 7 * 86400_000);

    const where: Prisma.PartnerLeadWhereInput = {};
    if (!filters.includeMerged && filters.status !== "DUPLICATE") {
      where.mergedIntoLeadId = null;
    }
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    if (filters.assignedToAdminId) where.assignedToAdminId = filters.assignedToAdminId;
    if (filters.city) where.city = { contains: filters.city, mode: "insensitive" };
    if (filters.zone) where.zone = { contains: filters.zone, mode: "insensitive" };
    if (filters.skillInterest) where.skillInterest = { contains: filters.skillInterest, mode: "insensitive" };
    if (filters.campaign) where.sourceCampaign = { contains: filters.campaign, mode: "insensitive" };
    if (filters.minScore != null || filters.maxScore != null) {
      where.leadScore = { gte: filters.minScore, lte: filters.maxScore };
    }
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {
        gte: filters.createdFrom ? new Date(filters.createdFrom) : undefined,
        lte: filters.createdTo ? new Date(filters.createdTo) : undefined,
      };
    }
    if (filters.lastActivityFrom || filters.lastActivityTo) {
      where.lastActivityAt = {
        gte: filters.lastActivityFrom ? new Date(filters.lastActivityFrom) : undefined,
        lte: filters.lastActivityTo ? new Date(filters.lastActivityTo) : undefined,
      };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { phone: { contains: filters.search.replace(/\D/g, "") } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.followUp === "today") {
      where.nextFollowUpAt = { gte: startOfDay, lte: endOfDay };
    } else if (filters.followUp === "overdue") {
      where.nextFollowUpAt = { lt: startOfDay };
    } else if (filters.followUp === "upcoming") {
      where.nextFollowUpAt = { gt: endOfDay };
    } else if (filters.followUp === "tomorrow") {
      where.nextFollowUpAt = { gte: tomorrowStart, lte: tomorrowEnd };
    } else if (filters.followUp === "none") {
      where.nextFollowUpAt = null;
    }
    if (filters.stalled) {
      where.status = {
        in: ["APPLICATION_STARTED", "APPLICATION_SUBMITTED", "KYC_PENDING", "VERIFICATION", "TRAINING"],
      };
      where.lastActivityAt = { lt: stalledBefore };
    }
    if (filters.noNextAction) {
      where.nextFollowUpAt = null;
      where.status = {
        in: [
          "NEW",
          "CONTACTED",
          "INTERESTED",
          "APPLICATION_STARTED",
          "APPLICATION_SUBMITTED",
          "KYC_PENDING",
          "VERIFICATION",
          "TRAINING",
          "APPROVED",
        ],
      };
    }

    const [leads, total] = await Promise.all([
      prisma.partnerLead.findMany({
        where,
        orderBy: [{ nextFollowUpAt: "asc" }, { lastActivityAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.partnerLead.count({ where }),
    ]);

    return { leads, total, page, limit };
  }

  async getLeadDetail(leadId: string) {
    const lead = await prisma.partnerLead.findUnique({
      where: { id: leadId },
      include: {
        activities: { orderBy: { createdAt: "desc" }, take: 50 },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 30 },
        provider: { select: { id: true, registrationStatus: true, city: true, serviceCategories: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });
    if (!lead) throw new Error("NOT_FOUND:Lead not found");
    const duplicateCandidates = await this.checkDuplicates({
      phone: lead.phone,
      email: lead.email ?? undefined,
    }).then((rows) => rows.filter((m) => !(m.type === "lead" && m.id === leadId)));
    return { ...lead, duplicateCandidates };
  }

  async updateNotes(leadId: string, notes: string, actorId: string) {
    const lead = await prisma.partnerLead.update({
      where: { id: leadId },
      data: {
        notes: sanitizeUserInput(notes, 2000),
        lastActivityAt: new Date(),
      },
    });

    await this.logActivity(leadId, {
      type: "NOTE",
      title: "Notes updated",
      actorId,
    });

    return lead;
  }

  async setFollowUp(
    leadId: string,
    input: { nextFollowUpAt: Date; followUpReason?: string },
    actorId: string,
  ) {
    const lead = await prisma.partnerLead.update({
      where: { id: leadId },
      data: {
        nextFollowUpAt: input.nextFollowUpAt,
        followUpReason: input.followUpReason ? sanitizeUserInput(input.followUpReason, 500) : undefined,
        lastActivityAt: new Date(),
      },
    });

    await this.logActivity(leadId, {
      type: "FOLLOW_UP",
      title: "Follow-up scheduled",
      description: input.followUpReason,
      actorId,
    });

    return lead;
  }

  private computeLeadScore(input: {
    source: PartnerLeadSource;
    skillInterest?: string;
    city?: string;
    email?: string;
  }): number {
    let score = 40;
    if (input.skillInterest) score += 15;
    if (input.city) score += 10;
    if (input.email) score += 10;
    if (input.source === "REFERRAL" || input.source === "PARTNER_REFERRAL") score += 20;
    if (input.source === "RWA") score += 10;
    return Math.min(score, 100);
  }

  async syncFromProviderDecision(
    leadId: string,
    action: "approve" | "reject" | "request_changes",
    actorId: string,
    reason?: string,
    metadata?: { targetStep?: string },
  ) {
    const lead = await prisma.partnerLead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    let toStatus: PartnerLeadStatus = action === "approve" ? "ACTIVATED" : "REJECTED";
    if (action === "request_changes" && metadata?.targetStep) {
      toStatus = leadStatusForOnboardingStep(metadata.targetStep);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerLead.update({
        where: { id: leadId },
        data: {
          status: toStatus,
          lastActivityAt: new Date(),
          activationAt: action === "approve" ? new Date() : lead.activationAt,
        },
      });

      const title =
        action === "approve"
          ? "Partner activated"
          : action === "reject"
            ? "Application rejected"
            : "Changes requested";

      await tx.partnerLeadStatusHistory.create({
        data: {
          leadId,
          fromStatus: lead.status,
          toStatus,
          actorId,
          actorType: "admin",
          reason: reason ? sanitizeUserInput(reason, 500) : `Provider ${action}`,
          metadata: { sync: "provider_approval", targetStep: metadata?.targetStep ?? null },
        },
      });

      await tx.partnerLeadActivity.create({
        data: {
          leadId,
          type: "SYSTEM",
          title,
          description: reason,
          actorId,
          actorType: "admin",
        },
      });

      return row;
    });

    await partnerAcquisitionEvents.emitLeadStatusChanged(leadId, lead.status, toStatus, actorId);
    return updated;
  }
}

export const partnerLeadService = new PartnerLeadService();
