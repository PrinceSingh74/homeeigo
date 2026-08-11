import crypto from "crypto";
import prisma from "../../lib/prisma";
import type { AiToolApprovalStatus } from "@prisma/client";
import type { ApprovalDecisionInput, ApprovalRequestInput } from "../types";
import { aiToolsConfig } from "../config";
import { redactArguments } from "../security/tool-security";

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
      // Display-only, and redacted on the way in. The approver needs to see the amount and
      // the target; they never need to see a token or a card number.
      argumentsPreview: input.argumentsPreview
        ? (redactArguments(input.argumentsPreview) as never)
        : undefined,
      resourceRef: input.resourceRef,
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

export type ApprovalConsumptionFailure =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_WRONG_TOOL"
  | "APPROVAL_WRONG_ACTOR"
  | "APPROVAL_TAMPER"
  | "APPROVAL_ALREADY_CONSUMED";

export type ApprovalConsumptionResult =
  | { ok: true }
  | { ok: false; failure: ApprovalConsumptionFailure };

/**
 * Spends an approval, once, for exactly the tool, actor and arguments it was granted for.
 *
 * Consumption previously checked only that the row said APPROVED and that the argument
 * hash matched. That left an approval usable by a different actor, for a different tool,
 * after it had expired, and an unlimited number of times. The hash was not a substitute
 * binding either: every high-risk tool takes the same `{ payload }` shape, so identical
 * arguments produce an identical hash across completely different actions.
 *
 * All bindings are re-derived here from the stored row and the authenticated actor —
 * never from anything the caller supplied beyond the approval id itself.
 *
 * The final step is a conditional update on `status: "APPROVED"`. Postgres serialises the
 * matching row, so two concurrent executions racing the same approval produce exactly one
 * winner; the loser's update matches zero rows and is rejected.
 */
export async function consumeApproval(input: {
  approvalId: string;
  toolId: string;
  actorId: string;
  argumentsHash: string;
  executionId: string;
}): Promise<ApprovalConsumptionResult> {
  const approval = await prisma.aiToolApproval.findUnique({
    where: { approvalId: input.approvalId },
  });

  if (!approval) return { ok: false, failure: "APPROVAL_NOT_FOUND" };
  if (approval.status === "CONSUMED") return { ok: false, failure: "APPROVAL_ALREADY_CONSUMED" };
  if (approval.status !== "APPROVED") return { ok: false, failure: "APPROVAL_NOT_APPROVED" };

  // Expiry is checked at the moment of use, not only when the decision was recorded — an
  // approval granted an hour ago must not authorise an execution after it lapsed.
  if (approval.expiresAt < new Date()) {
    await prisma.aiToolApproval
      .updateMany({ where: { id: approval.id, status: "APPROVED" }, data: { status: "EXPIRED" } })
      .catch(() => undefined);
    return { ok: false, failure: "APPROVAL_EXPIRED" };
  }

  if (approval.toolId !== input.toolId) return { ok: false, failure: "APPROVAL_WRONG_TOOL" };
  if (approval.requestedBy !== input.actorId) return { ok: false, failure: "APPROVAL_WRONG_ACTOR" };
  if (approval.argumentsHash !== input.argumentsHash) return { ok: false, failure: "APPROVAL_TAMPER" };

  const claimed = await prisma.aiToolApproval.updateMany({
    where: { id: approval.id, status: "APPROVED" },
    data: {
      status: "CONSUMED",
      consumedAt: new Date(),
      consumedBy: input.actorId,
      consumedExecutionId: input.executionId,
    },
  });

  // Zero rows means another execution won the race between the read above and this write.
  if (claimed.count !== 1) return { ok: false, failure: "APPROVAL_ALREADY_CONSUMED" };
  return { ok: true };
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
