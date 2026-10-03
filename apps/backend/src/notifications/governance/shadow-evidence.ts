import crypto from "crypto";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  recordShadowExecution, recordShadowWouldSend, recordShadowWouldSuppress,
  recordShadowWouldDefer, recordShadowConditionFailed, recordShadowBlocked, recordShadowError,
} from "../../lib/automation-metrics";

/**
 * What a shadow workflow would have done, and the record that it did not do it.
 *
 * A rehearsal is only worth running if someone can read the result afterwards, so this is the
 * output of shadow mode rather than a side note to it. It answers one question — "what would this
 * automation have done?" — and deliberately answers nothing else: there is no message here, no
 * address, no phone number, nothing a person could be contacted through.
 *
 * The outcome vocabulary avoids SENT and DELIVERED entirely. Nothing was sent. A row claiming
 * otherwise would be the single most misleading thing this table could contain, and it would look
 * exactly like the truth in a chart.
 */

/**
 * Where this process's rehearsals come from.
 *
 * Read once from the environment, and deliberately not from anything a caller can influence. A
 * request able to declare its own run a test could arrange for its own evidence to be deleted, so
 * the marker is a property of how the process was started and nothing else. Only the exact string
 * "TEST" counts; a typo, an empty value or an absent variable all mean OBSERVATION, because the
 * failure worth avoiding is real evidence quietly classified as disposable.
 *
 * It must never influence a decision. Nothing below reads it except the row it writes.
 */
const EVIDENCE_SOURCE: "TEST" | "OBSERVATION" =
  process.env.AUTOMATION_SHADOW_SOURCE === "TEST" ? "TEST" : "OBSERVATION";

export function shadowEvidenceSource(): "TEST" | "OBSERVATION" {
  return EVIDENCE_SOURCE;
}

export const SHADOW_OUTCOME = {
  WOULD_SEND: "WOULD_SEND",
  WOULD_DEFER: "WOULD_DEFER",
  WOULD_SUPPRESS: "WOULD_SUPPRESS",
  WOULD_BLOCK: "WOULD_BLOCK",
  SKIPPED: "SKIPPED",
  ERROR: "ERROR",
} as const;

export type ShadowOutcome = (typeof SHADOW_OUTCOME)[keyof typeof SHADOW_OUTCOME];

/** The shadow operation's identity. Never a live idempotency key, and never read by live code. */
export function shadowIdentity(instanceId: string, stepId: string, notificationType: string): string {
  return `shadow:${instanceId}:${stepId}:${notificationType}`;
}

export type ShadowEvidenceInput = {
  workflowId: string;
  workflowVersion: number;
  workflowInstanceId?: string;
  shadowIdentity: string;
  triggerEventId?: string;
  subjectType: string;
  subjectId: string;
  recipientType?: string;
  recipientId?: string;
  notificationType?: string;
  category?: NotificationCategory;
  intendedChannel?: NotificationChannel;
  /** The declared fallback order this category would have walked. */
  intendedFallback?: string[];
  conditionResult?: string;
  /** The 6C reason code, unchanged from what live governance produced for the same inputs. */
  governanceResult?: string;
  outcome: ShadowOutcome;
  reasonCode: string;
  reasonText?: string;
  deferredUntil?: Date;
  traceId?: string;
  correlationId?: string;
};

/**
 * Record one rehearsal.
 *
 * The `wouldHave*` flags are derived from the outcome rather than passed in, for the same reason
 * the decision audit derives its decision from its reason: a row saying it would have sent while
 * also saying it was suppressed is not a state any caller should be able to spell.
 *
 * A failure to write is logged and counted, never raised. Shadow mode exists to avoid touching the
 * world; refusing to finish a rehearsal because its notes could not be filed would be a strange way
 * to keep that promise.
 */
export async function recordShadowEvidence(input: ShadowEvidenceInput): Promise<boolean> {
  const shadowExecutionId = crypto.randomUUID();
  try {
    await prisma.automationShadowExecution.create({
      data: {
        shadowExecutionId,
        shadowIdentity: input.shadowIdentity,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        workflowInstanceId: input.workflowInstanceId ?? null,
        executionMode: "SHADOW",
        source: EVIDENCE_SOURCE,
        triggerEventId: input.triggerEventId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        recipientType: input.recipientType ?? null,
        recipientId: input.recipientId ?? null,
        notificationType: input.notificationType ?? null,
        category: input.category ?? null,
        intendedChannel: input.intendedChannel ?? null,
        intendedFallback: input.intendedFallback ?? [],
        conditionResult: input.conditionResult ?? null,
        governanceResult: input.governanceResult ?? null,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText?.slice(0, 500) ?? null,
        wouldHaveSent: input.outcome === SHADOW_OUTCOME.WOULD_SEND,
        wouldHaveDeferred: input.outcome === SHADOW_OUTCOME.WOULD_DEFER,
        wouldHaveSuppressed: input.outcome === SHADOW_OUTCOME.WOULD_SUPPRESS,
        wouldHaveBlocked: input.outcome === SHADOW_OUTCOME.WOULD_BLOCK,
        deferredUntil: input.deferredUntil ?? null,
        traceId: input.traceId ?? null,
        correlationId: input.correlationId ?? null,
      },
    });

    recordShadowExecution(input.workflowId, input.outcome);
    if (input.outcome === SHADOW_OUTCOME.WOULD_SEND) recordShadowWouldSend(input.workflowId);
    else if (input.outcome === SHADOW_OUTCOME.WOULD_SUPPRESS) recordShadowWouldSuppress(input.workflowId, input.reasonCode);
    else if (input.outcome === SHADOW_OUTCOME.WOULD_DEFER) recordShadowWouldDefer(input.workflowId);
    else if (input.outcome === SHADOW_OUTCOME.WOULD_BLOCK) recordShadowBlocked(input.workflowId, input.reasonCode);
    else if (input.outcome === SHADOW_OUTCOME.ERROR) recordShadowError(input.workflowId, input.reasonCode);
    if (input.conditionResult && input.conditionResult !== "PASSED") {
      recordShadowConditionFailed(input.workflowId, input.conditionResult);
    }
    return true;
  } catch (err) {
    recordShadowError(input.workflowId, "EVIDENCE_WRITE_FAILED");
    logger.error("shadow_evidence_write_failed", {
      workflowId: input.workflowId,
      outcome: input.outcome,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return false;
  }
}
