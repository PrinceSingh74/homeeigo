import crypto from "crypto";
import type { AgentRunStatus, Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { executeTool, ToolExecutionError } from "../../ai-tools/execution/execution-engine";
import { hashArguments } from "../../ai-tools/audit/tool-audit.service";
import { redactArguments } from "../../ai-tools/security/tool-security";
import { getTool } from "../../ai-tools/registry/tool-registry";
import { POLICY_RULESET_VERSION } from "../../ai-tools/policy/policy-rules";
import { AuditLogService, type SecurityEvent } from "../../services/audit-log.service";
import { agentsConfig } from "../config";
import {
  assertCapabilityAllowed,
  effectiveBounds,
  getAgentDefinition,
  toolsetVersion,
} from "../registry/agent-registry";
import { admitAgentRun, disposeStep, runIdempotencyKey } from "../policy/agent-policy";
import { planWithModel } from "../planning/planner";
import { validatePlan } from "../planning/plan-validator";
import { resolveIntent } from "../planning/intent";
import { assessFreshness, blocksDownstreamWrite, type FreshnessAssessment } from "./freshness";
import { createRun, heartbeat, recordStep, transitionRun } from "./run-store";
import { verifyPostCondition } from "./verification";
import * as metrics from "../observability/agent-metrics";
import type {
  AgentRunRequest,
  AgentRunResult,
  AgentStepRecord,
  ValidatedPlan,
  ValidatedStep,
} from "../types";

/**
 * The governed agent loop.
 *
 * OBSERVE → PLAN → VALIDATE → CLASSIFY RISK → AUTHORISE → EXECUTE-or-ESCALATE → VERIFY → AUDIT.
 *
 * Three properties are worth stating plainly, because they are what make this a runtime rather
 * than a wrapper around a chat loop:
 *
 *  1. NOTHING the model emits reaches a service. The model produces a capability name and a bag
 *     of arguments; the capability is resolved through the agent's own allowlist, the tool id
 *     comes from the registry, and execution goes through `executeTool` — the same door an HTTP
 *     caller uses, with the same policy, RBAC, ownership, approval, idempotency and audit.
 *
 *  2. EVERY exit is bounded and recorded. Steps, tool calls, wall time, tokens and cost each
 *     have a ceiling, and hitting one stops the run with a named `stopReason` rather than
 *     letting it wander. There is no path through this function that loops without a bound.
 *
 *  3. SUCCESS IS NOT ASSUMED. A write that the tool layer reports as SUCCESS is re-read before
 *     the run is allowed to complete, and a failed or unknown post-condition stops the run
 *     instead of being retried.
 */

const MAX_SUMMARY_CHARS = 1_200;

type RunAccounting = {
  steps: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  startedAt: number;
};

/** Which bound, if any, this run has hit. Checked before every step, never after the fact. */
function boundExceeded(
  acc: RunAccounting,
  bounds: ReturnType<typeof effectiveBounds>,
): string | null {
  if (acc.steps >= bounds.maxSteps) return "MAX_STEPS";
  if (acc.toolCalls >= bounds.maxToolCalls) return "MAX_TOOL_CALLS";
  if (Date.now() - acc.startedAt >= bounds.maxElapsedMs) return "MAX_ELAPSED";
  if (acc.costUsd >= bounds.maxCostUsd) return "BUDGET_EXHAUSTED";
  if (acc.promptTokens + acc.completionTokens >= bounds.maxTokens) return "MAX_TOKENS";
  return null;
}

/**
 * Audit an agent decision through the platform's own audit service.
 *
 * Awaited, and its failure is logged loudly rather than swallowed. §35 forbids fire-and-forget
 * audit on governed actions: an execution whose audit write silently failed is an execution
 * nobody can reconstruct, and "we have no record" is indistinguishable from "it never happened".
 */
async function audit(params: {
  action: SecurityEvent;
  status: "success" | "failure";
  actorId: string;
  runId: string;
  agentId: string;
  traceId: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    await AuditLogService.recordGoverned(params.action, params.status, {
      userId: params.actorId,
      traceId: params.traceId,
      reason: `${params.agentId}:${params.runId}`,
      details: { agentId: params.agentId, runId: params.runId, ...params.detail },
    });
  } catch (err) {
    // `recordGoverned` throws when the audit row could not be persisted — it returns the row id
    // as proof and treats a null as a failure. That is the behaviour we want, and it is why this
    // is logged at SECURITY rather than swallowed: a governed action whose audit write failed is
    // an action nobody can reconstruct, and "no record" reads identically to "never happened".
    //
    // It does not abort the run. The audit points here bracket a decision that has ALREADY been
    // made and recorded in `agent_runs` / `agent_run_steps`; throwing now would leave a run
    // half-advanced with no better record than the one we just failed to write. The alert is the
    // remedy, and the run rows remain the primary evidence.
    logger.error("agent_audit_write_failed", {
      category: "SECURITY",
      runId: params.runId,
      agentId: params.agentId,
      action: params.action,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * The operator-facing account of what happened.
 *
 * Assembled from the recorded steps, never from model prose. §65 and §66 both require structured
 * rationale rather than hidden reasoning, and a summary written by the model would be a claim
 * about the run rather than a description of it — including, potentially, a claim that something
 * succeeded when the step rows say otherwise.
 */
function buildSummary(plan: ValidatedPlan | null, steps: AgentStepRecord[], stopReason?: string): string {
  const lines: string[] = [];
  if (plan) lines.push(`Goal: ${plan.goal}`, `Rationale: ${plan.reason}`.slice(0, 400));
  for (const s of steps) {
    if (s.phase === "PLAN") continue;
    const verdict = s.verification?.verdict ? ` verified=${String(s.verification.verdict)}` : "";
    lines.push(
      `#${s.stepIndex} ${s.capability ?? s.phase}: ${s.status}${s.errorCode ? ` (${s.errorCode})` : ""}${verdict}`,
    );
  }
  if (stopReason) lines.push(`Stopped: ${stopReason}`);
  return lines.join("\n").slice(0, MAX_SUMMARY_CHARS);
}

export async function runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  const def = getAgentDefinition(request.agentId);
  const bounds = effectiveBounds(request.agentId);
  const runId = crypto.randomUUID();
  const traceId = request.actor.traceId ?? runId;
  const startedAt = Date.now();

  const acc: RunAccounting = {
    steps: 0,
    toolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    startedAt,
  };

  const stepRecords: AgentStepRecord[] = [];
  const approvals: string[] = [];

  // ── Admission ─────────────────────────────────────────────────────────────
  const admission = await admitAgentRun({
    agentId: request.agentId,
    trigger: request.trigger,
    forceShadow: request.forceShadow,
    rolloutSubject: request.actor.actorId,
  });

  if (!admission.ok) {
    metrics.recordAgentAdmissionRefused(request.agentId, admission.code);
    if (admission.code === "RECURSION_CYCLE_DETECTED" || admission.code === "RECURSION_DEPTH_EXCEEDED") {
      metrics.recordAgentLoopPrevented(request.agentId, admission.code);
    }
    // No run row: nothing was authorised and nothing was planned, so there is no run to record.
    // The refusal is still auditable — it lands in the metric and, for the security-relevant
    // refusals, in the security log below.
    logger.warn("agent_run_refused", {
      category: "SECURITY",
      agentId: request.agentId,
      code: admission.code,
      reason: admission.reason,
      traceId,
    });
    return {
      runId,
      agentId: request.agentId,
      agentVersion: def.version,
      mode: "SHADOW",
      status: "CANCELLED",
      goal: request.goal,
      summary: `Refused before start: ${admission.code}`,
      steps: [],
      approvals: [],
      stopReason: admission.code,
      errorCode: admission.code,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  const mode = admission.mode;
  const idempotencyKey = runIdempotencyKey(request.agentId, request.trigger);

  /**
   * What was actually asked for — §8.
   *
   * Resolved from the goal (and from an explicitly declared intent where the CALL SITE knows
   * it), never from the plan. Every other control in this runtime authorises the ACTOR; this one
   * authorises the REQUEST, and it is the only thing standing between "why did this fail" and a
   * side effect nobody asked for. See planning/intent.ts for why an unrecognised phrasing
   * resolves to the read-only reading rather than the permissive one.
   */
  const intent = resolveIntent({ goal: request.goal, declared: request.declaredIntent });
  const intentSummary = {
    intent: intent.intent,
    source: intent.source,
    evidence: intent.evidence,
    permitsSideEffect: intent.permitsSideEffect,
  };

  const created = await createRun({
    runId,
    agentId: request.agentId,
    agentVersion: def.version,
    promptVersion: def.promptVersion,
    policyVersion: POLICY_RULESET_VERSION,
    toolsetVersion: toolsetVersion(request.agentId),
    mode,
    actorId: request.actor.actorId,
    actorRole: def.actorRole,
    triggerType: request.trigger.type,
    triggerRef: request.trigger.ref,
    subjectType: request.trigger.subjectType,
    subjectId: request.trigger.subjectId,
    traceId,
    causationId: request.trigger.causationId,
    parentRunId: request.trigger.parentRunId,
    depth: request.trigger.depth ?? 0,
    goal: request.goal,
    idempotencyKey,
    metadata: {
      admissionReason: admission.reason,
      // The resolved intent is frozen onto the run at creation, before any model call. It is an
      // authorisation input, so it must never be derivable from anything the model later emits.
      intent: intent.intent,
      intentSource: intent.source,
      intentEvidence: intent.evidence,
    },
  });

  if (!created.created) {
    // A replayed or duplicated trigger. One cause, one run — the second delivery returns the
    // first run's identity rather than planning again.
    metrics.recordAgentDuplicateSuppressed(request.agentId, request.trigger.type);
    return {
      runId: created.runId,
      agentId: request.agentId,
      agentVersion: def.version,
      mode,
      status: "CANCELLED",
      goal: request.goal,
      summary: "Duplicate trigger; an existing run already covers this cause.",
      steps: [],
      approvals: [],
      stopReason: "DUPLICATE_RUN",
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  metrics.recordAgentRunStarted(request.agentId, mode, request.trigger.type);
  await audit({
    action: "AGENT_RUN_STARTED",
    status: "success",
    traceId,
    actorId: request.actor.actorId,
    runId,
    agentId: request.agentId,
    detail: { mode, trigger: request.trigger.type, goal: request.goal, admission: admission.reason },
  });

  let finalStatus: AgentRunStatus = "FAILED";
  let stopReason: string | undefined;
  let escalationReason: string | undefined;
  let errorCode: string | undefined;
  /**
   * The human-readable reason, carried on the RUN row and not only on the step.
   *
   * Without it `agent_runs` showed `PLANNER_UNAVAILABLE` with an empty `error_message`, and the
   * only way to learn the cause was `PROVIDER_ERROR: Upstream AI provider failed` was to join to
   * `agent_run_steps`. An operator triaging a spike of failed runs should not have to write a join
   * to tell a provider outage from a spend cap from a blocked prompt — those need three different
   * responses, and the code alone does not distinguish them.
   */
  let errorMessage: string | undefined;
  let plan: ValidatedPlan | null = null;

  try {
    // ── PLAN ────────────────────────────────────────────────────────────────
    await transitionRun(runId, "PLANNING");

    const planning = await planWithModel({
      agentId: request.agentId,
      goal: request.goal,
      input: request.input,
      actorId: request.actor.actorId,
      traceId,
      ipAddress: request.actor.ipAddress,
    });

    acc.promptTokens += planning.promptTokens;
    acc.completionTokens += planning.completionTokens;
    acc.costUsd += planning.costUsd;
    metrics.recordAgentTokens(request.agentId, planning.promptTokens, planning.completionTokens);
    metrics.recordAgentCost(request.agentId, planning.costUsd);

    if (!planning.ok) {
      stepRecords.push({
        stepIndex: 0,
        phase: "PLAN",
        status: "FAILED",
        errorCode: planning.code,
        errorMessage: planning.reason,
        durationMs: planning.latencyMs,
      });
      await recordStep(runId, stepRecords[0]);
      errorCode = planning.code;
      errorMessage = planning.reason;
      stopReason = planning.code;
      finalStatus = "FAILED";
      throw new AgentRunHalt(planning.code, planning.reason);
    }

    const validation = validatePlan(request.agentId, planning.proposed, intent);

    /**
     * §9 — an underspecified request is ASKED ABOUT, not guessed at.
     *
     * This is an ESCALATION, not a failure. The agent did its job: it understood the request,
     * found the one thing it could not supply, and handed the run to a human with a specific
     * question. Recording it as FAILED would put a correct outcome in the failure ratio that
     * drives the DEGRADED and ERROR health states, and an agent that asks good questions would
     * gradually look broken.
     *
     * PLANNING → ESCALATED is an already-legal transition and the questions ride in metadata, so
     * this needs no new run state and no migration.
     */
    if (!validation.ok && validation.code === "NEEDS_CLARIFICATION") {
      metrics.recordAgentPlanRejected(request.agentId, validation.code);
      stepRecords.push({
        stepIndex: 0,
        phase: "PLAN",
        status: "SKIPPED",
        errorCode: validation.code,
        errorMessage: validation.reason,
        durationMs: planning.latencyMs,
      });
      await recordStep(runId, stepRecords[0]);
      await audit({
        action: "AGENT_PLAN_REJECTED",
        status: "success",
        traceId,
        actorId: request.actor.actorId,
        runId,
        agentId: request.agentId,
        detail: { code: validation.code, questions: validation.questions },
      });
      await transitionRun(runId, "ESCALATED", {
        escalationReason: `CLARIFICATION_REQUIRED:${validation.questions.map((q) => q.field).join(",")}`,
        metadata: {
          admissionReason: admission.reason,
          intent: intent.intent,
          intentSource: intent.source,
          intentEvidence: intent.evidence,
          clarificationQuestions: validation.questions,
        } as Prisma.InputJsonValue,
      });
      return {
        runId,
        agentId: request.agentId,
        agentVersion: def.version,
        mode,
        status: "ESCALATED",
        goal: request.goal,
        summary: [validation.reason, ...validation.questions.map((q) => `- ${q.question}`)].join(
          "\n",
        ),
        steps: stepRecords,
        approvals: [],
        stopReason: validation.code,
        escalationReason: validation.reason,
        costUsd: acc.costUsd,
        latencyMs: Date.now() - startedAt,
        intent: intentSummary,
        clarifications: validation.questions,
      };
    }

    if (!validation.ok) {
      metrics.recordAgentPlanRejected(request.agentId, validation.code);
      stepRecords.push({
        stepIndex: 0,
        phase: "PLAN",
        status: "FAILED",
        errorCode: validation.code,
        errorMessage: validation.reason,
        durationMs: planning.latencyMs,
      });
      await recordStep(runId, stepRecords[0]);
      // A rejected plan is a security-relevant event when the model reached outside its
      // vocabulary. Logged at SECURITY so it is visible next to the other authorisation refusals
      // rather than buried in application noise.
      logger.warn("agent_plan_rejected", {
        category: "SECURITY",
        agentId: request.agentId,
        runId,
        code: validation.code,
        reason: validation.reason,
        traceId,
      });
      await audit({
        action: "AGENT_PLAN_REJECTED",
        status: "failure",
        traceId,
        actorId: request.actor.actorId,
        runId,
        agentId: request.agentId,
        detail: { code: validation.code, reason: validation.reason },
      });
      errorCode = validation.code;
      errorMessage = validation.reason;
      stopReason = validation.code;
      finalStatus = "FAILED";
      throw new AgentRunHalt(validation.code, validation.reason);
    }

    plan = validation.plan;
    metrics.recordAgentPlanAccepted(request.agentId, plan.riskTier, plan.steps.length);

    stepRecords.push({
      stepIndex: 0,
      phase: "PLAN",
      status: "PLANNED",
      risk: plan.riskTier,
      durationMs: planning.latencyMs,
    });
    await recordStep(runId, stepRecords[0]);

    await transitionRun(runId, "WAITING_POLICY", {
      riskTier: plan.riskTier,
      planHash: plan.planHash,
      // Redacted. The stored plan is for an operator's timeline, so it carries capability names
      // and reasons but never raw argument values, which can contain personal data.
      plan: {
        goal: plan.goal,
        reason: plan.reason,
        steps: plan.steps.map((s) => ({
          capability: s.capability,
          risk: s.risk,
          reason: s.reason.slice(0, 300),
          expectedEffect: s.expectedEffect.slice(0, 300),
          arguments: redactArguments(s.arguments),
        })),
      } as Prisma.InputJsonValue,
      modelProvider: planning.provider,
      modelName: planning.model,
    });

    await audit({
      action: "AGENT_PLAN_ACCEPTED",
      status: "success",
      traceId,
      actorId: request.actor.actorId,
      runId,
      agentId: request.agentId,
      detail: {
        planHash: plan.planHash,
        riskTier: plan.riskTier,
        steps: plan.steps.map((s) => s.capability),
        provider: planning.provider,
        model: planning.model,
      },
    });

    // A plan with no steps is a legitimate, correct outcome — the model was asked to do
    // something its capabilities cannot serve and said so. Complete, do not fail.
    if (plan.steps.length === 0) {
      finalStatus = "COMPLETED";
      stopReason = "EMPTY_PLAN";
    } else {
      const outcome = await executePlan({
        runId,
        request,
        plan,
        mode,
        acc,
        bounds,
        stepRecords,
        approvals,
        traceId,
      });
      finalStatus = outcome.status;
      stopReason = outcome.stopReason;
      escalationReason = outcome.escalationReason;
      errorCode = outcome.errorCode;
    }
  } catch (err) {
    if (!(err instanceof AgentRunHalt)) {
      errorCode = errorCode ?? "RUNTIME_ERROR";
      stopReason = stopReason ?? "RUNTIME_ERROR";
      finalStatus = "FAILED";
      logger.error("agent_run_failed", {
        category: "APPLICATION",
        agentId: request.agentId,
        runId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const latencyMs = Date.now() - startedAt;

  // Terminal transition is attempted from whatever state the run reached. A state machine
  // violation here would strand the run non-terminal, so it is caught and logged rather than
  // thrown — the run's outcome is already decided, and losing the status write must not also
  // lose the caller's result.
  await transitionRun(runId, finalStatus, {
    stopReason,
    escalationReason,
    errorCode,
    errorMessage: errorMessage?.slice(0, 500),
    latencyMs,
    stepCount: acc.steps,
    toolCallCount: acc.toolCalls,
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    costUsd: acc.costUsd,
  }).catch((err) => {
    logger.error("agent_terminal_transition_failed", {
      category: "APPLICATION",
      runId,
      to: finalStatus,
      error: err instanceof Error ? err.message : "unknown",
    });
  });

  metrics.recordAgentRunCompleted(request.agentId, mode, finalStatus);
  metrics.recordAgentLatency(request.agentId, mode, latencyMs);

  await audit({
    action: "AGENT_RUN_COMPLETED",
    status: finalStatus === "COMPLETED" || finalStatus === "ESCALATED" ? "success" : "failure",
    traceId,
    actorId: request.actor.actorId,
    runId,
    agentId: request.agentId,
    detail: {
      status: finalStatus,
      stopReason,
      escalationReason,
      errorCode,
      toolCalls: acc.toolCalls,
      costUsd: acc.costUsd,
      latencyMs,
    },
  });

  return {
    runId,
    agentId: request.agentId,
    agentVersion: def.version,
    mode,
    status: finalStatus,
    riskTier: plan?.riskTier,
    goal: request.goal,
    summary: buildSummary(plan, stepRecords, stopReason),
    steps: stepRecords,
    approvals,
    stopReason,
    escalationReason,
    errorCode,
    costUsd: acc.costUsd,
    latencyMs,
    intent: intentSummary,
  };
}

/** Internal control-flow signal. Never surfaced; the run's recorded fields carry the reason. */
class AgentRunHalt extends Error {
  constructor(
    public code: string,
    reason: string,
  ) {
    super(reason);
    this.name = "AgentRunHalt";
  }
}

async function executePlan(params: {
  runId: string;
  request: AgentRunRequest;
  plan: ValidatedPlan;
  mode: "SHADOW" | "LIVE";
  acc: RunAccounting;
  bounds: ReturnType<typeof effectiveBounds>;
  stepRecords: AgentStepRecord[];
  approvals: string[];
  traceId: string;
}): Promise<{
  status: AgentRunStatus;
  stopReason?: string;
  escalationReason?: string;
  errorCode?: string;
}> {
  const { runId, request, plan, mode, acc, bounds, stepRecords, approvals, traceId } = params;

  await transitionRun(runId, "EXECUTING");

  let escalated: string | undefined;
  let anyExecuted = false;

  /**
   * §35 — reads whose age could not be established, or was established as too old.
   *
   * Collected across the run rather than checked per step, because the risk is not that a
   * stale READ is wrong; it is that a stale read becomes the EVIDENCE for a write. A run that
   * reads a forty-minute-old zone scoring and then resolves the alert tracking that zone has
   * closed an alert about a condition it never actually re-checked — and every existing control
   * passes, because the read succeeded, the write was authorised, and the post-condition
   * confirms the alert is now resolved. Verification proves the write happened. It says nothing
   * about whether the reason for it was still true.
   */
  const staleEvidence: Array<{ capability: string; assessment: FreshnessAssessment }> = [];

  for (let i = 0; i < plan.steps.length; i += 1) {
    const bound = boundExceeded(acc, bounds);
    if (bound) {
      metrics.recordAgentBoundHit(request.agentId, bound);
      await recordStep(runId, {
        stepIndex: i + 1,
        phase: "EXECUTE",
        capability: plan.steps[i].capability,
        status: "SKIPPED",
        errorCode: bound,
        errorMessage: `Run bound ${bound} reached before this step`,
      });
      /**
       * A bound reached mid-plan ends the run where it stands.
       *
       * The VERIFYING hop is not decoration: `EXECUTING → COMPLETED` is not a legal transition,
       * and taking it directly left the run stranded in EXECUTING while the caller was told
       * COMPLETED — a persisted record that contradicts the returned result, and a run that the
       * orphan sweep would then try to recover forever.
       */
      if (anyExecuted) await transitionRun(runId, "VERIFYING");
      return {
        status: anyExecuted ? "COMPLETED" : "FAILED",
        stopReason: bound,
        errorCode: bound,
      };
    }

    await heartbeat(runId);

    const step = plan.steps[i];
    const stepIndex = i + 1;

    /**
     * A side effect standing on evidence this run could not date is an ESCALATION, not a
     * failure — the agent did the reading correctly and the data underneath it was not good
     * enough to act on. §35: stale means do not silently act; it does not mean pretend the read
     * failed.
     *
     * Only writes are gated. Further reads are allowed to proceed precisely so the run can
     * gather better evidence, and so the operator sees the whole picture rather than a run that
     * stopped at the first cache miss.
     */
    if (step.risk !== "LOW" && staleEvidence.length > 0) {
      const blocking = staleEvidence[0];
      const reason = `STALE_EVIDENCE:${blocking.capability}`;
      metrics.recordAgentStaleEvidenceBlock(request.agentId, blocking.assessment.verdict);
      await recordStep(runId, {
        stepIndex,
        phase: "ESCALATE",
        capability: step.capability,
        risk: step.risk,
        status: "AWAITING_APPROVAL",
        errorCode: reason,
        errorMessage:
          `Not executed: the evidence from "${blocking.capability}" is ${blocking.assessment.verdict}` +
          `${blocking.assessment.reason ? ` (${blocking.assessment.reason})` : ""}. ` +
          "A human should confirm the condition still holds.",
        verification: {
          verdict: "NOT_APPLICABLE",
          check: "freshness.gate",
          reason: "No side effect performed",
        },
      });
      stepRecords.push({
        stepIndex,
        phase: "ESCALATE",
        capability: step.capability,
        risk: step.risk,
        status: "AWAITING_APPROVAL",
        errorCode: reason,
      });
      escalated = reason;
      break;
    }
    const outcome = await executeStep({
      runId,
      request,
      step,
      stepIndex,
      mode,
      acc,
      traceId,
    });

    stepRecords.push(outcome.record);
    if (outcome.freshness && blocksDownstreamWrite(outcome.freshness)) {
      staleEvidence.push({ capability: step.capability, assessment: outcome.freshness });
    }
    if (outcome.approvalId) approvals.push(outcome.approvalId);
    acc.steps += 1;
    if (outcome.consumedToolCall) acc.toolCalls += 1;
    if (outcome.record.status === "EXECUTED" || outcome.record.status === "VERIFIED") {
      anyExecuted = true;
    }

    if (outcome.escalate) {
      escalated = outcome.escalate;
      break;
    }

    // A step that failed, or whose post-condition did not hold, stops the plan.
    //
    // Continuing would run later steps against a world that is not in the state the plan
    // assumed — the sequence was authorised as a whole, and half of it is not a smaller version
    // of it. §14 is explicit that a failed post-condition is a stop, never a blind retry.
    if (
      outcome.record.status === "FAILED" ||
      outcome.record.status === "VERIFICATION_FAILED" ||
      outcome.record.status === "INDETERMINATE" ||
      outcome.record.status === "POLICY_DENIED"
    ) {
      return {
        status: outcome.record.status === "INDETERMINATE" ? "ESCALATED" : "FAILED",
        stopReason: outcome.record.errorCode ?? outcome.record.status,
        errorCode: outcome.record.errorCode,
        escalationReason:
          outcome.record.status === "INDETERMINATE"
            ? "Outcome unknown; reconcile downstream before retrying"
            : undefined,
      };
    }
  }

  if (escalated) {
    metrics.recordAgentEscalation(request.agentId, escalated);
    await audit({
      action: "AGENT_ESCALATED",
      status: "success",
      traceId,
      actorId: request.actor.actorId,
      runId,
      agentId: request.agentId,
      detail: { reason: escalated },
    });
    return { status: "ESCALATED", escalationReason: escalated, stopReason: "ESCALATED" };
  }

  // Same reason as above: COMPLETED is only reachable from VERIFYING.
  await transitionRun(runId, "VERIFYING");
  return { status: "COMPLETED" };
}

async function executeStep(params: {
  runId: string;
  request: AgentRunRequest;
  step: ValidatedStep;
  stepIndex: number;
  mode: "SHADOW" | "LIVE";
  acc: RunAccounting;
  traceId: string;
}): Promise<{
  record: AgentStepRecord;
  approvalId?: string;
  escalate?: string;
  consumedToolCall: boolean;
  /**
   * How old the data this step read turned out to be.
   *
   * Returned rather than acted on here, because the decision it feeds is about a LATER step:
   * a stale read is perfectly fine on its own and only matters once something wants to write
   * based on it. `executeStep` cannot see the rest of the plan, so it reports and `executePlan`
   * decides.
   */
  freshness?: FreshnessAssessment;
}> {
  const { runId, request, step, stepIndex, mode, traceId } = params;
  const t0 = Date.now();

  // The execution-time allowlist re-check. Plan validation already did this; doing it again here
  // is what protects any path that reaches execution without the validator — a recovery, a
  // replay, or a future caller that constructs steps directly.
  const cap = assertCapabilityAllowed(request.agentId, step.capability);
  const toolId = cap.toolId!;
  const tool = getTool(toolId);
  const isWrite = tool ? tool.category !== "READ" : true;

  const argumentsHash = hashArguments(step.arguments);
  const preview = redactArguments(step.arguments);

  const disposition = disposeStep({
    agentId: request.agentId,
    mode,
    stepRisk: step.risk,
    isWrite,
  });
  metrics.recordAgentStepDisposition(request.agentId, disposition.action, step.risk);

  if (disposition.action === "ESCALATE") {
    const record: AgentStepRecord = {
      stepIndex,
      phase: "ESCALATE",
      capability: step.capability,
      toolId,
      risk: step.risk,
      status: "AWAITING_APPROVAL",
      errorCode: disposition.reason,
      errorMessage: "Handed to a human; the agent did not perform this action",
      durationMs: Date.now() - t0,
    };
    await recordStep(runId, record, { argumentsHash, argumentsPreview: preview });
    return { record, escalate: disposition.reason, consumedToolCall: false };
  }

  if (disposition.action === "SHADOW") {
    /**
     * Shadow: everything up to the side effect, and then deliberately not the side effect.
     *
     * The step is fully resolved, risk-classified, authorised and recorded with the exact
     * arguments that WOULD have been used — which is what makes shadow output comparable to a
     * live run and to a human's decision. What is not done is the one thing that changes the
     * world.
     */
    const record: AgentStepRecord = {
      stepIndex,
      phase: "EXECUTE",
      capability: step.capability,
      toolId,
      risk: step.risk,
      status: "SHADOWED",
      verification: { verdict: "NOT_APPLICABLE", check: "shadow", reason: "No side effect performed" },
      durationMs: Date.now() - t0,
    };
    await recordStep(runId, record, { argumentsHash, argumentsPreview: preview });
    return { record, consumedToolCall: false };
  }

  // ── EXECUTE ───────────────────────────────────────────────────────────────
  const executedAt = new Date();
  try {
    const result = await executeTool({
      toolId,
      arguments: step.arguments,
      actor: {
        actorId: request.actor.actorId,
        actorRole: getAgentDefinition(request.agentId).actorRole,
        userRole: request.actor.userRole,
        ipAddress: request.actor.ipAddress,
        traceId,
        correlationId: runId,
      },
      /**
       * Idempotency at the tool layer, keyed on the RUN and the STEP.
       *
       * A recovered or retried run replays the same key, so the tool layer replays the original
       * outcome instead of performing the side effect twice. Keying on the arguments alone would
       * be wrong for the opposite reason: two legitimately distinct steps that happen to look
       * identical would collapse into one.
       */
      idempotencyKey: `agent:${runId}:${stepIndex}`,
      /**
       * Confirmation is asserted here, and ONLY here, and only for a step that has already
       * survived every gate above: the agent is enabled and live, the environment permits
       * execution, the capability is on the agent's allowlist, the risk is within the agent's
       * ceiling, and the agent is not read-only.
       *
       * The alternative is worse than it looks. `write.confirmation_required` exists to make a
       * HUMAN see a price or a fee before a booking changes; an autonomous run has no human in
       * the loop to show it to, so leaving this false would make every write step terminate in
       * REQUIRES_CONFIRMATION and the agent could never act at all. The consent that matters for
       * an agent is the operator enabling the agent and the plan passing policy — which is what
       * the gates above check. It is never inferred from anything the model said.
       */
      confirmed: true,
    });

    if (result.status === "SUCCESS") {
      const verification = await verifyPostCondition(cap.postCondition, step.arguments, executedAt);
      /**
       * Assessed against the capability's declared policy, which most capabilities do not have.
       * A policy is declared only where the underlying data is genuinely cached or derived and
       * carries its own generation timestamp; on a capability that reads Postgres live, the only
       * timestamp in the payload is the one the handler just stamped, and checking that would be
       * a clock compared against itself.
       */
      const freshness = assessFreshness({ result: result.result, maxAgeMs: cap.freshness?.maxAgeMs });
      metrics.recordAgentFreshness(request.agentId, freshness.verdict);
      metrics.recordAgentVerification(request.agentId, verification.verdict);
      metrics.recordAgentToolCall(request.agentId, "SUCCESS");

      const verified = verification.verdict === "VERIFIED" || verification.verdict === "NOT_APPLICABLE";
      const record: AgentStepRecord = {
        stepIndex,
        phase: verified ? "VERIFY" : "VERIFY",
        capability: step.capability,
        toolId,
        risk: step.risk,
        status: verified ? "VERIFIED" : "VERIFICATION_FAILED",
        policyDecision: result.policyDecision,
        executionId: result.executionId,
        verification: {
          ...(verification as unknown as Record<string, unknown>),
          // Recorded next to the post-condition because an operator reading a step needs both
          // answers: did the write land, and was the data behind it current.
          freshness,
        },
        errorCode: verified ? undefined : "POST_CONDITION_FAILED",
        errorMessage: verified ? undefined : verification.reason,
        durationMs: Date.now() - t0,
      };
      await recordStep(runId, record, { argumentsHash, argumentsPreview: preview });

      if (!verified) {
        // The tool said it worked and the world disagrees. Loud, because this is the class of
        // defect that silently produces "your ticket is resolved" against an open ticket.
        logger.error("agent_post_condition_failed", {
          category: "APPLICATION",
          agentId: request.agentId,
          runId,
          capability: step.capability,
          check: verification.check,
          verdict: verification.verdict,
          observed: verification.observed,
        });
      }
      return { record, consumedToolCall: true, freshness };
    }

    // Everything else the tool layer can return: DENIED, PENDING_APPROVAL, INDETERMINATE,
    // TIMEOUT, FAILED. None of them is success and none is retried here.
    const status =
      result.status === "PENDING_APPROVAL"
        ? "AWAITING_APPROVAL"
        : result.status === "DENIED"
          ? "POLICY_DENIED"
          : result.status === "INDETERMINATE"
            ? "INDETERMINATE"
            : "FAILED";

    metrics.recordAgentToolCall(request.agentId, result.status);

    const record: AgentStepRecord = {
      stepIndex,
      phase: "EXECUTE",
      capability: step.capability,
      toolId,
      risk: step.risk,
      status,
      policyDecision: result.policyDecision,
      executionId: result.executionId,
      approvalId: result.approvalId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      durationMs: Date.now() - t0,
    };
    await recordStep(runId, record, { argumentsHash, argumentsPreview: preview });

    return {
      record,
      approvalId: result.approvalId,
      escalate: result.requiresApproval ? "TOOL_REQUIRES_APPROVAL" : undefined,
      consumedToolCall: true,
    };
  } catch (err) {
    const code = err instanceof ToolExecutionError ? err.code : "EXECUTION_ERROR";
    metrics.recordAgentToolCall(request.agentId, code);
    const record: AgentStepRecord = {
      stepIndex,
      phase: "EXECUTE",
      capability: step.capability,
      toolId,
      risk: step.risk,
      status: "FAILED",
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : "unknown",
      durationMs: Date.now() - t0,
    };
    await recordStep(runId, record, { argumentsHash, argumentsPreview: preview });
    return { record, consumedToolCall: true };
  }
}

/** Exported for the control surface: is this agent currently able to execute? */
export function agentRuntimeReady(): { enabled: boolean; killSwitch: boolean } {
  return { enabled: agentsConfig.enabled, killSwitch: agentsConfig.killSwitch };
}
