import crypto from "crypto";
import type { Prisma, NotificationCategory, NotificationChannel } from "@prisma/client";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { recordDecisionAudited, recordDecisionAuditFailed } from "../../lib/notification-metrics";
import { decisionFor, type GovernanceReason } from "./policy";
import type { RecipientType } from "../types";

/**
 * Why a notification was allowed, held or refused — written once per governance evaluation.
 *
 * `NotificationDelivery` answers what became of a delivery. This answers why the delivery was ever
 * attempted, and it has to be a separate record because the two have different lifetimes: a
 * quiet-hours deferral releases its delivery row, so without this table the only trace that anyone
 * ever decided anything would be a log line nobody can query.
 *
 * ── What it is not ────────────────────────────────────────────────────────────
 *
 * A decision log, not a message archive. No body, no rendered title, no template variables, no
 * email, no phone, no OTP, no provider payload. Everything here is an identifier or an outcome. The
 * temptation with an audit table is always to store "just a bit of context" so a future
 * investigation is easier, and that is how a decision log quietly becomes the least protected copy
 * of everyone's contact details.
 *
 * ── Why the decision is derived ───────────────────────────────────────────────
 *
 * Callers name a *reason* and never a decision; `decisionFor` supplies the decision. A row reading
 * `ALLOWED` beside `RECIPIENT_DAILY_CAP` is therefore not something a careless branch can produce,
 * because no branch chooses both.
 */

export type DecisionAuditInput = {
  reason: GovernanceReason;
  recipientType: RecipientType;
  recipientId: string;
  notificationType: string;
  category: NotificationCategory;
  idempotencyKey: string;
  /** Absent for a deferral — the claim has been released by then. */
  notificationId?: string;
  workflowId?: string;
  workflowVersion?: number;
  workflowInstanceId?: string;
  /** Only once a specific channel has been settled on. Null before that, never guessed. */
  channelIntent?: NotificationChannel;
  /** Short, non-identifying context. Truncated rather than trusted. */
  reasonText?: string;
  deferredUntil?: Date;
  traceId?: string;
  correlationId?: string;
};

function toRow(input: DecisionAuditInput): Prisma.NotificationDecisionAuditCreateInput {
  return {
    decisionId: crypto.randomUUID(),
    notificationId: input.notificationId ?? null,
    idempotencyKey: input.idempotencyKey,
    workflowId: input.workflowId ?? null,
    workflowVersion: input.workflowVersion ?? null,
    workflowInstanceId: input.workflowInstanceId ?? null,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    notificationType: input.notificationType,
    category: input.category,
    channelIntent: input.channelIntent ?? null,
    decision: decisionFor(input.reason),
    reasonCode: input.reason,
    reasonText: input.reasonText?.slice(0, 500) ?? null,
    deferredUntil: input.deferredUntil ?? null,
    traceId: input.traceId ?? null,
    correlationId: input.correlationId ?? null,
  };
}

/**
 * Record a decision that stands on its own — a suppression or a deferral.
 *
 * These are safe to write outside a transaction: the answer was already "do not send", so losing
 * the row loses the explanation but cannot cause anyone to be messaged. A failure is therefore
 * counted and logged rather than raised, because refusing to suppress a notification on the grounds
 * that the suppression could not be written down would be the worse outcome of the two.
 *
 * Returns whether the row was written, so a caller can tell "audited" from "decided but unrecorded"
 * instead of assuming the log is complete.
 */
export async function recordDecision(input: DecisionAuditInput): Promise<boolean> {
  try {
    await prisma.notificationDecisionAudit.create({ data: toRow(input) });
    recordDecisionAudited(input.notificationType, decisionFor(input.reason));
    return true;
  } catch (err) {
    recordDecisionAuditFailed(input.notificationType, decisionFor(input.reason));
    logger.error("notification_decision_audit_failed", {
      notificationType: input.notificationType,
      reason: input.reason,
      workflowId: input.workflowId,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return false;
  }
}

/**
 * Record an ALLOWED decision inside the transaction that granted the slot.
 *
 * This one cannot be written afterwards. A reservation that commits and an audit row that then
 * fails leaves a recipient's allowance spent with no record of why — the exact state a decision log
 * exists to make impossible, and one that would be invisible until someone asked why the numbers
 * did not add up. Sharing the transaction means the grant and its explanation land together or
 * neither does; a failure here rolls the reservation back and the notification is not sent.
 */
export async function recordDecisionWithin(
  tx: Prisma.TransactionClient,
  input: DecisionAuditInput,
): Promise<void> {
  await tx.notificationDecisionAudit.create({ data: toRow(input) });
  recordDecisionAudited(input.notificationType, decisionFor(input.reason));
}
