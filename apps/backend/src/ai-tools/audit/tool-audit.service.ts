import prisma from "../../lib/prisma";
import { hashContent } from "../../ai/security/prompt-security";
import type { AiGatewayRole, AiToolExecutionStatus, AiToolPolicyDecision } from "@prisma/client";

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function hashArguments(args: Record<string, unknown>): string {
  return hashContent(stableStringify(args));
}

export function hashResult(result: unknown): string {
  return hashContent(stableStringify(result));
}

export async function recordToolPolicyDecision(input: {
  toolId: string;
  actorId?: string;
  actorRole: AiGatewayRole;
  decision: AiToolPolicyDecision;
  reason?: string;
  ruleMatched?: string;
  traceId?: string;
}): Promise<void> {
  try {
    await prisma.aiToolPolicyLog.create({ data: input });
  } catch {
    /* table may not exist during bootstrap */
  }
}

export async function recordToolExecution(input: {
  executionId: string;
  toolId: string;
  actorId?: string;
  actorRole: AiGatewayRole;
  argumentsHash: string;
  policyDecision: AiToolPolicyDecision;
  status: AiToolExecutionStatus;
  resultHash?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  retryCount?: number;
  correlationId?: string;
  traceId?: string;
  idempotencyKey?: string;
  approvalId?: string;
  ipAddress?: string;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.aiToolExecution.create({
    data: {
      ...input,
      completedAt: ["SUCCESS", "FAILED", "DENIED", "TIMEOUT", "CANCELLED"].includes(input.status)
        ? new Date()
        : undefined,
    },
  });
}

export async function updateToolExecution(
  executionId: string,
  patch: {
    status?: AiToolExecutionStatus;
    resultHash?: string;
    errorCode?: string;
    errorMessage?: string;
    durationMs?: number;
    retryCount?: number;
    costUsd?: number;
    approvalId?: string;
  },
): Promise<void> {
  await prisma.aiToolExecution.update({
    where: { executionId },
    data: {
      ...patch,
      completedAt: patch.status ? new Date() : undefined,
    },
  });
}

export async function getExecutionHistory(query: {
  toolId?: string;
  actorId?: string;
  status?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (query.toolId) where.toolId = query.toolId;
  if (query.actorId) where.actorId = query.actorId;
  if (query.status) where.status = query.status;
  return prisma.aiToolExecution.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: query.limit ?? 50,
    include: { tool: { select: { name: true, category: true, riskLevel: true } } },
  });
}

export async function getDeniedExecutions(limit = 50) {
  return prisma.aiToolExecution.findMany({
    where: { status: "DENIED" },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { tool: { select: { name: true, toolId: true } } },
  });
}
