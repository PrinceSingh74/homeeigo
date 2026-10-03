import crypto from "crypto";
import type {
  AgentId,
  AgentRiskTier,
  ClarificationQuestion,
  PlanValidation,
  ProposedPlan,
  ProposedStep,
  ValidatedStep,
} from "../types";
import { effectiveBounds, getAgentDefinition, getCapability } from "../registry/agent-registry";
import { getTool } from "../../ai-tools/registry/tool-registry";
import { describeIntentRefusal, type IntentResolution } from "./intent";

/**
 * The boundary between "the model said something" and "the platform will do something".
 *
 * Everything above this function is untrusted text. Everything below it is a typed plan whose
 * every step names a capability this agent owns, carries only arguments that capability
 * declares, and has been risk-classified by the server rather than by the model.
 *
 * The rejections are deliberately total. There is no repair, no coercion, no "close enough"
 * mapping of an unknown capability onto a similar one, and no silent dropping of an
 * unrecognised argument. Each of those would convert a malformed plan into a *different*
 * well-formed plan that nobody authored — and a dropped argument in particular is how a
 * narrowly-scoped action quietly becomes a broad one (`{ticketId: "x", limit: 1}` losing its
 * limit is not the same request).
 */

const MAX_PLAN_BYTES = 16_000;
const MAX_ARGUMENT_STRING = 2_000;

/** Extract a JSON object from model output without ever evaluating it. */
export function parsePlanJson(raw: string): unknown {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_PLAN_BYTES) return null;

  // Models fence JSON often enough that refusing to look inside a fence would fail plans that
  // are otherwise perfectly well-formed. The fence is stripped; the contents are still parsed
  // as data and nothing else.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  // Take the outermost object only. A model that appends prose after the JSON should not
  // fail, but neither should the prose be parsed.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Shape check only — no authorisation decisions here.
 *
 * Kept separate so that "the model produced nonsense" and "the model asked for something it may
 * not have" are distinguishable in the metrics. Collapsing them would hide a genuine attempted
 * escalation inside a noisy malformed-output counter.
 */
export function coercePlanShape(value: unknown): ProposedPlan | null {
  if (!isPlainObject(value)) return null;
  const { goal, reason, steps, risk } = value;
  if (typeof goal !== "string" || goal.trim().length === 0) return null;
  if (typeof reason !== "string") return null;
  if (!Array.isArray(steps)) return null;

  const parsed: ProposedStep[] = [];
  for (const raw of steps) {
    if (!isPlainObject(raw)) return null;
    const { capability, arguments: args, reason: stepReason, expectedEffect } = raw;
    if (typeof capability !== "string" || capability.trim().length === 0) return null;
    if (args !== undefined && !isPlainObject(args)) return null;
    parsed.push({
      capability: capability.trim(),
      arguments: isPlainObject(args) ? args : {},
      reason: typeof stepReason === "string" ? stepReason : "",
      expectedEffect: typeof expectedEffect === "string" ? expectedEffect : "",
    });
  }

  return {
    goal: goal.trim(),
    reason,
    steps: parsed,
    claimedRisk: typeof risk === "string" ? risk : undefined,
  };
}

/**
 * Are these argument VALUES acceptable?
 *
 * Names are checked against the capability's allowlist elsewhere; this checks the values are
 * primitives of bounded size. Nested objects and arrays are refused rather than traversed: a
 * tool's validation schema describes flat parameters, so a nested value could only ever be
 * something the schema does not look at — and an unchecked blob travelling into a handler is
 * the shape prompt-injection payloads take when they want to survive sanitisation.
 */
function argumentValueAcceptable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number);
  if (t === "boolean") return true;
  if (t === "string") return (value as string).length <= MAX_ARGUMENT_STRING;
  return false;
}

const RISK_ORDER: Record<AgentRiskTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function highestRisk(steps: Array<{ risk: AgentRiskTier }>): AgentRiskTier {
  let out: AgentRiskTier = "LOW";
  for (const s of steps) if (RISK_ORDER[s.risk] > RISK_ORDER[out]) out = s.risk;
  return out;
}

