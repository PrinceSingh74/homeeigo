import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { evaluateFlag } from "../../services/feature-flag.service";
import { consumeRateLimitSmart } from "../../middleware/rate-limit.middleware";
import { agentsConfig, executionEnvironmentAllowed } from "../config";
import { effectiveBounds, getAgentDefinition } from "../registry/agent-registry";
import type { AgentId, AgentRunMode, AgentTrigger } from "../types";

/**
 * Whether an agent may start a run at all, and if so in which mode.
 *
 * Ordered so the cheapest and most absolute refusals come first, and so that every "no" is
 * distinguishable in the audit: "the kill switch is on" and "this environment may not execute"
 * are different operational facts and must not collapse into one reason string.
 *
 * The important shape here is that a refusal to EXECUTE is not a refusal to RUN. An agent that
 * is disabled, or in an environment that may not execute, still plans — in SHADOW. That is what
 * makes shadow evaluation possible before anyone is asked to trust the agent with a side
 * effect, and it means the safe configuration is also the useful one.
 */

export type AgentAdmission =
  | { ok: true; mode: AgentRunMode; reason: string }
  | { ok: false; code: AgentAdmissionRefusal; reason: string };

export type AgentAdmissionRefusal =
  | "AGENTS_DISABLED"
  | "KILL_SWITCH"
  | "RATE_LIMITED"
  | "RECURSION_DEPTH_EXCEEDED"
  | "RECURSION_CYCLE_DETECTED"
  | "DUPLICATE_RUN";

/**
 * A run's stable identity, so the same trigger cannot produce two runs.
 *
 * Built from the agent, the trigger reference and the subject. A replayed event, a duplicated
 * delivery and two workers racing the same message all produce the same key, and the unique
 * index on `agent_runs.idempotency_key` turns that into exactly one run.
 *
 * MANUAL runs deliberately get no key: a human asking the same question twice means it twice.
 */
export function runIdempotencyKey(agentId: AgentId, trigger: AgentTrigger): string | undefined {
  if (trigger.type === "MANUAL") return undefined;
  if (!trigger.ref) return undefined;
  const subject = trigger.subjectType && trigger.subjectId
    ? `${trigger.subjectType}:${trigger.subjectId}`
    : "no-subject";
  return `agent:${agentId}:${trigger.type}:${trigger.ref}:${subject}`;
}

/**
 * Refuse chains that would let an agent re-trigger itself.
 *
 * Two independent checks, because they catch different failures. Depth catches an unbounded
 * chain even when every link is a *different* agent (A → B → A → B …), which a same-agent
 * check alone would miss. The ancestry walk catches a cycle that is still within the depth
 * limit — the tight `agent → workflow → event → same agent` loop §30 names, which would
 * otherwise run to the depth ceiling on every event rather than being refused at the first
 * repeat.
 *
 * The walk is bounded by `maxDepth + 1` iterations, so a corrupt parent chain cannot itself
 * become an infinite loop inside the loop guard.
 */
async function checkRecursion(
  agentId: AgentId,
  trigger: AgentTrigger,
): Promise<{ ok: true } | { ok: false; code: AgentAdmissionRefusal; reason: string }> {
  const bounds = effectiveBounds(agentId);
  const depth = trigger.depth ?? 0;

  if (depth > bounds.maxDepth) {
    return {
      ok: false,
      code: "RECURSION_DEPTH_EXCEEDED",
      reason: `Causation depth ${depth} exceeds limit ${bounds.maxDepth}`,
    };
  }

  if (!trigger.parentRunId) return { ok: true };

  let cursor: string | null = trigger.parentRunId;
  for (let hop = 0; hop <= bounds.maxDepth + 1 && cursor; hop += 1) {
    const parent: { agentId: string; parentRunId: string | null } | null =
      await prisma.agentRun.findUnique({
        where: { runId: cursor },
        select: { agentId: true, parentRunId: true },
      });
    if (!parent) break;
    if (parent.agentId === agentId) {
      return {
        ok: false,
        code: "RECURSION_CYCLE_DETECTED",
        reason: `Agent ${agentId} already appears in this causation chain (run ${cursor})`,
      };
    }
    cursor = parent.parentRunId;
  }

  return { ok: true };
}

/**
 * Per-agent start rate limit.
 *
 * Keyed on the agent rather than the actor, because the failure this prevents is an event storm
 * or a retry storm — many different actors, or none, driving one agent. An actor-keyed limit
 * would let a thousand distinct trigger events start a thousand runs.
 */
