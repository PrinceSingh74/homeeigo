import type { AgentRunStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { agentsConfig } from "../config";
import type { AgentId, AgentStepRecord } from "../types";

/**
 * Persistence and the run state machine.
 *
 * The state machine is enforced here rather than trusted to callers. An agent run is the record
 * of an authorisation decision and a side effect, so "how did this run reach COMPLETED" has to
 * be answerable from the rows alone — which it is not if any code path can set any status.
 */

/**
 * Legal transitions. Anything absent is refused.
 *
 * Terminal states have no outgoing edges at all, deliberately: a COMPLETED run that can be
 * moved back to EXECUTING is a run whose audit trail can be rewritten after the fact.
 */
const TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  CREATED: ["PLANNING", "CANCELLED", "FAILED", "TIMED_OUT"],
  PLANNING: ["WAITING_POLICY", "FAILED", "CANCELLED", "TIMED_OUT", "ESCALATED"],
  WAITING_POLICY: ["EXECUTING", "ESCALATED", "FAILED", "CANCELLED", "TIMED_OUT", "COMPLETED"],
  WAITING_APPROVAL: ["EXECUTING", "ESCALATED", "CANCELLED", "TIMED_OUT", "FAILED"],
  EXECUTING: ["VERIFYING", "WAITING_APPROVAL", "FAILED", "ESCALATED", "CANCELLED", "TIMED_OUT", "ROLLED_BACK"],
  VERIFYING: ["COMPLETED", "FAILED", "ESCALATED", "TIMED_OUT", "ROLLED_BACK"],
  COMPLETED: [],
  FAILED: [],
  ESCALATED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  ROLLED_BACK: [],
};

export class AgentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStateError";
  }
}

export function transitionAllowed(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: AgentRunStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export type CreateRunInput = {
  runId: string;
  agentId: AgentId;
  agentVersion: string;
  promptVersion: string;
  policyVersion: string;
  toolsetVersion: string;
  mode: "SHADOW" | "LIVE";
  actorId: string;
  actorRole: Prisma.AgentRunCreateInput["actorRole"];
  triggerType: string;
  triggerRef?: string;
  subjectType?: string;
  subjectId?: string;
  traceId: string;
  causationId?: string;
  parentRunId?: string;
  depth: number;
  goal: string;
  idempotencyKey?: string;
  metadata?: Prisma.InputJsonValue;
};

export type CreateRunResult =
  | { created: true; runId: string }
  /** An equivalent run already exists for this trigger. The existing run id is returned. */
  | { created: false; runId: string; reason: "DUPLICATE" };

/**
 * Create a run, or discover that this trigger already has one.
 *
 * The uniqueness is enforced by the database, not by a preceding read: a check-then-insert
 * loses the race that matters most here — two workers handed the same replayed event at the
 * same moment — and losing it means two runs, two plans and potentially two side effects for
 * one real-world cause.
 */
export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  try {
    await prisma.agentRun.create({
      data: {
        runId: input.runId,
        agentId: input.agentId,
        agentVersion: input.agentVersion,
        promptVersion: input.promptVersion,
        policyVersion: input.policyVersion,
        toolsetVersion: input.toolsetVersion,
        mode: input.mode,
        status: "CREATED",
        actorId: input.actorId,
        actorRole: input.actorRole,
        triggerType: input.triggerType,
        triggerRef: input.triggerRef,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        traceId: input.traceId,
        causationId: input.causationId,
        parentRunId: input.parentRunId,
        depth: input.depth,
        goal: input.goal,
        idempotencyKey: input.idempotencyKey,
        heartbeatAt: new Date(),
        metadata: input.metadata,
      },
    });
    return { created: true, runId: input.runId };
  } catch (err) {
    // P2002 on `idempotency_key` is the expected outcome for a duplicate trigger, not an error.
    const code = (err as { code?: string }).code;
    if (code === "P2002" && input.idempotencyKey) {
      const existing = await prisma.agentRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { runId: true },
      });
      if (existing) return { created: false, runId: existing.runId, reason: "DUPLICATE" };
    }
    throw err;
  }
}