/**
 * Hash the plan that was authorised.
 *
 * Covers agent, version and every step's capability and arguments, so a plan cannot be edited
 * between validation and execution without the hash moving. This is what §22 approval-binding
 * rests on: an approval references a plan hash, and a changed plan is a different plan.
 *
 * Arguments are canonicalised by sorting their keys, because `{a,b}` and `{b,a}` are the same
 * request and must not produce two different hashes — the frozen Phase-5 approval binding is
 * order-SENSITIVE by design (it fails closed), but a plan hash that flapped on key order would
 * fail closed constantly and teach operators to ignore it.
 */
export function hashPlan(agentId: AgentId, agentVersion: string, steps: ValidatedStep[]): string {
  const material = JSON.stringify({
    agentId,
    agentVersion,
    steps: steps.map((s) => ({
      capability: s.capability,
      toolId: s.resolved.toolId,
      risk: s.risk,
      arguments: Object.fromEntries(Object.entries(s.arguments).sort(([a], [b]) => a.localeCompare(b))),
    })),
  });
  return crypto.createHash("sha256").update(material).digest("hex");
}

/**
 * Which arguments the underlying tool will refuse to run without.
 *
 * Read from the tool's own `validationSchema.required` rather than re-declared on the capability,
 * so there is exactly one statement of what a tool needs. A second copy on the capability would
 * be a copy that drifts, and the direction it drifts in matters: a capability that forgot to list
 * a newly-required argument would let an underspecified plan through to fail at the tool boundary
 * — burning a tool call and an audit row to discover something the validator already knew.
 */
