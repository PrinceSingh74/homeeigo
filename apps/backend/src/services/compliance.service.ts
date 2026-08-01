import type {
  ComplianceRequestStatus,
  ComplianceRequestType,
  ConsentPolicyType,
  EnterpriseActorType,
  Prisma,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { ACCOUNT_DELETION_RESTORE_DAYS } from "../lib/legal-policy";
import { enterpriseAuditService } from "./enterprise-audit.service";
import { dataExportService } from "./data-export.service";
import { accountLifecycleService } from "./account-lifecycle.service";
import { consentService } from "./consent.service";
import { storeComplianceExport } from "../lib/compliance-export-storage";

const COMPLIANCE_SLA_DAYS = 30;
const EXPORT_EXPIRY_DAYS = 7;

export type ComplianceContext = {
  ipAddress?: string;
  userAgent?: string;
};

export class ComplianceService {
  private dueDateFromNow(days = COMPLIANCE_SLA_DAYS) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private async auditRequest(
    complianceRequestId: string,
    action: string,
    actorId: string | undefined,
    actorType: EnterpriseActorType,
    ctx: ComplianceContext,
    changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    await prisma.complianceRequestAudit.create({
      data: {
        complianceRequestId,
        actorId,
        actorType,
        action,
        changesBefore: changes?.before as Prisma.InputJsonValue | undefined,
        changesAfter: changes?.after as Prisma.InputJsonValue | undefined,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }

  async createRequest(
    userId: string,
    requestType: ComplianceRequestType,
    ctx: ComplianceContext,
    opts?: { dataScope?: string; targetCategories?: string[]; reason?: string },
  ) {
    const request = await prisma.complianceRequest.create({
      data: {
        requestType,
        userId,
        status: "PENDING",
        dueDateAt: this.dueDateFromNow(),
        dataScope: opts?.dataScope ?? "all",
        targetCategories: opts?.targetCategories ?? [],
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: opts?.reason ? { reason: opts.reason } : undefined,
      },
    });

    await this.auditRequest(request.id, "REQUEST_CREATED", userId, "USER", ctx, {
      after: { requestType, status: request.status },
    });

    void enterpriseAuditService.log({
      action: `${requestType}_REQUESTED`,
      resource: "compliance",
      resourceId: request.id,
      actor: userId,
      actorType: "USER",
      status: "SUCCESS",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      retentionCategory: "SECURITY_EVENTS",
    });

    return request;
  }

  async requestExport(userId: string, ctx: ComplianceContext) {
    const pending = await prisma.complianceRequest.findFirst({
      where: { userId, requestType: "EXPORT", status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
    });
    if (pending) return { error: "EXPORT_IN_PROGRESS" as const, request: pending };

    const request = await this.createRequest(userId, "EXPORT", ctx);
    await prisma.dataExportRequest.create({
      data: {
        complianceRequestId: request.id,
        userId,
        exportStatus: "PENDING",
      },
    });

    return { request };
  }

  async requestDeletion(userId: string, ctx: ComplianceContext, reason?: string) {
    const pending = await prisma.complianceRequest.findFirst({
      where: { userId, requestType: "DELETE", status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
    });
    if (pending) return { error: "DELETION_IN_PROGRESS" as const, request: pending };

    const gracePeriodEndsAt = this.dueDateFromNow(ACCOUNT_DELETION_RESTORE_DAYS);
    const request = await this.createRequest(userId, "DELETE", ctx, { reason });
    await prisma.deletionRequest.create({
      data: {
        complianceRequestId: request.id,
        userId,
        gracePeriodEndsAt,
        deletionStatus: "PENDING",
      },
    });

    return { request, gracePeriodEndsAt };
  }

  async withdrawConsent(
    userId: string,
    policyType: ConsentPolicyType,
    ctx: ComplianceContext,
  ) {
    await consentService.withdrawConsent({
      userId,
      policyType,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    void enterpriseAuditService.log({
      action: "CONSENT_WITHDRAWN",
      resource: "compliance",
      actor: userId,
      actorType: "USER",
      status: "SUCCESS",
      changesSummary: `Withdrew ${policyType} consent`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      retentionCategory: "SECURITY_EVENTS",
    });

    return { withdrawnAt: new Date(), policyType };
  }

  async getRequestForUser(requestId: string, userId: string) {
    return prisma.complianceRequest.findFirst({
      where: { id: requestId, userId },
      include: { dataExport: true, deletion: true },
    });
  }

  async getExportForUser(exportId: string, userId: string) {
    return prisma.dataExportRequest.findFirst({
      where: { id: exportId, userId },
      include: { complianceRequest: true },
    });
  }

  async listUserRequests(userId: string, limit = 20) {
    return prisma.complianceRequest.findMany({
      where: { userId },
      orderBy: { submittedAt: "desc" },
      take: Math.min(limit, 50),
      include: { dataExport: true, deletion: true },
    });
  }

  async approveRequest(requestId: string, adminUserId: string, ctx: ComplianceContext) {
    const request = await prisma.complianceRequest.findUnique({
      where: { id: requestId },
      include: { dataExport: true, deletion: true },
    });
    if (!request || request.status !== "PENDING") {
      return { error: "INVALID_STATE" as const };
    }

    const updated = await prisma.complianceRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        approvedBy: adminUserId,
        approvalAt: new Date(),
      },
    });

    await this.auditRequest(requestId, "REQUEST_APPROVED", adminUserId, "ADMIN", ctx, {
      before: { status: request.status },
      after: { status: "APPROVED" },
    });

    void enterpriseAuditService.log({
      action: "COMPLIANCE_REQUEST_APPROVED",
      resource: "compliance",
      resourceId: requestId,
      actor: adminUserId,
      actorType: "ADMIN",
      status: "SUCCESS",
      changesSummary: `Approved ${request.requestType} for user ${request.userId}`,
      retentionCategory: "SECURITY_EVENTS",
    });

    if (request.requestType === "EXPORT") {
      await this.processExport(requestId, request.userId);
    } else if (request.requestType === "DELETE") {
      await this.processDeletion(requestId, request.userId, adminUserId);
    }

    return { request: updated };
  }

  async rejectRequest(requestId: string, adminUserId: string, reason: string, ctx: ComplianceContext) {
    const request = await prisma.complianceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PENDING") {
      return { error: "INVALID_STATE" as const };
    }

    const updated = await prisma.complianceRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", rejectionReason: reason, completedAt: new Date() },
    });

    await this.auditRequest(requestId, "REQUEST_REJECTED", adminUserId, "ADMIN", ctx, {
      after: { status: "REJECTED", reason },
    });

    return { request: updated };
  }

  async processExport(complianceRequestId: string, userId: string) {
    const exportRow = await prisma.dataExportRequest.findUnique({
      where: { complianceRequestId },
    });
    if (!exportRow) return { error: "NOT_FOUND" as const };

    await prisma.complianceRequest.update({
      where: { id: complianceRequestId },
      data: { status: "PROCESSING" },
    });
    await prisma.dataExportRequest.update({
      where: { id: exportRow.id },
      data: { exportStatus: "GENERATING" },
    });

    const zip = await dataExportService.exportZip(userId);
    if (!zip) {
      await prisma.dataExportRequest.update({
        where: { id: exportRow.id },
        data: { exportStatus: "EXPIRED" },
      });
      return { error: "EXPORT_FAILED" as const };
    }

    const stored = await storeComplianceExport(userId, zip);
    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.dataExportRequest.update({
        where: { id: exportRow.id },
        data: {
          exportStatus: "READY",
          fileUrl: stored.fileUrl,
          fileStorageKey: stored.fileStorageKey,
          fileSize: stored.fileSize,
          fileHash: stored.fileHash,
          exportedAt: new Date(),
          expiresAt,
        },
      }),
      prisma.complianceRequest.update({
        where: { id: complianceRequestId },
        data: { status: "COMPLETED", completedAt: new Date() },
      }),
    ]);

    return { exportId: exportRow.id, fileUrl: stored.fileUrl, expiresAt };
  }

  async processDeletion(complianceRequestId: string, userId: string, actorId: string) {
    const deletion = await prisma.deletionRequest.findUnique({ where: { complianceRequestId } });
    if (!deletion) return { error: "NOT_FOUND" as const };

    await prisma.complianceRequest.update({
      where: { id: complianceRequestId },
      data: { status: "PROCESSING" },
    });
    await prisma.deletionRequest.update({
      where: { id: deletion.id },
      data: { deletionStatus: "PROCESSING", deletionStartedAt: new Date(), deletedBy: actorId },
    });

    const lifecycle = await accountLifecycleService.scheduleDeletion(userId, "compliance_request");

    await prisma.$transaction([
      prisma.deletionRequest.update({
        where: { id: deletion.id },
        data: {
          deletionStatus: "COMPLETED",
          deletionCompletedAt: new Date(),
        },
      }),
      prisma.complianceRequest.update({
        where: { id: complianceRequestId },
        data: { status: "COMPLETED", completedAt: new Date() },
      }),
    ]);

    return lifecycle;
  }

  async markExportDownloaded(exportId: string, userId: string) {
    const row = await prisma.dataExportRequest.findFirst({
      where: { id: exportId, userId, exportStatus: "READY" },
    });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < new Date()) {
      await prisma.dataExportRequest.update({
        where: { id: exportId },
        data: { exportStatus: "EXPIRED" },
      });
      return null;
    }
    return prisma.dataExportRequest.update({
      where: { id: exportId },
      data: { exportStatus: "DOWNLOADED", downloadedAt: new Date() },
    });
  }

  async listPendingForAdmin(limit = 50) {
    return this.listForAdmin({ status: "PENDING", limit });
  }

  async listForAdmin(opts: { status?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    return prisma.complianceRequest.findMany({
      where: opts.status && opts.status !== "ALL" ? { status: opts.status as never } : undefined,
      orderBy: { submittedAt: "desc" },
      take: limit,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }

  slaDaysRemaining(dueDateAt: Date): number {
    return Math.max(0, Math.ceil((dueDateAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  }
}

export const complianceService = new ComplianceService();
