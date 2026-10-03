import type { AgentId } from "../types";

/**
 * What the requester actually asked for — and therefore what the agent is permitted to do.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * §8 states the rule plainly: "Why was this booking delayed?" must never become "Fix the
 * booking." Before this module, nothing in the runtime expressed that. An operator could ask a
 * purely diagnostic question, the model could return a plan containing `ticket.resolve`, and
 * every downstream control would wave it through — because each of those controls answers a
 * different question. Policy asks "is this actor allowed to do this?" (yes). Risk asks "how
 * dangerous is it?" (MEDIUM, within the ceiling). The registry asks "does this agent own this
 * capability?" (yes). None of them asks the only question that was wrong: *nobody asked for a
 * side effect.*
 *
 * An authorised action that nobody requested is still an unrequested action.
 *
 * ── Why classification is not the model's job ─────────────────────────────────
 *
 * The intent is an authorisation input, so it is derived here, deterministically, from the
 * request text — never taken from the plan. A model that wants to execute could otherwise
 * declare `intent: EXECUTE` and authorise itself, which is the same defect as letting it declare
 * its own risk tier.
 *
 * ── Why an unrecognised phrasing means ANALYZE ────────────────────────────────
 *
 * The classifier is lexical and will not recognise every way a person can ask for something. So
 * the failure direction is chosen rather than left to chance: anything it cannot classify becomes
 * ANALYZE, the most restrictive intent, which forbids every side effect.
 *
 * The two failure modes are not symmetric:
 *   - Misreading "fix this" as ANALYZE costs the operator one re-issue, with a message naming
 *     exactly which step was refused and why.
 *   - Misreading "why did this happen" as EXECUTE performs a side effect nobody asked for.
 *
 * The first is an inconvenience. The second is the thing this module exists to prevent.
 */

