import prisma from "../../lib/prisma";
import { routeNotification } from "../../notifications/router";
import { getCondition } from "../conditions/condition-registry";
import { evaluateCondition } from "../conditions/evaluator";
import type { RouteResult } from "../../notifications/types";

/**
 * Turns a workflow NOTIFICATION step into a routed notification.
 *
 * The step names a message type and *which* party to reach, never a person and never a contact
 * detail. Resolving "the customer on this booking" happens here, from the instance's own bound
 * subject, so a workflow cannot address someone it is not about — the same subject-scoping rule
 * Phase 6B applies to conditions, applied to delivery.
 *
 * Variables are lifted from instance metadata by name, and only the names the step declares. The
 * router then validates them against the template's own schema, so an undeclared or wrongly typed
 * value is refused rather than rendered.
 */

export type NotificationStepSpec = {
  notificationType: string;
  recipient: "SUBJECT_CUSTOMER" | "SUBJECT_PARTNER";
  variables?: string[];
  /** Re-evaluated immediately before routing, so a resumed notification is judged on today's facts. */
  recheckConditionId?: string;
};

export type NotificationStepOutcome =
  | { ok: true; result: RouteResult }
  | { ok: false; reasonCode: string }
  /** The reason for sending no longer holds. Distinct from a failure — nothing went wrong. */
  | { ok: false; reasonCode: "RECHECK_CONDITION_FAILED"; conditionReason: string; conditionDetail?: string };

/** Resolves the addressee from the instance's subject. */
async function resolveFromSubject(
  subjectType: string,
  subjectId: string,
  recipient: NotificationStepSpec["recipient"],
): Promise<{ recipientType: "CUSTOMER" | "PARTNER"; recipientId: string } | null> {
  if (subjectType === "provider") {
    if (recipient === "SUBJECT_PARTNER") {
      return { recipientType: "PARTNER", recipientId: subjectId };
    }
    return null;
  }

  if (subjectType !== "booking") return null;

  const booking = await prisma.booking.findUnique({
    where: { id: subjectId },
    select: { userId: true, providerId: true },
  });
  if (!booking) return null;

  if (recipient === "SUBJECT_CUSTOMER") {
    return booking.userId ? { recipientType: "CUSTOMER", recipientId: booking.userId } : null;
  }
  return booking.providerId ? { recipientType: "PARTNER", recipientId: booking.providerId } : null;
}

/**
 * Template variables a workflow's own subject can supply.
 *
 * Deliberately a short allowlist rather than "whatever is on the row". A template must not be able
 * to pull an address or a phone number into a message body by naming the field, and the platform's
 * whole contract is that contact details are resolved inside the notification platform and nowhere
 * else. Only values a message legitimately quotes back to the person belong here.
 */
