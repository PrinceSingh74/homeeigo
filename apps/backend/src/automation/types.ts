import type { WorkflowStepType } from "@prisma/client";

/**
 * Phase 6A — workflow shapes.
 *
 * Definitions are written in code, not in the database. A row in `workflow_definitions` is a
 * frozen copy of what was activated, kept so a running instance can be pinned to the exact
 * version it started under — never a source of behaviour. Nothing here is interpreted as code,
 * so a database row can never introduce a new action.
 */

/** Steps a workflow can take. 6A executes WAIT and STOP; the rest are declared and fail closed. */
export type WorkflowStep =
  | { id: string; type: "WAIT"; delayMs: number }
  | { id: string; type: "STOP"; reasonCode?: string }
  /**
   * Declared in 6A, executed in 6B. Until the condition engine exists these fail closed rather
   * than defaulting to true — a half-built condition that silently passes would send real
   * messages on an assumption nobody checked.
   */
  | { id: string; type: "CONDITION"; conditionId: string }
  | { id: string; type: "ACTION"; actionId: string; args?: Record<string, unknown> }
  /**
   * `notificationType` keys into the notification template registry — not a template id, because
   * the platform picks the version, channel and language. `variables` names the fields to lift
   * from the instance's metadata; the step never carries a rendered message or a contact detail.
   */
  | {
      id: string;
      type: "NOTIFICATION";
      notificationType: string;
      recipient: "SUBJECT_CUSTOMER" | "SUBJECT_PARTNER";
      variables?: string[];
      /**
       * Re-evaluated immediately before sending, and again after any quiet-hours deferral.
       *
       * Opt-in, because most notifications are still worth sending when they finally go out. It
       * exists for the ones that are not: a review reminder held overnight is pointless if the
       * customer rated the job at 07:30, and sending it anyway is worse than not sending at all.
       * The step's own position in the workflow is unchanged — this is a second look at the same
       * question, not a rewind to an earlier CONDITION step.
       */
      recheckConditionId?: string;
    }
  | { id: string; type: "ESCALATION"; target: string; reasonCode?: string };

export type WorkflowDefinitionInput = {
  workflowId: string;
  version: number;
  name: string;
  /** Event type that starts this workflow, e.g. "homigo.payment.failed". */
  trigger: string;
  steps: WorkflowStep[];
  /** Guards against immortal instances — both enforced by the step executor on every step. */
  maxAgeMs: number;
  maxSteps: number;
  metadata?: Record<string, unknown>;
};

/** Outcomes recorded per step. Shared vocabulary with the decision audit added in 6C. */
export const STEP_OUTCOME = {
  ADVANCED: "ADVANCED",
  WAITING: "WAITING",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
  SKIPPED: "SKIPPED",
  CONDITION_FAILED: "CONDITION_FAILED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  /** Held back to a later time. The step did not advance and was not counted. */
  DEFERRED: "DEFERRED",
  MAX_AGE_EXCEEDED: "MAX_AGE_EXCEEDED",
  MAX_STEPS_EXCEEDED: "MAX_STEPS_EXCEEDED",
  ERROR: "ERROR",
} as const;

export type StepOutcome = (typeof STEP_OUTCOME)[keyof typeof STEP_OUTCOME];

export type StartInstanceInput = {
  workflowId: string;
  subjectType: string;
  subjectId: string;
  triggerEventId?: string;
  traceId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export type { WorkflowStepType };
