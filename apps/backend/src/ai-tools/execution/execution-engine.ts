import crypto from "crypto";
import prisma from "../../lib/prisma";
import { consumeRateLimitSmart } from "../../middleware/rate-limit.middleware";
import { aiToolsConfig } from "../config";
import type { ToolExecuteInput, ToolExecuteResult } from "../types";
import { getTool } from "../registry/tool-registry";
import { evaluatePolicy } from "../policy/policy-engine";
import { createApprovalRequest, getApprovalById } from "../approval/approval-engine";
import {
  hashArguments,
  hashResult,
  recordToolExecution,
  updateToolExecution,
} from "../audit/tool-audit.service";
import { validateToolArguments } from "../security/tool-security";
import {
  recordToolRequest,
  recordToolSuccess,
  recordToolFailure,
  recordToolDenied,
  recordToolRequiresApproval,
  recordToolLatency,
  recordToolCost,
  recordToolTimeout,
  recordToolRetry,
} from "../../lib/ai-tools-metrics";
import { recordTimelineEntry } from "../../ai-brain/timeline/activity-timeline";
import { aiBrainConfig } from "../../ai-brain/config";

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

const circuitBreakers = new Map<string, { failures: number; openUntil: number }>();

function checkCircuit(toolId: string): boolean {
  const cb = circuitBreakers.get(toolId);
  if (!cb) return true;
  if (cb.openUntil > Date.now()) return false;
  if (cb.openUntil > 0 && cb.openUntil <= Date.now()) {
    circuitBreakers.set(toolId, { failures: 0, openUntil: 0 });
  }
  return true;
}

function recordCircuitFailure(toolId: string): void {
  const cb = circuitBreakers.get(toolId) ?? { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= aiToolsConfig.circuitBreakerThreshold) {
    cb.openUntil = Date.now() + aiToolsConfig.circuitBreakerResetMs;
  }
  circuitBreakers.set(toolId, cb);
}

function recordCircuitSuccess(toolId: string): void {
  circuitBreakers.set(toolId, { failures: 0, openUntil: 0 });
}

async function checkToolRateLimit(actorId: string, toolId: string): Promise<boolean> {
  if (aiToolsConfig.certificationMode) return true;
  const key = `ai:tool:rate:${actorId}:${toolId}`;
  const limit = aiToolsConfig.rateLimitPerMinute;
  const result = await consumeRateLimitSmart(key, limit, 60_000);
  return result.allowed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new ToolExecutionError("Tool execution timeout", "TIMEOUT")), timeoutMs),
    ),
  ]);
}

