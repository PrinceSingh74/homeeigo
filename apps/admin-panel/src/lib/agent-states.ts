import type { AgentOperationalState, DependencyHealth } from "@/services/agents-api";

/**
 * The single place that decides how an agent state looks and reads.
 *
 * Every screen imports from here. Without one vocabulary, two surfaces eventually disagree about
 * whether `WAITING_APPROVAL` is a warning or a success — and an operator who sees the same state
 * rendered two ways stops trusting either.
 *
 * Three rules encoded in the table below, from §30 and §66:
 *
 *   1. UNKNOWN is never styled as healthy. It gets its own neutral treatment, never green.
 *   2. WAITING_APPROVAL is never styled as a failure. It is the DESIGNED outcome for high-risk
 *      work — colouring it red would train operators to treat correct governance as an incident.
 *   3. BLOCKED is never styled as OFF. "Someone turned this off" and "this cannot run" require
 *      completely different responses, and collapsing them hides the second one entirely.
 */

export type StateTone = "neutral" | "info" | "positive" | "attention" | "critical";

export type StatePresentation = {
  label: string;
  tone: StateTone;
  /** One line an operator can act on. Never a restatement of the label. */
  hint: string;
  /** True when the state means "work is with a human", not "something is wrong". */
  awaitingHuman?: boolean;
};

export const AGENT_STATE: Record<AgentOperationalState, StatePresentation> = {
  OFF: {
    label: "Off",
    tone: "neutral",
    hint: "Switched off. Nothing runs, not even planning.",
  },
  SHADOW: {
    label: "Shadow",
    tone: "info",
    hint: "Planning and authorising without side effects. The safe state, not a fault.",
  },
  READY: {
    label: "Ready",
    tone: "positive",
    hint: "Enabled and able to execute. No runs in the measurement window.",
  },
  RUNNING: {
    label: "Running",
    tone: "positive",
    hint: "Runs currently in flight.",
  },
  WAITING_APPROVAL: {
    // Amber, never red. A human being the bottleneck is the system working as designed.
    label: "Waiting on human",
    tone: "attention",
    hint: "Work is with an approver. This is the designed outcome for high-risk actions.",
    awaitingHuman: true,
  },
  DEGRADED: {
    label: "Degraded",
    tone: "attention",
    hint: "Enabled, but failing a significant share of runs.",
  },
  BLOCKED: {
    // Deliberately critical rather than neutral: BLOCKED is not OFF. Something is preventing
    // execution that nobody chose, and it will not resolve on its own.
    label: "Blocked",
    tone: "critical",
    hint: "Cannot execute. A kill switch or an unmet prerequisite is in the way.",
  },
  ERROR: {
    label: "Error",
    tone: "critical",
    hint: "Enabled and failing almost everything. Needs attention now.",
  },
  CONTROLLED: {
    label: "Controlled rollout",
    tone: "info",
    hint: "Enabled for a percentage of subjects. Widen only on evidence.",
  },
  LIVE: {
    label: "Live",
    tone: "positive",
    hint: "Fully enabled and executing.",
  },
};

export const DEPENDENCY_STATE: Record<DependencyHealth["status"], StatePresentation> = {
  OK: { label: "OK", tone: "positive", hint: "Probe succeeded." },
  DEGRADED: { label: "Degraded", tone: "attention", hint: "Probe succeeded with a warning signal." },
  DOWN: { label: "Down", tone: "critical", hint: "Probe failed." },
  UNKNOWN: {
    // The whole point of having this state. A probe that could not run is not a healthy probe.
    label: "Unknown",
    tone: "neutral",
    hint: "The probe could not determine a result. This is not the same as healthy.",
  },
};

/** Tailwind classes per tone. Kept here so a tone can be restyled in exactly one place. */
export const TONE_CLASS: Record<StateTone, string> = {
  neutral: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300",
  info: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  positive: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  attention: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  critical: "border-red-500/25 bg-red-500/10 text-red-300",
};

/** The small coloured dot used in dense rows where a full badge would be noise. */
export const TONE_DOT: Record<StateTone, string> = {
  neutral: "bg-zinc-400",
  info: "bg-sky-400",
  positive: "bg-emerald-400",
  attention: "bg-amber-400",
  critical: "bg-red-400",
};

export const RUN_STATUS_TONE: Record<string, StateTone> = {
  COMPLETED: "positive",
  VERIFYING: "info",
  EXECUTING: "info",
  PLANNING: "info",
  WAITING_POLICY: "info",
  CREATED: "neutral",
  // Not a failure. A run that hands off to a human has done the right thing.
  WAITING_APPROVAL: "attention",
  ESCALATED: "attention",
  FAILED: "critical",
  TIMED_OUT: "critical",
  ROLLED_BACK: "attention",
  CANCELLED: "neutral",
};

