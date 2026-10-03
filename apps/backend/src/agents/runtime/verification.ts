import prisma from "../../lib/prisma";
import type { PostConditionSpec } from "../types";

/**
 * Did the effect the step claimed actually happen?
 *
 * A tool returning SUCCESS means the handler resolved. It does not mean the world changed: a
 * service can report success and be rolled back by an outer transaction, a downstream write can
 * be applied to a stale replica, and a handler that returns a value without asserting anything
 * about it will report success for a no-op. §14 exists because "the tool said it worked" is a
 * claim, and a claim about a side effect is worth re-reading the database for.
 *
 * The checks below are named and implemented HERE. A post-condition supplied by the model would
 * be the model marking its own homework, so the capability declares which of these fixed checks
 * applies and nothing more.
 *
 * The verdicts are deliberately three-valued. `UNKNOWN` is not a pass: it means the check could
 * not be performed, which is exactly the state that must not be rounded up to success — an
 * agent that treats "I could not tell" as "it worked" will happily report a resolved ticket
 * that is still open.
 */

export type VerificationVerdict = "VERIFIED" | "FAILED" | "UNKNOWN" | "NOT_APPLICABLE";

export type VerificationResult = {
  verdict: VerificationVerdict;
  check: string;
  /** What was actually observed, for the operator timeline. */
  observed?: string;
  expected?: string;
  reason?: string;
  checkedAt: string;
};

function result(
  check: string,
  verdict: VerificationVerdict,
  extra: Partial<VerificationResult> = {},
): VerificationResult {
  return { check, verdict, checkedAt: new Date().toISOString(), ...extra };
}

/**
 * Statuses that count as "this ticket has been resolved".
 *
 * A set rather than a single value because the platform distinguishes RESOLVED from CLOSED and
 * both satisfy the agent's intent. Hard-coding one of them would make a correct resolution
 * verify as a failure whenever the service chose the other.
 */
const RESOLVED_TICKET_STATUSES = new Set(["RESOLVED", "CLOSED"]);

/**
 * Priorities that count as "this ticket has been escalated".
 *
 * `SupportPriorityLevel` currently tops out at HIGH, so this is a one-element set today. It is a
 * set anyway so that a future tier above HIGH satisfies an escalation rather than failing one.
 */
const ESCALATED_TICKET_PRIORITIES = new Set(["HIGH"]);

export async function verifyPostCondition(
  spec: PostConditionSpec | undefined,
  args: Record<string, unknown>,
  executedAt: Date,
): Promise<VerificationResult> {
  if (!spec) {
    // A write with no post-condition never reaches here — the registry refuses to load such a
    // capability and the validator refuses such a plan. Reaching this branch means one of those
    // was bypassed, so it is UNKNOWN rather than NOT_APPLICABLE.
    return result("none", "UNKNOWN", { reason: "No post-condition was declared for a step that ran" });
  }

  switch (spec.check) {
    case "none.readonly":
      return result(spec.check, "NOT_APPLICABLE", { reason: "Read step has no state change to verify" });

    case "ticket.status.changed": {
      const ticketId = spec.subjectArgument ? args[spec.subjectArgument] : undefined;
      if (typeof ticketId !== "string" || ticketId.length === 0) {
        return result(spec.check, "UNKNOWN", { reason: "No ticket id available to re-read" });
      }
      const ticket = await prisma.supportTicket
        .findUnique({ where: { id: ticketId }, select: { status: true, updatedAt: true } })
        .catch(() => null);
      if (!ticket) {
        return result(spec.check, "UNKNOWN", { reason: "Ticket could not be re-read after execution" });
      }
      const satisfied = RESOLVED_TICKET_STATUSES.has(String(ticket.status));
      return result(spec.check, satisfied ? "VERIFIED" : "FAILED", {
        observed: String(ticket.status),
        expected: spec.expected ?? [...RESOLVED_TICKET_STATUSES].join("|"),
        reason: satisfied ? undefined : "Ticket status did not reach a resolved state",
      });
    }

    case "ticket.priority.escalated": {
      const ticketId = spec.subjectArgument ? args[spec.subjectArgument] : undefined;
      if (typeof ticketId !== "string" || ticketId.length === 0) {
        return result(spec.check, "UNKNOWN", { reason: "No ticket id available to re-read" });
      }
      const ticket = await prisma.supportTicket
        .findUnique({ where: { id: ticketId }, select: { priorityLevel: true } })
        .catch(() => null);
      if (!ticket) {
        return result(spec.check, "UNKNOWN", { reason: "Ticket could not be re-read after execution" });
      }
      /**
       * `SupportPriorityLevel` is HIGH | NORMAL | LOW — there is no tier above HIGH, so the
       * post-condition for an escalation is exactly equality with HIGH.
       *
       * Written as a set membership rather than `=== "HIGH"` so that adding a tier above HIGH to
       * the enum is a one-line change here instead of a check that silently starts failing correct
       * escalations the moment the platform gains an URGENT level.
       */
      const escalated = ESCALATED_TICKET_PRIORITIES.has(String(ticket.priorityLevel));
      return result(spec.check, escalated ? "VERIFIED" : "FAILED", {
        observed: String(ticket.priorityLevel),
        expected: [...ESCALATED_TICKET_PRIORITIES].join("|"),
        reason: escalated ? undefined : "Ticket priority was not raised",
      });
    }

    case "ticket.exists": {
      const ticketId = spec.subjectArgument ? args[spec.subjectArgument] : undefined;
      if (typeof ticketId !== "string") {
        return result(spec.check, "UNKNOWN", { reason: "No ticket id available to re-read" });
      }
      const found = await prisma.supportTicket
        .findUnique({ where: { id: ticketId }, select: { id: true } })
        .catch(() => null);
      return result(spec.check, found ? "VERIFIED" : "FAILED", {
        observed: found ? "present" : "absent",
      });
    }

    case "notification.delivered": {
      const userId = spec.subjectArgument ? args[spec.subjectArgument] : undefined;
      if (typeof userId !== "string" || userId.length === 0) {
        return result(spec.check, "UNKNOWN", { reason: "No recipient id available to re-read" });
      }
      /**
       * Bounded to what this execution could have created.
       *
       * Without the time bound, any older notification to the same user would satisfy the check
       * and every send would "verify" — including one that silently created nothing. The window
       * starts a second before execution to absorb clock skew between this process and the
       * database, which is small but not zero.
       */
      const since = new Date(executedAt.getTime() - 1_000);
      const found = await prisma.notification
        .findFirst({
          where: { userId, createdAt: { gte: since } },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => null);
      return result(spec.check, found ? "VERIFIED" : "FAILED", {
        observed: found ? `notification ${found.id}` : "no notification created in window",
        reason: found ? undefined : "No notification row was created for this recipient",
      });
    }

    default: {
      // An exhaustive switch: adding a check to the type without implementing it here becomes a
      // compile error rather than a silently unverified write.
      const exhaustive: never = spec.check;
      return result(String(exhaustive), "UNKNOWN", { reason: "Unimplemented post-condition" });
    }
  }
}