export async function executeTool(input: ToolExecuteInput): Promise<ToolExecuteResult> {
  if (!aiToolsConfig.enabled) {
    throw new ToolExecutionError("AI Tools layer disabled", "TOOLS_DISABLED");
  }

  const executionId = crypto.randomUUID();
  const t0 = Date.now();
  const tool = getTool(input.toolId);

  if (!tool) {
    throw new ToolExecutionError(`Unknown tool: ${input.toolId}`, "TOOL_NOT_FOUND");
  }
  if (tool.status !== "ACTIVE") {
    throw new ToolExecutionError(`Tool ${input.toolId} is ${tool.status}`, "TOOL_DISABLED");
  }

  recordToolRequest(input.actor.actorRole, tool.category, tool.toolId);

  // Idempotency check
  if (input.idempotencyKey) {
    const existing = await prisma.aiToolExecution.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing && existing.status === "SUCCESS") {
      return {
        executionId: existing.executionId,
        status: "SUCCESS",
        policyDecision: existing.policyDecision,
        durationMs: existing.durationMs ?? 0,
        result: { idempotent: true, resultHash: existing.resultHash },
      };
    }
  }

  const argValidation = validateToolArguments(tool, input.arguments);
  if (!argValidation.valid) {
    recordToolDenied(tool.toolId, "validation");
    await recordToolExecution({
      executionId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      policyDecision: "DENY",
      status: "DENIED",
      errorCode: "VALIDATION_ERROR",
      errorMessage: argValidation.errors.join("; "),
      durationMs: Date.now() - t0,
      traceId: input.actor.traceId,
      correlationId: input.actor.correlationId,
      idempotencyKey: input.idempotencyKey,
      ipAddress: input.actor.ipAddress,
    });
    throw new ToolExecutionError(argValidation.errors.join("; "), "VALIDATION_ERROR");
  }

  if (!(await checkToolRateLimit(input.actor.actorId, tool.toolId))) {
    recordToolDenied(tool.toolId, "rate_limit");
    throw new ToolExecutionError("Tool rate limit exceeded", "RATE_LIMITED");
  }

  if (!checkCircuit(tool.toolId)) {
    recordToolDenied(tool.toolId, "circuit_open");
    throw new ToolExecutionError("Tool circuit breaker open", "CIRCUIT_OPEN");
  }

  const policy = await evaluatePolicy({ tool, actor: input.actor, arguments: input.arguments });

  if (policy.decision === "DENY") {
    recordToolDenied(tool.toolId, policy.ruleMatched ?? "policy");
    await recordToolExecution({
      executionId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      policyDecision: "DENY",
      status: "DENIED",
      errorCode: "POLICY_DENIED",
      errorMessage: policy.reason,
      durationMs: Date.now() - t0,
      traceId: input.actor.traceId,
      correlationId: input.actor.correlationId,
      idempotencyKey: input.idempotencyKey,
      ipAddress: input.actor.ipAddress,
      metadata: { ruleMatched: policy.ruleMatched },
    });
    return {
      executionId,
      status: "DENIED",
      policyDecision: "DENY",
      errorCode: "POLICY_DENIED",
      errorMessage: policy.reason,
      durationMs: Date.now() - t0,
    };
  }

  if (policy.decision === "REQUIRES_APPROVAL" && !input.approvalId) {
    recordToolRequiresApproval(tool.toolId);
    const approval = await createApprovalRequest({
      toolId: tool.toolId,
      requestedBy: input.actor.actorId,
      requestedRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      riskScore: policy.riskScore ?? 0.8,
      metadata: { executionId, correlationId: input.actor.correlationId },
    });
    await recordToolExecution({
      executionId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      policyDecision: "REQUIRES_APPROVAL",
      status: "PENDING_APPROVAL",
      durationMs: Date.now() - t0,
      traceId: input.actor.traceId,
      correlationId: input.actor.correlationId,
      approvalId: approval.id,
      idempotencyKey: input.idempotencyKey,
      ipAddress: input.actor.ipAddress,
    });
    return {
      executionId,
      status: "PENDING_APPROVAL",
      policyDecision: "REQUIRES_APPROVAL",
      durationMs: Date.now() - t0,
      approvalId: approval.approvalId,
      requiresApproval: true,
    };
  }

  if (input.approvalId) {
    const approval = await getApprovalById(input.approvalId);
    if (!approval || approval.status !== "APPROVED") {
      throw new ToolExecutionError("Valid approval required for this tool", "APPROVAL_REQUIRED");
    }
    if (approval.argumentsHash !== hashArguments(input.arguments)) {
      throw new ToolExecutionError("Arguments mismatch with approved request", "APPROVAL_TAMPER");
    }
  }

  if (!tool.handler) {
    throw new ToolExecutionError("Tool has no execution handler", "NO_HANDLER");
  }

  await recordToolExecution({
    executionId,
    toolId: tool.toolId,
    actorId: input.actor.actorId,
    actorRole: input.actor.actorRole,
    argumentsHash: hashArguments(input.arguments),
    policyDecision: policy.decision,
    status: "RUNNING",
    traceId: input.actor.traceId,
    correlationId: input.actor.correlationId,
    idempotencyKey: input.idempotencyKey,
    ipAddress: input.actor.ipAddress,
    costUsd: tool.costEstimateUsd,
  });

  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount <= tool.maxRetries) {
    try {
      const result = await withTimeout(
        tool.handler({ actor: input.actor, arguments: input.arguments }),
        tool.timeoutMs,
      );
      const durationMs = Date.now() - t0;
      const resultHash = hashResult(result);

      recordCircuitSuccess(tool.toolId);
      recordToolSuccess(tool.category, tool.toolId);
      recordToolLatency(durationMs, tool.category);
      recordToolCost(tool.costEstimateUsd, tool.toolId);

      await updateToolExecution(executionId, {
        status: "SUCCESS",
        resultHash,
        durationMs,
        retryCount,
        costUsd: tool.costEstimateUsd,
      });

      if (aiBrainConfig.enabled) {
        await recordTimelineEntry({
          requestId: executionId,
          traceId: input.actor.traceId ?? executionId,
          actorId: input.actor.actorId,
          actorRole: input.actor.actorRole,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: durationMs,
          costUsd: tool.costEstimateUsd,
          status: "SUCCESS",
          fallbackUsed: false,
          blocked: false,
          metadata: { toolId: tool.toolId, category: tool.category, resultHash },
        });
      }

      return {
        executionId,
        status: "SUCCESS",
        policyDecision: policy.decision,
        result,
        durationMs,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError instanceof ToolExecutionError && lastError.code === "TIMEOUT") {
        recordToolTimeout(tool.toolId);
        break;
      }
      if (retryCount < tool.maxRetries) {
        retryCount++;
        recordToolRetry(tool.toolId);
        continue;
      }
      break;
    }
  }

  const durationMs = Date.now() - t0;
  const errorCode = lastError instanceof ToolExecutionError ? lastError.code : "EXECUTION_FAILED";
  recordCircuitFailure(tool.toolId);
  recordToolFailure(tool.category, errorCode);

  await updateToolExecution(executionId, {
    status: errorCode === "TIMEOUT" ? "TIMEOUT" : "FAILED",
    errorCode,
    errorMessage: lastError?.message,
    durationMs,
    retryCount,
  });

  return {
    executionId,
    status: errorCode === "TIMEOUT" ? "TIMEOUT" : "FAILED",
    policyDecision: policy.decision,
    errorCode,
    errorMessage: lastError?.message,
    durationMs,
  };
}

