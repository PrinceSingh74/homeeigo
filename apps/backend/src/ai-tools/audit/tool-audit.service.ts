import prisma from "../../lib/prisma";
import { hashContent } from "../../ai/security/prompt-security";
import type { AiGatewayRole, AiToolExecutionStatus, AiToolPolicyDecision } from "@prisma/client";
import type { Prisma } from "@prisma/client";

/**
 * A serialisation that depends on the value's meaning, not on key insertion order.
 *
 * This was `JSON.stringify` with a BigInt replacer and nothing else, which made it stable in name
 * only: `{ bookingId, amount }` and `{ amount, bookingId }` are the same tool call and hashed
 * differently. Two authorisation controls are built on that hash — approval binding, which refuses
 * a payload that does not match what a human approved, and the idempotency check, which decides
 * whether a retry is the same request. Both then failed closed for reasons that were not true: a
 * legitimate retry with reordered keys was reported to the caller as `IDEMPOTENCY_KEY_REUSED`,
 * which says the key was used for a *different* request.
 *
 * Object keys are sorted; array order is left alone, because the order of a list is part of what it
 * means. `JSON.stringify` still escapes strings, so a key cannot be confused with a value the way a
 * sort-and-concatenate normaliser would allow.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = normalize(source[key]);
    return sorted;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
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
  /** The ruleset this decision was made under. See POLICY_RULESET_VERSION. */
  policyVersion?: string;
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
  metadata?: Prisma.InputJsonObject;
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