/**
 * Advance a run, refusing illegal transitions.
 *
 * The status guard is part of the WHERE clause, so the check and the write are one atomic
 * operation. Reading the status first and then updating would let two processes both observe
 * EXECUTING and both advance it.
 */
export async function transitionRun(
  runId: string,
  to: AgentRunStatus,
  patch: Prisma.AgentRunUpdateInput = {},
): Promise<void> {
  const current = await prisma.agentRun.findUnique({
    where: { runId },
    select: { status: true },
  });
  if (!current) throw new AgentStateError(`Run ${runId} not found`);

  if (current.status === to) return;

  if (!transitionAllowed(current.status, to)) {
    throw new AgentStateError(`Illegal agent run transition ${current.status} → ${to} (run ${runId})`);
  }

  const result = await prisma.agentRun.updateMany({
    where: { runId, status: current.status },
    data: {
      ...(patch as Prisma.AgentRunUpdateManyMutationInput),
      status: to,
      heartbeatAt: new Date(),
      ...(isTerminal(to) ? { completedAt: new Date() } : {}),
    },
  });

  if (result.count === 0) {
    // Someone else moved it between the read and the write. Refuse rather than retry: the other
    // writer may have terminated the run, and forcing this transition would overwrite that.
    throw new AgentStateError(`Run ${runId} changed underneath transition to ${to}`);
  }
}

/** Keep the lease alive during a long step so recovery does not steal an active run. */
export async function heartbeat(runId: string): Promise<void> {
  await prisma.agentRun
    .updateMany({ where: { runId }, data: { heartbeatAt: new Date() } })
    .catch((err) => {
      // A missed heartbeat costs a recovery sweep later; it must never fail the step in flight.
      logger.warn("agent_heartbeat_failed", {
        category: "APPLICATION",
        runId,
        error: err instanceof Error ? err.message : "unknown",
      });
    });
}

/**
 * Write one step row.
 *
 * `argumentsHash` and `argumentsPreview` are optional because a step legitimately may have no
 * arguments to record — a PLAN or ESCALATE phase row, or a capability that takes none. They are
 * accepted here already redacted; this function does not redact, so that redaction lives in
 * exactly one place and cannot be half-applied by a caller that forgot.
 */
export async function recordStep(
  runId: string,
  step: AgentStepRecord,
  args?: { argumentsHash: string; argumentsPreview: Record<string, unknown> },
): Promise<void> {
  await prisma.agentRunStep.create({
    data: {
      runId,
      stepIndex: step.stepIndex,
      phase: step.phase,
      capability: step.capability,
      toolId: step.toolId,
      argumentsHash: args?.argumentsHash,
      argumentsPreview: args?.argumentsPreview as Prisma.InputJsonValue | undefined,
      riskTier: step.risk,
      policyDecision: step.policyDecision,
      status: step.status,
      executionId: step.executionId,
      approvalId: step.approvalId,
      verification: step.verification as Prisma.InputJsonValue | undefined,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage?.slice(0, 500),
      durationMs: step.durationMs,
    },
  });
}

export async function getRun(runId: string) {
  return prisma.agentRun.findUnique({
    where: { runId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
}

/**
 * Runs abandoned by a dead process.
 *
 * Non-terminal, and no heartbeat within the lease. Returned rather than auto-restarted: §37 is
 * explicit that recovery must not blindly re-run from step zero, and this layer cannot know
 * whether the pending step's side effect landed. The caller decides, with the persisted steps
 * in front of it.
 */
export async function findOrphanedRuns(limit = 25) {
  const cutoff = new Date(Date.now() - agentsConfig.leaseMs);
  return prisma.agentRun.findMany({
    where: {
      status: { in: ["CREATED", "PLANNING", "WAITING_POLICY", "EXECUTING", "VERIFYING"] },
      heartbeatAt: { lt: cutoff },
    },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
    orderBy: { heartbeatAt: "asc" },
    take: limit,
  });
}
