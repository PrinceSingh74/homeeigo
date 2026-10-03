import { EVENT_TYPES } from "../../events/catalog/event-types";
import type { HomigoEvent } from "../../events/core/homigo-event";
import type { AgentId } from "../types";

/**
 * Explicit trigger contracts — §25.
 *
 * Agents do NOT subscribe to the event stream broadly. Each entry is a deliberate, reviewable
 * statement that one specific event type may start one specific agent, under a stated condition,
 * with a stated subject. A wildcard subscription would mean every new event type in the platform
 * silently acquires the power to start an agent run — which is how an event storm becomes an
 * inference bill and a pile of side effects nobody asked for.
 *
 * ── All three triggers are backed by REAL producers ───────────────────────────
 *
 * Two of these could not exist earlier: `support_tickets` and `ops_alerts` rows were written by
 * direct service calls and nothing published them. The fix was to emit from the services that own
 * those tables — transactionally, so the row and its event cannot diverge — rather than to
 * register subscriptions against events that never fire.
 *
 * Every `eventType` below is asserted, by test, to be emitted by a real production path. A
 * trigger whose event is never published looks complete, passes its own tests, and is dead.
 *
 * Every trigger is conservative by construction:
 *  - `condition` runs first and is pure. An event that does not clearly match starts nothing.
 *  - `deriveSubjectId` returning null aborts. A fallback id would point an agent at the wrong
 *    entity, and every downstream control would then correctly authorise work against it.
 *  - `cooldownMs` bounds how often one subject can re-trigger, so a flapping entity cannot drive
 *    a run per flap.
 *
 * Deduplication is NOT reimplemented here. The runtime derives a run idempotency key from (agent,
 * trigger type, event ref, subject) and the unique index on `agent_runs.idempotency_key` collapses
 * a duplicate delivery into one run. A second key beside a proven one would give the system two
 * answers to "is this the same trigger".
 */
export type AgentTriggerDefinition = {
  id: string;
  eventType: string;
  agentId: AgentId;
  /** Why this event is worth an agent run. Read by operators, not by code. */
  rationale: string;
  /** Pure predicate over the event. Must not read the database. */
  condition: (event: HomigoEvent) => boolean;
  /** The entity the run is about. Null aborts the trigger. */
  deriveSubjectId: (event: HomigoEvent) => string | null;
  subjectType: string;
  /** The goal handed to the planner. Fixed text — never assembled from the event payload. */
  goal: string;
  /**
   * Minimum gap between runs of this agent for the same subject.
   *
   * Distinct from idempotency, which answers "is this the same trigger". Two genuinely different
   * events about one partner are not duplicates, but they still must not start two runs seconds
   * apart.
   */
  cooldownMs: number;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export const AGENT_TRIGGERS: AgentTriggerDefinition[] = [
  {
    id: "support.ticket.created",
    // Verified emitted: support-ticket.service.ts publishes this INSIDE `runTicketCreateTx`,
    // so a rolled-back ticket takes its event with it.
    eventType: EVENT_TYPES.SUPPORT_TICKET_CREATED,
    agentId: "support",
    rationale:
      "A newly created ticket is the cheapest moment to classify it and surface the platform's own recommended resolution to whoever picks it up. Nothing the agent can do here decides money or entitlement.",
    condition: (e) => Boolean(str(e.data.ticketId)),
    deriveSubjectId: (e) => str(e.data.ticketId) ?? str(e.homigo.aggregateId),
    subjectType: "ticket",
    goal: "Understand this support ticket and determine the correct next action within policy",
    // Short: a ticket is a discrete thing that happens once. The cooldown exists to stop a
    // pathological re-delivery loop, not to space out genuine work.
    cooldownMs: 5 * 60_000,
  },
  {
    id: "ops.alert.raised",
    // Verified emitted: ops-alert.service.ts publishes this in a transaction with the row, and
    // only when a row is actually created (the 5-per-hour suppression returns null first).
    eventType: EVENT_TYPES.OPS_ALERT_RAISED,
    agentId: "operations",
    rationale:
      "An operational alert already represents a condition someone decided was worth noticing; the agent gathers the surrounding zone and supply evidence before a human opens it.",
    /**
     * INFO alerts are excluded.
     *
     * They fire constantly and none of them needs an investigation — an agent run per INFO alert
     * would be an inference bill with no reader. Only WARNING and above earn a run.
     */
    condition: (e) => {
      const sev = str(e.data.severity);
      return sev === "WARNING" || sev === "CRITICAL" || sev === "ESCALATION";
    },
    deriveSubjectId: (e) => str(e.data.alertId) ?? str(e.homigo.aggregateId),
    subjectType: "ops_alert",
    goal: "Investigate this operational alert and gather the evidence a human needs to act on it",
    cooldownMs: 10 * 60_000,
  },
  {
    id: "partner.paused",
    // Verified emitted: partner-operations.service.ts:657 publishes this in-transaction.
    eventType: EVENT_TYPES.PARTNER_PAUSED,
    agentId: "partner-operations",
    rationale:
      "A partner pausing mid-shift is the case where a routine, policy-approved follow-up is genuinely useful. Anything beyond a nudge — eligibility, pay, standing — escalates to a human by construction, because this agent has no capability for any of it.",
    condition: (e) => Boolean(str(e.data.providerId) ?? str(e.homigo.aggregateId)),
    deriveSubjectId: (e) => str(e.data.providerId) ?? str(e.homigo.aggregateId),
    subjectType: "provider",
    goal: "Review this partner's operational state and determine whether routine follow-up is warranted",
    cooldownMs: 30 * 60_000,
  },
];

/**
 * Triggers this platform CANNOT wire yet, and why.
 *
 * Kept in code rather than only in a document so the gap is visible to anyone reading the
 * registry, and so the agent status endpoint can report it honestly instead of implying that
 * every agent is event-driven.
 */
export const UNWIRED_TRIGGERS: Array<{
  agentId: AgentId;
  intendedEventType: string;
  blockedBy: string;
}> = [
  /**
   * Empty, and kept rather than deleted.
   *
   * This list previously held `homigo.support.ticket.created` and `homigo.ops.alert.raised`,
   * both blocked because the owning services wrote their rows directly and published nothing.
   * Both producers now exist and emit transactionally, so both triggers are wired above.
   *
   * The structure stays because the honest thing to do with a trigger that CANNOT be wired is to
   * declare it here, where the registry reader and the status endpoint can both see it — not to
   * register a subscription against an event that never fires, which would look complete, pass
   * its own tests, and be dead in production.
   */
];

export function agentTriggersFor(eventType: string): AgentTriggerDefinition[] {
  return AGENT_TRIGGERS.filter((t) => t.eventType === eventType);
}

export function agentTriggeredEventTypes(): string[] {
  return [...new Set(AGENT_TRIGGERS.map((t) => t.eventType))];
}