function requiredArgumentsFor(toolId: string | undefined): string[] {
  if (!toolId) return [];
  const schema = getTool(toolId)?.validationSchema as { required?: unknown } | undefined;
  const required = schema?.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Ask for the one missing thing, in the words an operator would use.
 *
 * §9's example is exactly this: "Cancel the booking" with several candidate bookings should ask
 * which booking, not pick one. A generic "arguments were invalid" would send the operator to the
 * logs to find out what the agent wanted.
 */
function clarificationFor(capability: string, field: string): ClarificationQuestion {
  const phrasing: Record<string, string> = {
    ticketId: "Which ticket? Give the ticket id or ticket number.",
    providerId: "Which partner? Give the provider id.",
    userId: "Which user? Give the user id.",
    alertId: "Which alert? Give the alert id.",
    bookingId: "Which booking? Give the booking id.",
    city: "Which city?",
    question: "What exactly should be looked up?",
    resolution: "What resolution text should be recorded?",
    note: "What should the escalation note say?",
  };
  return {
    capability,
    field,
    question: phrasing[field] ?? `Which value should be used for "${field}"?`,
  };
}

export function validatePlan(
  agentId: AgentId,
  proposed: ProposedPlan | null,
  /**
   * The resolved intent of the request.
   *
   * Optional so that existing callers and tests that only care about structural validation keep
   * working. When it IS supplied — which the runtime always does — a plan that proposes a change
   * under a read-only intent is refused here, before policy, before risk, before the tool layer.
   * None of those downstream controls can catch it, because none of them knows what was asked.
   */
  intent?: IntentResolution,
): PlanValidation {
  if (!proposed) {
    return { ok: false, code: "PLAN_MALFORMED", reason: "Plan was not a valid structured object" };
  }

  const def = getAgentDefinition(agentId);
  const bounds = effectiveBounds(agentId);

  /**
   * An empty plan is ACCEPTED, not rejected.
   *
   * The planner prompt tells the model in as many words that when a request cannot be served with
   * the capabilities it holds, the correct answer is an empty step list. Rejecting that here
   * punished the model for obeying, turned the safest possible response into a FAILED run, and
   * made the runtime's own "empty plan is a legitimate outcome" branch unreachable. It also
   * mattered most in the case it was worst at: a prompt-injection attempt that the model
   * correctly refused to act on was recorded as a planning failure rather than as a refusal.
   *
   * The run still terminates immediately — there is nothing to execute — but it terminates as
   * COMPLETED with `stopReason: EMPTY_PLAN`, which is what actually happened.
   */
  if (proposed.steps.length > bounds.maxSteps) {
    return {
      ok: false,
      code: "PLAN_TOO_LONG",
      reason: `Plan has ${proposed.steps.length} steps; limit is ${bounds.maxSteps}`,
    };
  }

  const validated: ValidatedStep[] = [];
  const clarifications: ClarificationQuestion[] = [];

  for (const step of proposed.steps) {
    const cap = getCapability(agentId, step.capability);
    if (!cap) {
      // The single most important rejection in this file. A capability the agent does not own
      // is not mapped, not approximated and not escalated — it is refused, because a model
      // naming a capability outside its vocabulary is either confused or being steered.
      return {
        ok: false,
        code: "UNKNOWN_CAPABILITY",
        reason: `Agent ${agentId} has no capability "${step.capability}"`,
      };
    }

    for (const [name, value] of Object.entries(step.arguments)) {
      if (!cap.allowedArguments.includes(name)) {
        return {
          ok: false,
          code: "UNKNOWN_ARGUMENT",
          reason: `Capability ${cap.name} does not accept argument "${name}"`,
        };
      }
      if (!argumentValueAcceptable(value)) {
        return {
          ok: false,
          code: "UNKNOWN_ARGUMENT",
          reason: `Argument "${name}" on ${cap.name} is not an acceptable scalar value`,
        };
      }
    }

    // Belt and braces over the registry's own load-time check. The registry throws at import if
    // a read-only agent declares a write capability; this catches the case where a definition
    // is mutated at runtime, which the load-time check by construction cannot see.
    if (def.readOnly && cap.risk !== "LOW") {
      return {
        ok: false,
        code: "READ_ONLY_VIOLATION",
        reason: `Agent ${agentId} is read-only and cannot plan ${cap.name} (${cap.risk})`,
      };
    }

    if (cap.risk !== "LOW" && !cap.postCondition) {
      return {
        ok: false,
        code: "MISSING_POST_CONDITION",
        reason: `Capability ${cap.name} has a side effect but declares no post-condition`,
      };
    }

    /**
     * §8 — the request has to have asked for a change before a change may be planned.
     *
     * Every other control in this pipeline authorises the ACTOR. This one authorises the
     * REQUEST, and it is the only place the difference between "why did this fail" and "fix
     * this" is visible at all. By the time a plan reaches policy, the two are indistinguishable:
     * same agent, same capability, same risk, same role.
     *
     * `cap.risk !== "LOW"` is the test rather than a separate write flag, because the registry
     * already refuses to load a MEDIUM-or-above capability over a READ tool. So "not LOW" and
     * "has a side effect" are the same set, kept in one place.
     */
    if (intent && cap.risk !== "LOW") {
      if (intent.humanOnly) {
        return {
          ok: false,
          code: "INTENT_HUMAN_ONLY",
          reason: describeIntentRefusal(intent, cap.name, agentId),
        };
      }
      if (!intent.permitsSideEffect) {
        return {
          ok: false,
          code: "INTENT_FORBIDS_SIDE_EFFECT",
          reason: describeIntentRefusal(intent, cap.name, agentId),
        };
      }
    }

    /**
     * §9 — an underspecified request produces a QUESTION, not a guess.
     *
     * Collected across every step rather than returned at the first miss, so an operator gets one
     * complete list of what the agent needs instead of a conversation that surfaces one missing
     * field per round trip.
     */
    for (const field of requiredArgumentsFor(cap.toolId)) {
      const supplied = step.arguments[field];
      const missing =
        supplied === undefined ||
        supplied === null ||
        (typeof supplied === "string" && supplied.trim().length === 0);
      if (missing) clarifications.push(clarificationFor(cap.name, field));
    }

    validated.push({
      ...step,
      resolved: cap,
      // Server-classified. `proposed.claimedRisk` is recorded for operators and never consulted.
      risk: cap.risk,
    });
  }

  /**
   * Checked after the loop, so the questions cover the whole plan.
   *
   * Deliberately AFTER every structural and authorisation check above: a plan that both names a
   * capability the agent does not own and omits an argument should be reported as the former.
   * Asking an operator to clarify an argument for a step that was never going to be permitted
   * wastes their time and hides the real refusal.
   */
  if (clarifications.length > 0) {
    return {
      ok: false,
      code: "NEEDS_CLARIFICATION",
      reason: `The request is missing ${clarifications.length} required detail${clarifications.length === 1 ? "" : "s"}`,
      questions: clarifications,
    };
  }

  return {
    ok: true,
    plan: {
      goal: proposed.goal,
      reason: proposed.reason,
      steps: validated,
      riskTier: highestRisk(validated),
      planHash: hashPlan(agentId, def.version, validated),
    },
  };
}
