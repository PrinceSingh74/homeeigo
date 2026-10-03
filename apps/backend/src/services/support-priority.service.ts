import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { supportTicketService } from "./support-ticket.service";
import {
  SUPPORT_REASON,
  type PriorityExplanation,
  type SupportClassification,
  type SupportPriority,
  type SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10, Capability 3 — priority, explained rather than re-decided.
 *
 * ── The authority already exists, and it is not this file ──────────────────────
 *
 * `supportTicketService.resolvePriority()` sets HIGH for a member or a customer with
 * `prioritySupport`, NORMAL otherwise, and `SLA_MS` attaches 2 h / 24 h / 48 h to the result. That
 * is a real, shipped business policy. This service **reads** it and explains it; it does not
 * recompute it, and it never lets a model's opinion replace it.
 *
 * ── Why the model's priority is carried but not applied ────────────────────────
 *
 * "LLM says HIGH → HIGH" is exactly what the directive forbids. So `modelSuggested` sits beside
 * `effective` with an `agrees` flag, and a disagreement becomes something a human can see and act
 * on. A model that thinks a ticket is urgent is evidence for a person, not a promotion.
 *
 * ── The factors nobody has weighted ────────────────────────────────────────────
 *
 * The directive lists customer impact, payment impact, booking timing, repeated contact, safety and
 * fraud indicators as things priority *could* consider. This platform has no weights for any of
 * them. Inventing a scoring formula would manufacture a policy, so they are listed by name in
 * `unweightedFactors` with `POLICY_UNSET` — visible, and honestly unresolved.
 */

/** Mirrors `SLA_MS` in `support-ticket.service.ts`. Read here, never redefined. */
const SLA_WINDOW_MS: Record<SupportPriority, number> = {
  HIGH: 2 * 60 * 60 * 1000,
  NORMAL: 24 * 60 * 60 * 1000,
  LOW: 48 * 60 * 60 * 1000,
};

/**
 * Factors the directive names that this platform has no approved weighting for.
 *
 * Listed rather than silently dropped: an operator reading a priority explanation should be able to
 * see what was *not* considered, which is the part a scoring number would hide.
 */
const UNWEIGHTED_FACTORS = [
  "customer impact",
  "payment impact",
  "booking timing",
  "repeated unresolved contact",
  "safety indicators",
  "fraud indicators",
  "partner issue severity",
] as const;

export const supportPriorityService = {
  /**
   * Explain a ticket's priority.
   *
   * Falls back to the stored `priorityLevel` when the entitlement service cannot answer — the stored
   * value is what the platform actually acted on, so it remains the effective priority even when the
   * reason for it can no longer be re-derived.
   */
  async explain(
    ctx: SupportTicketContext,
    cls: SupportClassification,
  ): Promise<PriorityExplanation> {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ctx.ticketId },
      select: { priorityLevel: true, userId: true, slaDueAt: true, firstResponseAt: true },
    });

    const effective = (ticket?.priorityLevel ?? "NORMAL") as SupportPriority;
    const reasons: string[] = [];
    let effectiveSource = "support_tickets.priority_level";
    let reasonCode: PriorityExplanation["reasonCode"];

    // Re-derive *why*, without re-deciding *what*.
    if (ticket?.userId) {
      try {
        const derived = await supportTicketService.resolvePriority(ticket.userId);
        effectiveSource = "supportTicketService.resolvePriority (entitlement policy)";
        reasons.push(
          derived === "HIGH"
            ? "The customer's entitlement grants priority support, so the existing policy assigns HIGH."
            : "The customer has no priority-support entitlement, so the existing policy assigns NORMAL.",
        );
        if (derived !== effective) {
          // Worth surfacing: the stored value and the current entitlement disagree, usually because
          // an agent escalated the ticket by hand. The stored value stays authoritative.
          reasons.push(
            `The stored priority (${effective}) differs from what the entitlement policy would assign today (${derived}); the stored value is what the platform acted on.`,
          );
        }
      } catch (err) {
        logger.warn("support_priority_entitlement_unavailable", { error: String(err).slice(0, 200) });
        reasons.push("The entitlement service did not answer, so the stored priority is reported as-is.");
        reasonCode = SUPPORT_REASON.SOURCE_UNAVAILABLE;
      }
    } else {
      reasons.push("The ticket has no linked customer, so no entitlement could be resolved.");
      reasonCode = SUPPORT_REASON.NOT_LINKED;
    }

    // The SLA is a consequence of the priority, not an independent decision.
    reasons.push(
      `The existing SLA policy attaches a ${SLA_WINDOW_MS[effective] / 3_600_000}-hour first-response window to ${effective}.`,
    );
    if (ctx.slaBreached === true) {
      reasons.push(`No first response is recorded and the SLA due time (${ctx.slaDueAt}) has passed.`);
    }

    const modelSuggested = cls.suggestedPriority;
    if (modelSuggested !== null) {
      reasons.push(
        modelSuggested === effective
          ? `The model's reading agrees with the assigned priority (${effective}).`
          : `The model suggested ${modelSuggested}, which differs from the assigned ${effective}. The assignment is unchanged; the disagreement is recorded for a person to weigh.`,
      );
    }

    return {
      effective,
      effectiveSource,
      slaWindowMs: SLA_WINDOW_MS[effective] ?? null,
      modelSuggested,
      agrees: modelSuggested === null ? null : modelSuggested === effective,
      reasons,
      unweightedFactors: [...UNWEIGHTED_FACTORS],
      reasonCode,
    };
  },
};