export const RISK_TONE: Record<string, StateTone> = {
  LOW: "positive",
  MEDIUM: "attention",
  HIGH: "critical",
};

/**
 * The eleven intents, and what each one licenses.
 *
 * Rendered so an operator can see, before running anything, whether their request will be able to
 * change something. That visibility is the point: the most confusing possible outcome is a run
 * that refuses a step for a reason the person cannot see, and "you asked a question, so I did not
 * act" is only a good answer if the screen said so first.
 *
 * `canAct` mirrors the server's `EXECUTING_INTENTS` set. It is presentation only — the server
 * decides, and a client that disagreed would simply be showing the wrong label on a refusal.
 */
export type IntentPresentation = {
  label: string;
  tone: StateTone;
  hint: string;
  canAct: boolean;
};

export const AGENT_INTENT: Record<string, IntentPresentation> = {
  QUERY: { label: "Query", tone: "info", hint: "Look something up. Reads only.", canAct: false },
  ANALYZE: { label: "Analyse", tone: "info", hint: "Assess or compare. Reads only.", canAct: false },
  EXPLAIN: { label: "Explain", tone: "info", hint: "Account for why something happened. Reads only.", canAct: false },
  INVESTIGATE: { label: "Investigate", tone: "info", hint: "Assemble evidence. Reads only.", canAct: false },
  RECOMMEND: { label: "Recommend", tone: "info", hint: "Propose next steps without taking them.", canAct: false },
  SIMULATE: { label: "Simulate", tone: "info", hint: "Model an outcome. Nothing is changed.", canAct: false },
  DRAFT: { label: "Draft", tone: "info", hint: "Prepare text for a person to send.", canAct: false },
  EXECUTE: { label: "Execute", tone: "attention", hint: "May change something, within this agent's limits.", canAct: true },
  ESCALATE: { label: "Escalate", tone: "attention", hint: "Hand the work to a human, on the record.", canAct: true },
  // Amber rather than red: asking for one of these is reasonable. The refusal is the point.
  APPROVE: { label: "Approve", tone: "attention", hint: "A human decision. No agent can make it.", canAct: false },
  REJECT: { label: "Reject", tone: "attention", hint: "A human decision. No agent can make it.", canAct: false },
};

/**
 * How the intent was arrived at.
 *
 * Worth showing because DEFAULTED means the classifier did not recognise the request at all and
 * fell back to the read-only reading. An operator seeing a refused write needs to be able to tell
 * "the system understood me and said no" from "the system did not understand me".
 */
export const INTENT_SOURCE_HINT: Record<string, string> = {
  DECLARED: "You chose this intent.",
  CLASSIFIED: "Read from the wording of your request.",
  DEFAULTED: "The wording was not recognised, so the safest read-only reading was used.",
};

/**
 * A stop reason that means "the agent needs one more detail", not "the agent failed".
 *
 * These runs land as ESCALATED, which is correct — a human is now needed — but they read very
 * differently from a policy escalation and must not be presented as a fault.
 */
export function isClarificationStop(stopReason: string | null | undefined): boolean {
  return stopReason === "NEEDS_CLARIFICATION";
}

/**
 * How old the evidence behind a step was.
 *
 * UNKNOWN is deliberately NOT neutral here. In every other table a neutral tone means "nothing to
 * report"; for freshness it means the platform could not date the data it acted on, which is the
 * thing an operator most needs to notice.
 */
export const FRESHNESS_TONE: Record<string, StateTone> = {
  FRESH: "positive",
  NOT_REQUIRED: "neutral",
  STALE: "attention",
  UNKNOWN: "attention",
};

export const FRESHNESS_HINT: Record<string, string> = {
  FRESH: "The underlying data was current when this step ran.",
  NOT_REQUIRED: "This capability's result does not age in a way that could mislead.",
  STALE: "The data was older than this capability allows. It cannot justify a change.",
  UNKNOWN: "The data carried no timestamp, so its age could not be established. This is not the same as current.",
};

/**
 * Render a rate, or say the data is insufficient.
 *
 * §34 is explicit: where data is insufficient, show INSUFFICIENT DATA, not 0. The server returns
 * `null` for a rate it declines to compute (fewer than five runs), and this is the only function
 * that decides how that renders — so no screen can accidentally turn a null into "0%".
 */
export function formatRate(value: number | null): string {
  if (value === null) return "Insufficient data";
  return `${Math.round(value * 100)}%`;
}

/** Same contract for counts: null means not measured, and reads differently from zero. */
export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString();
}

export function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatCost(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(4)}`;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
