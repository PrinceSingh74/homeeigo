import prisma from "../../lib/prisma";
import { cooldownMsFor } from "./policy";
import type { RecipientType } from "../types";

/**
 * How recently a particular workflow last contacted a particular person.
 *
 * The daily cap asks "has this person heard enough today"; cooldown asks the narrower question
 * "has *this* conversation happened recently". They are independent: a review reminder and a
 * payment reminder are different conversations and each gets its own gap, while both still draw on
 * the same daily allowance.
 *
 * ── Identity ──────────────────────────────────────────────────────────────────
 *
 * A cooldown is keyed by workflowId + recipientType + recipientId. Version is deliberately absent
 * from the lookup, and that absence is the guarantee rather than a convention someone has to
 * remember: `review_request.v2` cannot be published as a way of messaging everyone that
 * `review_request.v1` reached yesterday, because the query has no version to distinguish them by.
 * Two versions of a workflow are two drafts of the same conversation.
 *
 * ── What counts as contact ────────────────────────────────────────────────────
 *
 * Cadence reservations, and only those. A reservation is taken at the moment a notification is
 * genuinely about to go out, so the history is exactly the set of messages that happened. A request
 * that was suppressed leaves no reservation and therefore does not push the next one further away —
 * being refused is not a form of being contacted.
 *
 * PostgreSQL is the authority here as it is for the cap. The index
 * (workflow_id, recipient_type, recipient_id, created_at) makes this one indexed lookup of a single
 * row, so there is nothing for a cache to earn.
 */

/**
 * ── This function reports; it does not enforce ────────────────────────────────
 *
 * `evaluateWorkflowCooldown` is a read. It is the cheap early answer that lets a request be
 * abandoned before a recipient is resolved or a template rendered, and it is what an audit or an
 * operator screen should ask. It is *not* the control.
 *
 * Reading here and reserving afterwards leaves a gap, and the gap is not theoretical: driven from
 * four processes at one recipient with a one-hour cooldown, twelve attempts produced twelve granted
 * messages, because all twelve read the history before any of them had written to it. The daily cap
 * still held, so nothing in the data looked wrong afterwards — the person had simply been sent the
 * same message twelve times.
 *
 * Enforcement therefore belongs to `reserveGovernedSlot`, which re-reads this same history inside a
 * lock on the cooldown identity and takes the slot without letting go. Under the identical test it
 * grants exactly one.
 */

export type CooldownDecision =
  | {
      allowed: true;
      reason: "NO_PRIOR_SEND" | "COOLDOWN_EXPIRED";
      lastSentAt: Date | null;
      elapsedMs: number | null;
      cooldownMs: number;
    }
  | {
      allowed: false;
      reason: "WORKFLOW_COOLDOWN";
      lastSentAt: Date;
      elapsedMs: number;
      remainingMs: number;
      nextEligibleAt: Date;
      cooldownMs: number;
    };

export async function evaluateWorkflowCooldown(input: {
  workflowId: string;
  recipientType: RecipientType;
  recipientId: string;
  /**
   * The operation being judged.
   *
   * Excluded from its own history, so replaying a notification is not blocked by the reservation
   * that same notification already holds. Without this an operation would start suppressing itself
   * the instant it succeeded, and a retry that should have replayed the original result would
   * instead report a cooldown that does not apply to it.
   */
  idempotencyKey?: string;
  cooldownMs?: number;
  at?: Date;
}): Promise<CooldownDecision> {
  const at = input.at ?? new Date();
  const cooldownMs = input.cooldownMs ?? cooldownMsFor(input.workflowId);

  const last = await prisma.notificationCadenceReservation.findFirst({
    where: {
      workflowId: input.workflowId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      ...(input.idempotencyKey ? { idempotencyKey: { not: input.idempotencyKey } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!last) {
    return { allowed: true, reason: "NO_PRIOR_SEND", lastSentAt: null, elapsedMs: null, cooldownMs };
  }

  const elapsedMs = at.getTime() - last.createdAt.getTime();

  /**
   * The boundary is inclusive: at exactly one cooldown after the last message, the next one is
   * allowed. A 24-hour cooldown that refused at exactly 24 hours would really be a 24-hour-plus-
   * one-millisecond cooldown, and a daily job firing at the same clock time every day would be
   * suppressed every second day for reasons no one could see.
   */
  if (elapsedMs >= cooldownMs) {
    return { allowed: true, reason: "COOLDOWN_EXPIRED", lastSentAt: last.createdAt, elapsedMs, cooldownMs };
  }

  return {
    allowed: false,
    reason: "WORKFLOW_COOLDOWN",
    lastSentAt: last.createdAt,
    elapsedMs,
    remainingMs: cooldownMs - elapsedMs,
    nextEligibleAt: new Date(last.createdAt.getTime() + cooldownMs),
    cooldownMs,
  };
}
