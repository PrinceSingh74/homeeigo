import crypto from "crypto";
import prisma from "../../lib/prisma";
import type { AiToolApprovalStatus } from "@prisma/client";
import type { ApprovalDecisionInput, ApprovalRequestInput } from "../types";
import { aiToolsConfig } from "../config";

export async function createApprovalRequest(input: ApprovalRequestInput) {
  const approvalId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + aiToolsConfig.approvalExpiryHours * 3_600_000);

  return prisma.aiToolApproval.create({
    data: {
      approvalId,
      toolId: input.toolId,
      requestedBy: input.requestedBy,
      requestedRole: input.requestedRole,
      argumentsHash: input.argumentsHash,
      riskScore: input.riskScore,
      approvalMode: input.approvalMode ?? "SINGLE",
      requiredApprovers: input.requiredApprovers ?? 1,
      expiresAt,
      metadata: input.metadata ?? {},
    },
  });
}

export async function decideApproval(input: ApprovalDecisionInput) {
  const approval = await prisma.aiToolApproval.findUnique({
    where: { approvalId: input.approvalId },
  });
  if (!approval) throw new Error("APPROVAL_NOT_FOUND");
  if (approval.status !== "PENDING") throw new Error(`APPROVAL_ALREADY_${approval.status}`);
  if (approval.expiresAt < new Date()) {
    await prisma.aiToolApproval.update({
      where: { id: approval.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("APPROVAL_EXPIRED");
  }
  if (approval.requestedBy === input.approverId) {
    throw new Error("SELF_APPROVAL_DENIED");
  }

  const status: AiToolApprovalStatus = input.decision === "APPROVED" ? "APPROVED" : "REJECTED";
  return prisma.aiToolApproval.update({
    where: { id: approval.id },
    data: {
      status,
      approvedBy: input.decision === "APPROVED" ? input.approverId : undefined,
      rejectedBy: input.decision === "REJECTED" ? input.approverId : undefined,
      decisionReason: input.reason,
      decidedAt: new Date(),
    },
  });
}

export async function listPendingApprovals(query: { toolId?: string; limit?: number } = {}) {
  const where: Record<string, unknown> = { status: "PENDING", expiresAt: { gt: new Date() } };
  if (query.toolId) where.toolId = query.toolId;
  return prisma.aiToolApproval.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: query.limit ?? 50,
    include: { tool: { select: { name: true, riskLevel: true, category: true } } },
  });
}

export async function listHighRiskQueue(limit = 50) {
  return prisma.aiToolApproval.findMany({
    where: {
      status: "PENDING",
      tool: { category: "HIGH_RISK" },
      expiresAt: { gt: new Date() },
    },
    orderBy: [{ riskScore: "desc" }, { createdAt: "asc" }],
    take: limit,
    include: { tool: true },
  });
}

export async function cancelApproval(approvalId: string, cancelledBy: string, reason?: string) {
  const approval = await prisma.aiToolApproval.findUnique({ where: { approvalId } });
  if (!approval || approval.status !== "PENDING") throw new Error("APPROVAL_NOT_CANCELLABLE");
  return prisma.aiToolApproval.update({
    where: { id: approval.id },
    data: {
      status: "CANCELLED",
      decisionReason: reason ?? `Cancelled by ${cancelledBy}`,
      decidedAt: new Date(),
    },
  });
}

export async function expireStaleApprovals(): Promise<number> {
  const result = await prisma.aiToolApproval.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export async function getApprovalById(approvalId: string) {
  return prisma.aiToolApproval.findUnique({
    where: { approvalId },
    include: { tool: true },
  });
}

export async function getApprovalStatistics() {
  const [pending, approved, rejected, expired] = await Promise.all([
    prisma.aiToolApproval.count({ where: { status: "PENDING" } }),
    prisma.aiToolApproval.count({ where: { status: "APPROVED" } }),
    prisma.aiToolApproval.count({ where: { status: "REJECTED" } }),
    prisma.aiToolApproval.count({ where: { status: "EXPIRED" } }),
  ]);
  return { pending, approved, rejected, expired };
}
