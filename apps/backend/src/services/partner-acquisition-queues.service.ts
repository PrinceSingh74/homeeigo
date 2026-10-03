import type { PartnerLeadStatus, PartnerRegistrationStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { academyTrainingState } from "./partner-academy-requirements";

export type ApplicationPipeline =
  | "started"
  | "submitted"
  | "kyc"
  | "assessment"
  | "training"
  | "ready"
  | "rejected"
  | "changes_requested";

function pipelineFor(input: {
  registrationStatus: PartnerRegistrationStatus;
  leadStatus?: PartnerLeadStatus | null;
  assessmentPassed: boolean;
  trainingComplete: boolean;
  checklistReady: boolean;
}): ApplicationPipeline {
  if (input.registrationStatus === "REJECTED") return "rejected";
  if (input.registrationStatus === "CHANGES_REQUESTED") return "changes_requested";
  if (input.registrationStatus === "APPROVED" || input.checklistReady) return "ready";
  if (input.leadStatus === "TRAINING" || (input.assessmentPassed && !input.trainingComplete)) return "training";
  if (input.leadStatus === "KYC_PENDING") return "kyc";
  if (input.assessmentPassed) return "assessment";
  if (input.registrationStatus === "PENDING" && input.leadStatus === "APPLICATION_SUBMITTED") return "submitted";
  return "started";
}

function verificationStatus(opts: {
  pendingDocs: number;
  verifiedDocs: number;
  rejectedDocs: number;
  kycReady: boolean;
  assessmentPassed: boolean;
  background: string | null;
}): "pending" | "verified" | "needs_attention" | "rejected" {
  if (opts.rejectedDocs > 0 || opts.background === "FAILED") return "rejected";
  if (!opts.kycReady || opts.pendingDocs > 0 || !opts.assessmentPassed || opts.background === "PENDING") {
    return opts.verifiedDocs > 0 ? "needs_attention" : "pending";
  }
  if (opts.background === "CLEARED") return "verified";
  return "needs_attention";
}

export class PartnerAcquisitionQueueService {
  async listApplications(filters: {
    pipeline?: ApplicationPipeline;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 30, 100);
    const skip = (page - 1) * limit;

    const providers = await prisma.provider.findMany({
      where: {
        OR: [
          { registeredAt: { not: null } },
          { registrationStatus: { in: ["PENDING", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] } },
          { partnerLead: { isNot: null } },
        ],
        ...(filters.search
          ? {
              user: {
                OR: [
                  { firstName: { contains: filters.search, mode: "insensitive" } },
                  { lastName: { contains: filters.search, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        partnerLead: { select: { id: true, status: true, source: true, city: true } },
        partnerAssessments: { select: { status: true } },
        academyProgress: { select: { completedAt: true, moduleId: true } },
        documents: { select: { isVerified: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 400,
    });

    const publishedModules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true },
      select: { id: true, categoryIds: true },
    });

    const mapped = providers.map((p) => {
      const assessmentPassed = p.partnerAssessments.some((a) => a.status === "PASSED");
      const training = academyTrainingState(publishedModules, p.serviceCategories, p.academyProgress);
      const pipeline = pipelineFor({
        registrationStatus: p.registrationStatus,
        leadStatus: p.partnerLead?.status,
        assessmentPassed,
        trainingComplete: training.trainingComplete,
        checklistReady: p.registrationStatus === "APPROVED",
      });
      return {
        providerId: p.id,
        leadId: p.partnerLead?.id ?? null,
        name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        city: p.city,
        skill: p.primarySkill,
        source: p.partnerLead?.source ?? null,
        registrationStatus: p.registrationStatus,
        leadStatus: p.partnerLead?.status ?? null,
        pipeline,
        submittedAt: p.registeredAt?.toISOString() ?? null,
        changesRequestedStep: p.changesRequestedStep,
      };
    });

    const filtered = filters.pipeline ? mapped.filter((row) => row.pipeline === filters.pipeline) : mapped;
    return {
      items: filtered.slice(skip, skip + limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  async listVerification(filters: {
    status?: "pending" | "verified" | "needs_attention" | "rejected";
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 30, 100);
    const skip = (page - 1) * limit;

    const providers = await prisma.provider.findMany({
      where: {
        OR: [{ registeredAt: { not: null } }, { registrationStatus: { in: ["PENDING", "CHANGES_REQUESTED"] } }],
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        documents: { select: { isVerified: true, verificationNotes: true } },
        partnerAssessments: { select: { status: true } },
        partnerBackgroundCheck: { select: { status: true } },
        partnerLead: { select: { id: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 400,
    });

    const mapped = providers.map((p) => {
      const pendingDocs = p.documents.filter((d) => !d.isVerified).length;
      const verifiedDocs = p.documents.filter((d) => d.isVerified).length;
      const rejectedDocs = p.documents.filter((d) => d.verificationNotes?.toLowerCase().includes("reject")).length;
      const kycReady = Boolean(p.panNumberHash && p.bankAccountNumberHash);
      const assessmentPassed = p.partnerAssessments.some((a) => a.status === "PASSED");
      const status = verificationStatus({
        pendingDocs,
        verifiedDocs,
        rejectedDocs,
        kycReady,
        assessmentPassed,
        background: p.backgroundCheckStatus,
      });
      return {
        providerId: p.id,
        leadId: p.partnerLead?.id ?? null,
        name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        city: p.city,
        status,
        kyc: kycReady ? "ready" : "pending",
        documents: pendingDocs === 0 && verifiedDocs > 0 ? "verified" : pendingDocs > 0 ? "pending" : "none",
        background: p.backgroundCheckStatus,
        assessment: assessmentPassed ? "passed" : "pending",
      };
    });

    const filtered = filters.status ? mapped.filter((row) => row.status === filters.status) : mapped;
    return { items: filtered.slice(skip, skip + limit), total: filtered.length, page, limit };
  }

  async listApprovals(filters: {
    status?: "ready" | "pending" | "approved" | "rejected" | "changes_requested";
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 30, 100);
    const skip = (page - 1) * limit;

    const providers = await prisma.provider.findMany({
      where: {
        registrationStatus: { in: ["PENDING", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] },
        registeredAt: { not: null },
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        partnerLead: { select: { id: true, status: true } },
        partnerAssessments: { select: { status: true } },
        academyProgress: { select: { completedAt: true, moduleId: true } },
        documents: { select: { isVerified: true } },
      },
      orderBy: { registeredAt: "desc" },
      take: 400,
    });

    const publishedModules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true },
      select: { id: true, categoryIds: true },
    });

    const mapped = providers.map((p) => {
      const assessmentPassed = p.partnerAssessments.some((a) => a.status === "PASSED");
      const training = academyTrainingState(publishedModules, p.serviceCategories, p.academyProgress);
      const docsVerified = p.documents.length > 0 && p.documents.every((d) => d.isVerified);
      const ready =
        p.registrationStatus === "PENDING" &&
        assessmentPassed &&
        docsVerified &&
        p.backgroundCheckStatus === "CLEARED";
      const status =
        p.registrationStatus === "APPROVED"
          ? "approved"
          : p.registrationStatus === "REJECTED"
            ? "rejected"
            : p.registrationStatus === "CHANGES_REQUESTED"
              ? "changes_requested"
              : ready
                ? "ready"
                : "pending";
      return {
        providerId: p.id,
        leadId: p.partnerLead?.id ?? null,
        name: `${p.user.firstName} ${p.user.lastName}`.trim(),
        city: p.city,
        skill: p.primarySkill,
        registrationStatus: p.registrationStatus,
        status,
        assessmentPassed,
        trainingComplete: training.trainingComplete,
        submittedAt: p.registeredAt?.toISOString() ?? null,
        rejectionReason: p.rejectionReason,
        changesRequestedStep: p.changesRequestedStep,
      };
    });

    const filtered = filters.status ? mapped.filter((row) => row.status === filters.status) : mapped;
    return { items: filtered.slice(skip, skip + limit), total: filtered.length, page, limit };
  }
}

export const partnerAcquisitionQueueService = new PartnerAcquisitionQueueService();
