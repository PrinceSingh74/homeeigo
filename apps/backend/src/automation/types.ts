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
  /**
   * Whether this workflow acts, or only works out what it would have done.
   *
   * Absent means LIVE, so every workflow written before shadow mode existed keeps behaving exactly
   * as it did. A shadow workflow runs the same conditions, the same governance and the same channel
   * selection; only the three points where the world changes — the delivery claim, the cadence
   * reservation and the provider call — are replaced by evidence.
   *
   * Not part of the step fingerprint: it says how a definition runs, not what it does, so flipping
   * it does not count as editing an activated version.
   */
  executionMode?: "LIVE" | "SHADOW";
  /**
   * Present only on Phase-6G business automations, and its absence is meaningful.
   *
   * A definition without a risk class is a legacy workflow — the engine self-test, anything written
   * before 6G — and the certification gate deliberately does not apply to it. Declaring a class is
   * how a definition opts into being governed; it is not itself permission to act.
   */
  riskClass?: "LOW" | "MEDIUM" | "HIGH";
  /**
   * How far this version has travelled from idea to permission. Separate from `executionMode`:
   * CERTIFIED + SHADOW is a real and normal state, and the one every automation passes through.
   */
  certificationStatus?: "DRAFT" | "SHADOW" | "CERTIFIED" | "DISABLED" | "DEPRECATED";
  /** Guards against immortal instances — both enforced by the step executor on every step. */
  maxAgeMs: number;
  maxSteps: number;
  metadata?: Record<string, unknown>;
};

/**
 * Action names that move money or account state.
 *
 * Lives here rather than beside either of its users because both need it and neither owns it: the
 * shadow guard in the step executor refuses to simulate them, and the 6G registry refuses to let a
 * LOW or MEDIUM workflow contain one. Matched by substring so a later `refund_partial` or
 * `wallet_adjust_v2` is caught by the same net rather than having to be remembered.
 */
export const HIGH_RISK_ACTIONS = ["refund", "payout", "settle", "wallet", "ledger", "freeze"] as const;

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