export function getCircuitBreakerStates(): Record<string, { failures: number; open: boolean }> {
  const out: Record<string, { failures: number; open: boolean }> = {};
  for (const [toolId, cb] of circuitBreakers) {
    out[toolId] = { failures: cb.failures, open: cb.openUntil > Date.now() };
  }
  return out;
}

export async function getToolMetricsSummary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, success, failed, denied, pendingApproval, agg] = await Promise.all([
    prisma.aiToolExecution.count({ where: { startedAt: { gte: since } } }),
    prisma.aiToolExecution.count({ where: { startedAt: { gte: since }, status: "SUCCESS" } }),
    prisma.aiToolExecution.count({
      where: { startedAt: { gte: since }, status: { in: ["FAILED", "TIMEOUT"] } },
    }),
    prisma.aiToolExecution.count({ where: { startedAt: { gte: since }, status: "DENIED" } }),
    prisma.aiToolExecution.count({ where: { startedAt: { gte: since }, status: "PENDING_APPROVAL" } }),
    prisma.aiToolExecution.aggregate({
      where: { startedAt: { gte: since }, durationMs: { not: null } },
      _avg: { durationMs: true },
      _sum: { costUsd: true },
    }),
  ]);
  return {
    totalRequests: total,
    successCount: success,
    failureCount: failed,
    deniedCount: denied,
    approvalRequiredCount: pendingApproval,
    avgLatencyMs: Math.round(agg._avg.durationMs ?? 0),
    totalCostUsd: agg._sum.costUsd ?? 0,
  };
}