export const AGENT_INTENTS = [
  "QUERY",
  "ANALYZE",
  "EXPLAIN",
  "INVESTIGATE",
  "RECOMMEND",
  "SIMULATE",
  "DRAFT",
  "EXECUTE",
  "ESCALATE",
  "APPROVE",
  "REJECT",
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export function isAgentIntent(value: unknown): value is AgentIntent {
  return typeof value === "string" && (AGENT_INTENTS as readonly string[]).includes(value);
}

/**
 * The intents under which a side effect may occur at all.
 *
 * Everything else in the union is a reading, an explanation or a proposal, and a plan produced
 * under one of them may contain read steps only.
 *
 * ESCALATE is here because handing work to a human is itself a write (raising a ticket's
 * priority, attaching a note) and because its failure mode points the safe way: a wrongly
 * escalated ticket costs a person a few minutes.
 */
const EXECUTING_INTENTS = new Set<AgentIntent>(["EXECUTE", "ESCALATE"]);

/**
 * Intents that describe a HUMAN act, which no agent may ever perform.
 *
 * Approving and rejecting are the decisions the whole approval layer exists to reserve for a
 * person. They are in the vocabulary so that a request phrased as one is *named and refused*
 * rather than quietly reinterpreted as something the agent can do — an agent that responds to
 * "approve this refund" by drafting an analysis has answered a question nobody asked.
 */
const HUMAN_ONLY_INTENTS = new Set<AgentIntent>(["APPROVE", "REJECT"]);

export function intentPermitsSideEffect(intent: AgentIntent): boolean {
  return EXECUTING_INTENTS.has(intent);
}

export function intentIsHumanOnly(intent: AgentIntent): boolean {
  return HUMAN_ONLY_INTENTS.has(intent);
}

/**
 * Ordered because the first match wins and the order encodes precedence.
 *
 * The human-only and diagnostic patterns are tested BEFORE the executing ones, so a request that
 * contains both a diagnostic and an imperative verb — "why did this fail, and can you fix it" —
 * resolves to the read-only reading. A person who genuinely wants the second half can ask for it
 * on its own, which is a cheaper mistake than the reverse.
 *
 * `\b` boundaries throughout: without them "canceled" matches inside "cancellation" and a
 * question about cancellation policy classifies as a request to cancel something.
 */
const INTENT_PATTERNS: Array<{ intent: AgentIntent; pattern: RegExp }> = [
  // Human-only first: these must be recognised even when phrased as a command.
  { intent: "APPROVE", pattern: /\b(approve|authori[sz]e|sign[- ]?off|greenlight)\b/i },
  { intent: "REJECT", pattern: /\b(reject|deny|decline|refuse)\b/i },

  // Diagnostic and analytical. Deliberately ahead of every executing pattern.
  { intent: "EXPLAIN", pattern: /\b(why|explain|reason|root cause|how come|what caused)\b/i },
  { intent: "INVESTIGATE", pattern: /\b(investigate|look into|dig into|forensic|suspicious|evidence)\b/i },
  { intent: "SIMULATE", pattern: /\b(simulate|what[- ]?if|model the|scenario|project(ion)?)\b/i },
  { intent: "RECOMMEND", pattern: /\b(recommend|suggest|advise|what should|next step|options?)\b/i },
  { intent: "DRAFT", pattern: /\b(draft|compose|write (?:a|an|the)|prepare (?:a|an|the)|propose)\b/i },
  { intent: "ANALYZE", pattern: /\b(analy[sz]e|assess|evaluate|review|compare|break ?down|diagnos)/i },
  { intent: "QUERY", pattern: /\b(show|list|find|search|get|what is|which|who|when|how many|status of)\b/i },

  // Executing last, and only for unambiguous imperatives.
  { intent: "ESCALATE", pattern: /\b(escalate|raise to|hand (?:this )?(?:over|off)|bump priority)\b/i },
  {
    intent: "EXECUTE",
    pattern:
      /\b(execute|perform|apply|resolve|close|fix|send|notify|update|set|mark|do it|go ahead|proceed)\b/i,
  },
];

export type IntentResolution = {
  intent: AgentIntent;
  /** How the intent was arrived at. Recorded on the run so an operator can see the reasoning. */
  source: "DECLARED" | "CLASSIFIED" | "DEFAULTED";
  /** The pattern or declaration that decided it. Never model prose. */
  evidence: string;
  permitsSideEffect: boolean;
  humanOnly: boolean;
};

/**
 * Resolve the intent for a run.
 *
 * `declared` comes from a trusted caller — the command surface, an event trigger definition —
 * and is honoured because in those paths the intent is a property of the CALL SITE rather than
 * a guess about prose. It is never populated from model output.
 *
 * A declared intent is still not a grant: it selects which rules apply, and the agent's own
 * read-only flag, risk ceiling and capability allowlist all still run underneath. Declaring
 * EXECUTE on the Finance Assistant changes nothing, because that agent has no write to reach.
 */
export function resolveIntent(params: {
  goal: string;
  declared?: string;
}): IntentResolution {
  if (params.declared !== undefined) {
    if (!isAgentIntent(params.declared)) {
      // An unrecognised declaration is not honoured and is not silently dropped either — it falls
      // through to classification, so a typo cannot hand a run a permissive intent.
      const classified = classify(params.goal);
      return {
        ...classified,
        evidence: `declared intent "${params.declared}" is not recognised; ${classified.evidence}`,
      };
    }
    const intent = params.declared;
    return {
      intent,
      source: "DECLARED",
      evidence: `caller declared ${intent}`,
      permitsSideEffect: intentPermitsSideEffect(intent),
      humanOnly: intentIsHumanOnly(intent),
    };
  }
  return classify(params.goal);
}

function classify(goal: string): IntentResolution {
  const text = goal ?? "";
  for (const { intent, pattern } of INTENT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return {
        intent,
        source: "CLASSIFIED",
        evidence: `matched "${match[0]}"`,
        permitsSideEffect: intentPermitsSideEffect(intent),
        humanOnly: intentIsHumanOnly(intent),
      };
    }
  }
  return {
    intent: "ANALYZE",
    source: "DEFAULTED",
    // Said out loud rather than left implicit: an operator reading a refused write needs to know
    // the request was never understood as a request to act.
    evidence: "no intent verb recognised; defaulted to the read-only reading",
    permitsSideEffect: false,
    humanOnly: false,
  };
}

/**
 * The operator-facing sentence attached to a run that was narrowed by its intent.
 *
 * Names the intent, why it was chosen and what to do instead, because "step refused" without
 * any of that is the kind of message that trains people to stop reading them.
 */
export function describeIntentRefusal(
  resolution: IntentResolution,
  capability: string,
  agentId: AgentId,
): string {
  if (resolution.humanOnly) {
    return `This request reads as ${resolution.intent} (${resolution.evidence}), which is a human decision. ${agentId} can assemble the evidence for it but cannot make it.`;
  }
  return `This request reads as ${resolution.intent} (${resolution.evidence}), which asks for information rather than a change, so the step "${capability}" was not run. Re-issue the request as an explicit instruction to act if a change is genuinely wanted.`;
}