async function checkRateLimit(agentId: AgentId): Promise<boolean> {
  const result = await consumeRateLimitSmart(
    `agent:start:${agentId}`,
    agentsConfig.rateLimitPerMinute,
    60_000,
  );
  return result.allowed;
}

export async function admitAgentRun(params: {
  agentId: AgentId;
  trigger: AgentTrigger;
  forceShadow?: boolean;
  /** Subject for percentage rollout. The agent id when there is no human in the loop. */
  rolloutSubject?: string;
}): Promise<AgentAdmission> {
  const { agentId, trigger, forceShadow } = params;
  const def = getAgentDefinition(agentId);

  // The whole layer off means nothing runs, not even shadow. A disabled subsystem that still
  // calls a model provider is still spending money and still touching data.
  if (!agentsConfig.enabled) {
    return { ok: false, code: "AGENTS_DISABLED", reason: "AGENTS_ENABLED is not true" };
  }

  // The kill switch stops NEW runs outright — §38. Shadow is not a loophole here: an operator
  // pulling the switch means "stop", and "we only planned, we did not act" is not what they
  // asked for.
  if (agentsConfig.killSwitch) {
    return { ok: false, code: "KILL_SWITCH", reason: "AGENTS_KILL_SWITCH is engaged" };
  }

  if (!(await checkRateLimit(agentId))) {
    return { ok: false, code: "RATE_LIMITED", reason: `Agent ${agentId} start rate limit exceeded` };
  }

  const recursion = await checkRecursion(agentId, trigger);
  if (!recursion.ok) return recursion;

  if (forceShadow) {
    return { ok: true, mode: "SHADOW", reason: "SHADOW_REQUESTED" };
  }

  // An unrecognised environment lands here as "not permitted" — the allowlist is what makes an
  // unreviewed environment fail closed rather than inherit production behaviour.
  const env = executionEnvironmentAllowed();
  if (!env.allowed) {
    return { ok: true, mode: "SHADOW", reason: `SHADOW_ENV:${env.reason}` };
  }

  // A missing flag row is FLAG_MISSING → disabled. That is the intended default for all five
  // agents: they ship with no row at all, and provisioning one is a separate deliberate act.
  const flag = await evaluateFlag(def.flagKey, params.rolloutSubject ?? agentId).catch((err) => {
    // A flag store that cannot be read is not permission to execute. Failing open here would
    // mean a Redis outage silently promoted every agent to live.
    logger.warn("agent_flag_lookup_failed", {
      category: "APPLICATION",
      agentId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { enabled: false, reason: "LOOKUP_FAILED" as const };
  });

  if (!flag.enabled) {
    return { ok: true, mode: "SHADOW", reason: `SHADOW_FLAG:${flag.reason}` };
  }

  return { ok: true, mode: "LIVE", reason: `LIVE:${env.reason}` };
}

/**
 * Is this specific step permitted to execute, given the run's mode and the agent's ceiling?
 *
 * Separate from admission because admission answers "may this run start" once, while this
 * answers "may this side effect happen" for every step — and the answer legitimately differs
 * step by step within one admitted run.
 */
export type StepDisposition =
  | { action: "EXECUTE" }
  | { action: "SHADOW"; reason: string }
  | { action: "ESCALATE"; reason: string };

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

export function disposeStep(params: {
  agentId: AgentId;
  mode: AgentRunMode;
  stepRisk: "LOW" | "MEDIUM" | "HIGH";
  isWrite: boolean;
}): StepDisposition {
  const def = getAgentDefinition(params.agentId);

  // A read-only agent never executes a side effect, whatever the plan, the mode or the tier.
  // This is the last of three independent places that enforce it (registry load, plan
  // validation, here) and the only one that sees the actual execution decision.
  if (def.readOnly && params.isWrite) {
    return { action: "ESCALATE", reason: "READ_ONLY_AGENT" };
  }

  // HIGH is always a human's decision. Not "usually", not "unless configured" — an agent has no
  // path to autonomous high-risk execution anywhere in this runtime.
  if (params.stepRisk === "HIGH") {
    return { action: "ESCALATE", reason: "HIGH_RISK_REQUIRES_HUMAN" };
  }

  if (RISK_ORDER[params.stepRisk] > RISK_ORDER[def.maxAutonomousRisk]) {
    return { action: "ESCALATE", reason: `EXCEEDS_AGENT_CEILING:${def.maxAutonomousRisk}` };
  }

  if (params.mode === "SHADOW") {
    return { action: "SHADOW", reason: "SHADOW_MODE" };
  }

  return { action: "EXECUTE" };
}
