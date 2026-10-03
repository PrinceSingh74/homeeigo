import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { agentTriggersFor } from "../../agents/triggers/agent-trigger-registry";
import { runAgent } from "../../agents";
import { agentsConfig } from "../../agents/config";
import { recordAgentDuplicateSuppressed } from "../../agents/observability/agent-metrics";
import type { HomigoEvent } from "../core/homigo-event";

/**
 * The bridge between the event stream and the agent runtime.
 *
 * Like the workflow trigger consumer it sits beside, this deliberately does almost nothing. It
 * matches an event against the explicit trigger contracts, checks the cooldown, and hands off. It
 * imports no business service, contains no policy, and makes no decision the runtime is not
 * already making — a consumer that could send a message is a consumer someone will eventually
 * make send a message, and then the agent definition stops being the description of what happens.
 *
 * The causation chain is threaded through deliberately. `causationId` carries the event id and
 * `depth` is incremented from the event's own depth hint, so an agent whose action emits an event
 * that would re-trigger the same agent is refused by the runtime's recursion guard rather than
 * looping. Dropping either field here would make that guard blind to exactly the cycle it exists
 * to catch.
 */

/** How deep this event already is in an agent-caused chain, if it was caused by one. */
function inferredDepth(event: HomigoEvent): number {
  const raw = (event.data as { agentDepth?: unknown }).agentDepth;
  const n = typeof raw === "number" ? raw : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Has this agent run for this subject too recently?
 *
 * Separate from idempotency, which answers "is this the same trigger". Two genuinely different
 * events about one booking are not duplicates, but they still must not start two runs seconds
 * apart — that is how a flapping entity turns into an inference bill.
 */
async function withinCooldown(
  agentId: string,
  subjectType: string,
  subjectId: string,
  cooldownMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMs);
  const recent = await prisma.agentRun.count({
    where: { agentId, subjectType, subjectId, createdAt: { gte: since } },
  });
  return recent > 0;
}

export async function agentTriggerConsumer(event: HomigoEvent): Promise<void> {
  // The layer being off means no runs at all, including shadow. Checked here as well as in the
  // runtime so a disabled platform does not pay for a database round trip per event.
  if (!agentsConfig.enabled) return;

  const triggers = agentTriggersFor(event.type);
  if (triggers.length === 0) return;

  for (const trigger of triggers) {
    if (!trigger.condition(event)) continue;

    const subjectId = trigger.deriveSubjectId(event);
    if (!subjectId) {
      // No subject, no run. Substituting the aggregate id or an empty string would start an agent
      // pointed at the wrong entity, and every downstream control would then correctly authorise
      // work against the wrong thing.
      logger.warn("agent_trigger_no_subject", {
        category: "APPLICATION",
        triggerId: trigger.id,
        eventType: event.type,
        eventId: event.id,
      });
      continue;
    }

    if (await withinCooldown(trigger.agentId, trigger.subjectType, subjectId, trigger.cooldownMs)) {
      recordAgentDuplicateSuppressed(trigger.agentId, "COOLDOWN");
      continue;
    }

    try {
      const result = await runAgent({
        agentId: trigger.agentId,
        // Fixed text from the trigger definition. Assembling a goal from the event payload would
        // let whoever can write that payload write the agent's instructions.
        goal: trigger.goal,
        input: JSON.stringify({
          eventType: event.type,
          eventId: event.id,
          subjectType: trigger.subjectType,
          subjectId,
          data: event.data,
        }),
        actor: {
          actorId: event.homigo.actorId ?? "system:agent-trigger",
          actorRole: "SYSTEM",
          traceId: event.homigo.traceId,
        },
        trigger: {
          type: "EVENT",
          ref: event.id,
          subjectType: trigger.subjectType,
          subjectId,
          causationId: event.id,
          depth: inferredDepth(event) + 1,
        },
      });

      logger.info("agent_trigger_started", {
        category: "APPLICATION",
        triggerId: trigger.id,
        agentId: trigger.agentId,
        runId: result.runId,
        mode: result.mode,
        status: result.status,
        subjectId,
      });
    } catch (err) {
      // A failed agent run must never fail the event. The outbox would retry the delivery, every
      // other consumer of this event would be re-run, and a broken agent would turn one event into
      // a redelivery storm across the whole platform.
      logger.error("agent_trigger_failed", {
        category: "APPLICATION",
        triggerId: trigger.id,
        agentId: trigger.agentId,
        eventId: event.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}
