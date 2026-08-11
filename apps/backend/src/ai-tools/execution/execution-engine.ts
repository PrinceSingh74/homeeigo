import crypto from "crypto";
import prisma from "../../lib/prisma";
import { consumeRateLimitSmart } from "../../middleware/rate-limit.middleware";
import { aiToolsConfig } from "../config";
import type { ToolExecuteInput, ToolExecuteResult } from "../types";
import { getTool } from "../registry/tool-registry";
import { evaluatePolicy } from "../policy/policy-engine";
import { createApprovalRequest, consumeApproval } from "../approval/approval-engine";
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
  recordToolApprovalRejected,
  recordToolIdempotencyReplay,
  recordToolConfirmationRequired,
  recordToolIndeterminate,
} from "../../lib/ai-tools-metrics";
import { recordTimelineEntry } from "../../ai-brain/timeline/activity-timeline";
import { aiBrainConfig } from "../../ai-brain/config";

/**
 * Best-effort human-readable target for an approval.
 *
 * High-risk tools carry their real arguments one level down in `payload`, so a top-level
 * lookup finds nothing and the approver sees "not resource-bound" for an action that is in
 * fact bound to a specific booking. Both shapes are checked.
 */
function resolveResourceRef(args: Record<string, unknown>): string | undefined {
  const candidates = ["bookingId", "userId", "ticketId", "providerId", "partnerId"];
  const nested = (args.payload && typeof args.payload === "object" && !Array.isArray(args.payload))
    ? (args.payload as Record<string, unknown>)
    : undefined;

  for (const source of [args, nested]) {
    if (!source) continue;
    for (const key of candidates) {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

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

  // A high-risk request with no approval stops here and raises one for a human.
  //
  // Only this case. An earlier version returned unconditionally, which meant an action a
  // human had genuinely approved still could not run: the approval was created, decided
  // and even consumed, and execution was refused anyway. That is a dead end rather than a
  // control, and it invites the dangerous "fix" of deleting the guard outright.
  //
  // When an approval id IS present the request continues to the approval gate below, which
  // verifies tool, requester, expiry and argument hash and consumes the approval atomically.
  // Reaching this point with an id is not authorisation — that gate decides.
  if (tool.category === "HIGH_RISK" && !input.approvalId) {
    recordToolRequiresApproval(tool.toolId);

    const pending = await createApprovalRequest({
          toolId: tool.toolId,
          requestedBy: input.actor.actorId,
          requestedRole: input.actor.actorRole,
          argumentsHash: hashArguments(input.arguments),
          argumentsPreview: input.arguments,
          resourceRef: resolveResourceRef(input.arguments),
          riskScore: tool.riskLevel === "CRITICAL" ? 1 : 0.8,
          metadata: { executionId, correlationId: input.actor.correlationId },
        });

    await recordToolExecution({
      executionId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      policyDecision: "REQUIRES_APPROVAL",
      status: "DENIED",
      errorCode: "APPROVAL_REQUIRED",
      errorMessage: "High-risk action requires human approval; AI cannot execute it",
      durationMs: Date.now() - t0,
      traceId: input.actor.traceId,
      correlationId: input.actor.correlationId,
      approvalId: pending.id,
      idempotencyKey: input.idempotencyKey,
      ipAddress: input.actor.ipAddress,
    });
    return {
      executionId,
      status: "DENIED",
      policyDecision: "REQUIRES_APPROVAL",
      durationMs: Date.now() - t0,
      errorCode: "APPROVAL_REQUIRED",
      errorMessage: "This action requires human approval and was not performed",
      requiresApproval: true,
      approvalId: pending.approvalId,
    };
  }

  // Idempotency: replay every non-retryable state, not only SUCCESS.
  //
  // Returning early only for SUCCESS left the dangerous states open. A retry arriving while
  // the first attempt was still RUNNING fell through and executed a second time — two
  // bookings, two cancellations, two tickets. A key sitting in PENDING_APPROVAL did the
  // same, opening a second approval request for one intent.
  //
  // The key must also be bound to who is using it and what for: an idempotency key is
  // client-supplied, so without this a caller could replay someone else's key and receive
  // their result, or suppress a legitimate action by reusing a key across tools.
  if (input.idempotencyKey) {
    const existing = await prisma.aiToolExecution.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
      const sameIdentity =
        existing.toolId === tool.toolId &&
        existing.actorId === input.actor.actorId &&
        existing.argumentsHash === hashArguments(input.arguments);

      if (!sameIdentity) {
        recordToolDenied(tool.toolId, "IDEMPOTENCY_KEY_REUSED");
        throw new ToolExecutionError(
          "Idempotency key already used for a different request",
          "IDEMPOTENCY_KEY_REUSED",
        );
      }

      // SUCCESS replays the original outcome; RUNNING and PENDING_APPROVAL report the
      // in-flight state without starting a second execution. Only FAILED falls through,
      // so a genuine retry after a genuine failure still works.
      //
      // INDETERMINATE must never fall through. Its whole meaning is "the side effect may
      // already have happened", so re-running it is precisely the double-refund path this
      // state exists to prevent. It is replayed like a terminal outcome, and clearing it
      // requires reconciling downstream — not another attempt through this door.
      if (
        existing.status === "SUCCESS" ||
        existing.status === "RUNNING" ||
        existing.status === "PENDING_APPROVAL" ||
        existing.status === "INDETERMINATE"
      ) {
        recordToolIdempotencyReplay(tool.toolId, existing.status);
        return {
          executionId: existing.executionId,
          status: existing.status,
          policyDecision: existing.policyDecision,
          durationMs: existing.durationMs ?? 0,
          approvalId: existing.approvalId ?? undefined,
          requiresApproval: existing.status === "PENDING_APPROVAL",
          errorCode: existing.status === "INDETERMINATE" ? "OUTCOME_UNKNOWN" : undefined,
          errorMessage:
            existing.status === "INDETERMINATE"
              ? "A previous attempt with this key ended with an unknown outcome. Reconcile downstream before trying again."
              : undefined,
          result: { idempotent: true, resultHash: existing.resultHash },
        };
      }
    }
  }

  const argValidation = validateToolArguments(tool, input.arguments, {
    approvalPresented: Boolean(input.approvalId),
  });
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

  const policy = await evaluatePolicy({
    tool,
    actor: input.actor,
    arguments: input.arguments,
    confirmed: input.confirmed,
  });

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

  // Confirmation is a stop, not a failure: the caller is told what to show the user and
  // asked to come back with `confirmed: true`. Nothing is executed and nothing is reserved.
  if (policy.decision === "REQUIRES_CONFIRMATION") {
    recordToolConfirmationRequired(tool.toolId);
    await recordToolExecution({
      executionId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      policyDecision: "REQUIRES_CONFIRMATION",
      status: "DENIED",
      errorCode: "CONFIRMATION_REQUIRED",
      errorMessage: policy.reason,
      durationMs: Date.now() - t0,
      traceId: input.actor.traceId,
      correlationId: input.actor.correlationId,
      idempotencyKey: input.idempotencyKey,
      ipAddress: input.actor.ipAddress,
    });
    return {
      executionId,
      status: "DENIED",
      policyDecision: "REQUIRES_CONFIRMATION",
      durationMs: Date.now() - t0,
      errorCode: "CONFIRMATION_REQUIRED",
      requiresConfirmation: true,
      confirmationPrompt: policy.reason,
    };
  }

  if (policy.decision === "REQUIRES_APPROVAL" && !input.approvalId) {
    recordToolRequiresApproval(tool.toolId);
    const approval = await createApprovalRequest({
      toolId: tool.toolId,
      requestedBy: input.actor.actorId,
      requestedRole: input.actor.actorRole,
      argumentsHash: hashArguments(input.arguments),
      argumentsPreview: input.arguments,
      resourceRef: resolveResourceRef(input.arguments),
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

  // A tool that needs approval must have one, even if the caller omitted the id: without
  // this an approval-gated tool executes freely whenever `approvalId` is simply left out.
  const needsApproval = policy.decision === "REQUIRES_APPROVAL" || tool.approvalRequired;
  if (needsApproval && !input.approvalId) {
    throw new ToolExecutionError("Approval required for this tool", "APPROVAL_REQUIRED");
  }

  if (input.approvalId) {
    // One-time, and bound to this tool, this actor and these exact arguments. The claim is
    // atomic, so two executions racing the same approval yield exactly one winner.
    const consumed = await consumeApproval({
      approvalId: input.approvalId,
      toolId: tool.toolId,
      actorId: input.actor.actorId,
      argumentsHash: hashArguments(input.arguments),
      executionId,
    });
    if (!consumed.ok) {
      recordToolApprovalRejected(tool.toolId, consumed.failure);
      throw new ToolExecutionError(
        "Approval is not valid for this request",
        consumed.failure,
      );
    }
  }

  /**
   * The key the handler must hand to the business service.
   *
   * Anchored on the approval when there is one, because the approval — not the arguments —
   * is the unit of authorisation: two separately approved refunds for the same booking and
   * amount are two distinct operations and must not collapse into one. Falling back to the
   * caller's key preserves existing write-tool behaviour, and to the execution id so the
   * value is never absent.
   */
  const derivedIdempotencyKey = input.approvalId
    ? `ai-approval:${input.approvalId}`
    : input.idempotencyKey ?? `ai-exec:${executionId}`;

  // Only reachable once the approval gate above has passed. An earlier revision checked
  // this first, which short-circuited every high-risk request before its bindings were
  // ever evaluated — the gate became unreachable code. Authorization decides first.
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
        tool.handler({
          actor: input.actor,
          arguments: input.arguments,
          executionId,
          approvalId: input.approvalId,
          idempotencyKey: derivedIdempotencyKey,
        }),
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
  const rawErrorCode = lastError instanceof ToolExecutionError ? lastError.code : "EXECUTION_FAILED";
  recordCircuitFailure(tool.toolId);

  /**
   * A side-effecting call that timed out has an UNKNOWN outcome, not a failed one.
   *
   * The handler was already in flight when the clock ran out, so the downstream system may
   * have applied the change and simply not answered in time. Recording that as FAILED is
   * how double refunds happen: an operator reads "failed", approves again, and the second
   * attempt lands next to a first one that also succeeded.
   *
   * Reads are exempt — re-reading is free, and a timed-out read genuinely returned nothing.
   */
  const outcomeUnknown = rawErrorCode === "TIMEOUT" && tool.category !== "READ";
  const errorCode = outcomeUnknown ? "OUTCOME_UNKNOWN" : rawErrorCode;
  const terminalStatus = outcomeUnknown
    ? ("INDETERMINATE" as const)
    : rawErrorCode === "TIMEOUT"
      ? ("TIMEOUT" as const)
      : ("FAILED" as const);

  recordToolFailure(tool.category, errorCode);
  if (outcomeUnknown) recordToolIndeterminate(tool.toolId);

  const errorMessage = outcomeUnknown
    ? "The action timed out after it had started. It may or may not have taken effect — reconcile before retrying."
    : lastError?.message;

  await updateToolExecution(executionId, {
    status: terminalStatus,
    errorCode,
    errorMessage,
    durationMs,
    retryCount,
  });

  return {
    executionId,
    status: terminalStatus,
    policyDecision: policy.decision,
    errorCode,
    errorMessage,
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