async function resolveSubjectVariables(
  subjectType: string,
  subjectId: string,
): Promise<Record<string, unknown>> {
  if (subjectType === "provider") {
    const provider = await prisma.provider.findUnique({
      where: { id: subjectId },
      select: {
        user: { select: { firstName: true } },
        documents: { select: { documentType: true, expiryDate: true }, orderBy: { expiryDate: "asc" }, take: 1 },
      },
    });
    const failedWithdrawal = await prisma.withdrawal.findFirst({
      where: { providerId: subjectId, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      select: { withdrawalNumber: true },
    });
    const base: Record<string, unknown> = provider?.user?.firstName
      ? { partnerName: provider.user.firstName }
      : { partnerName: "Partner" };
    if (provider?.documents[0]?.documentType) {
      base.documentType = provider.documents[0].documentType;
    } else {
      base.documentType = "compliance document";
    }
    if (failedWithdrawal?.withdrawalNumber) {
      base.withdrawalNumber = failedWithdrawal.withdrawalNumber;
    } else {
      base.withdrawalNumber = "—";
    }
    return base;
  }

  if (subjectType !== "booking") return {};

  const booking = await prisma.booking.findUnique({
    where: { id: subjectId },
    select: {
      bookingNumber: true,
      provider: { select: { user: { select: { firstName: true } } } },
    },
  });
  if (!booking) return {};
  // Partner-addressed templates all require `partnerName`; a booking subject can supply it from
  // its assigned provider. Still only a first name — the allowlist above applies.
  return {
    bookingNumber: booking.bookingNumber,
    partnerName: booking.provider?.user?.firstName ?? "Partner",
  };
}

export async function executeNotificationStep(input: {
  instanceId: string;
  workflowId: string;
  workflowVersion: number;
  stepId: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  spec: NotificationStepSpec;
  /** LIVE acts; SHADOW works out what it would have done. Pinned on the instance, never guessed. */
  executionMode?: "LIVE" | "SHADOW";
  /** The event that started the instance, carried so shadow evidence can name its origin. */
  triggerEventId?: string;
  traceId?: string;
  correlationId?: string;
}): Promise<NotificationStepOutcome> {
  const addressee = await resolveFromSubject(input.subjectType, input.subjectId, input.spec.recipient);
  if (!addressee) return { ok: false, reasonCode: "RECIPIENT_UNRESOLVABLE" };

  /**
   * A last look at whether this is still worth sending.
   *
   * The step may have been written hours ago and deferred overnight, and the world does not hold
   * still while a notification waits. A review reminder queued at 20:45 and held until 08:00 is
   * actively unwelcome if the customer rated the job at 07:30 — and the only thing standing between
   * that and the customer's phone is asking again rather than trusting the answer from last night.
   *
   * Opt-in by step, and evaluated by the existing Phase 6B engine against the instance's own bound
   * subject, so a re-check cannot read anything the workflow was not already about.
   */
  /**
   * What the re-check actually said, for the record.
   *
   * "No condition was configured" and "the condition passed" are different statements, and a blank
   * field says neither — the first real observation recorded exactly that blank and left the
   * evidence unable to answer why the message was judged still worth sending.
   */
  let conditionResult = "NOT_RECHECKED";

  if (input.spec.recheckConditionId) {
    const condition = getCondition(input.spec.recheckConditionId);
    if (!condition) {
      // A named check that does not exist must not be read as "the check passed".
      return { ok: false, reasonCode: "RECHECK_CONDITION_NOT_REGISTERED" };
    }
    const verdict = await evaluateCondition(condition, {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    });
    if (!verdict.passed) {
      return {
        ok: false,
        reasonCode: "RECHECK_CONDITION_FAILED",
        conditionReason: verdict.reason,
        conditionDetail: verdict.detail,
      };
    }
    conditionResult = "PASSED";
  }

  /**
   * Variables come from the instance's metadata, and from the subject it is already bound to.
   *
   * Metadata alone was not enough, and shadow mode is how that surfaced. A trigger deliberately
   * stores almost nothing on the instance — subject, trace, correlation — so an event payload never
   * becomes a copy of customer data sitting in a workflow row. But a template that asks for the
   * booking number then finds `undefined`, fails schema validation, and the notification is skipped.
   * Live, that automation would have sent nothing at all, for every customer, and the only trace
   * would have been a reason code in an audit table.
   *
   * Reading the field from the subject fixes it without reopening that decision: the booking is the
   * one this workflow is already about, it is the same row the recipient was resolved from, and the
   * value is a booking number rather than anything about a person.
   */
  const subjectVariables = await resolveSubjectVariables(input.subjectType, input.subjectId);

  const variables: Record<string, unknown> = {};
  for (const name of input.spec.variables ?? []) {
    variables[name] = input.metadata[name] ?? subjectVariables[name];
  }

  /**
   * Operation identity for the send.
   *
   * Built from the workflow instance and step, never from the message or the recipient: two
   * instances acting on the same booking are two distinct operations and must each be allowed to
   * send, while a retry of the same step must not.
   */
  const idempotencyKey = `wf:${input.instanceId}:${input.stepId}:${input.spec.notificationType}`;

  /**
   * The workflow's identity travels with the request.
   *
   * Without it the router has a notification and no idea which conversation it belongs to, so the
   * only limit it can apply is the recipient's daily allowance — a review reminder could then be
   * sent every hour and each one would look perfectly within policy. Naming the workflow is what
   * gives cooldown something to be a cooldown of.
   */
  const result = await routeNotification({
    recipientType: addressee.recipientType,
    recipientId: addressee.recipientId,
    notificationType: input.spec.notificationType,
    variables,
    idempotencyKey,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    workflowInstanceId: input.instanceId,
    executionMode: input.executionMode,
    shadowStepId: input.stepId,
    triggerEventId: input.triggerEventId,
    conditionResult,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    traceId: input.traceId,
    correlationId: input.correlationId,
  });

  return { ok: true, result };
}
