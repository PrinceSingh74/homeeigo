"use client";

import { useState } from "react";
import {
  AGENT_INTENT,
  INTENT_SOURCE_HINT,
  TONE_CLASS,
  TONE_DOT,
} from "@/lib/agent-states";
import { useStartAgentRunMutation } from "@/hooks/use-agents";
import { Badge, RunStatusBadge } from "./AgentPrimitives";
import type { AgentStatus } from "@/services/agents-api";

/**
 * §51 — the command surface for one agent.
 *
 * ── Why this is not a chat box ────────────────────────────────────────────────
 *
 * A free-text box that runs whatever comes back is the exact shape Phase 16 replaces. This one
 * makes the two things that decide what a run may do VISIBLE BEFORE IT STARTS:
 *
 *   1. The INTENT. The operator picks it, or leaves it to be read from their wording. Either way
 *      the panel says, in plain words, whether this request will be able to change anything.
 *   2. The MODE. Shadow is the default. An exploratory run an operator kicks off should never be
 *      the path by which a side effect happens.
 *
 * The alternative — discovering after the fact that a step was refused "because you only asked a
 * question" — is technically correct and operationally maddening. A refusal is only a good answer
 * if the screen said it was coming.
 *
 * ── What it deliberately cannot do ────────────────────────────────────────────
 *
 * There is no tool picker and no argument editor. The operator expresses a GOAL; the agent's
 * capability allowlist, the policy engine and the risk ceiling decide the rest. A UI that let
 * someone name a tool would be a second, ungoverned execution path wearing the same styling as
 * the governed one.
 */

/** Offered in the order an operator reaches for them, read-only first. */
const OFFERED_INTENTS = [
  "QUERY",
  "EXPLAIN",
  "ANALYZE",
  "INVESTIGATE",
  "RECOMMEND",
  "EXECUTE",
  "ESCALATE",
] as const;

export function AgentCommandBar({ agent }: { agent: AgentStatus }) {
  const [goal, setGoal] = useState("");
  const [intent, setIntent] = useState<string>("");
  const [live, setLive] = useState(false);
  const mutation = useStartAgentRunMutation();

  /**
   * A read-only agent can never act, whatever intent is chosen.
   *
   * Shown as a disabled control with a reason rather than hidden: an operator who cannot find the
   * Execute option learns nothing, while one who sees it greyed out with "this assistant has no
   * write capability" learns the actual shape of the system.
   */
  const canEverAct = !agent.readOnly;

  const selected = intent ? AGENT_INTENT[intent] : undefined;
  const willBeAbleToAct = Boolean(selected?.canAct) && canEverAct && live;

  const result = mutation.data;
  const clarifications = result?.clarifications ?? [];
  const resolvedIntent = result?.intent;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (goal.trim().length < 3 || mutation.isPending) return;
    mutation.mutate({
      agentId: agent.agentId,
      goal: goal.trim(),
      // Omitted rather than sent empty when the operator did not choose one, so the server
      // classifies the wording instead of receiving a value it would have to reject.
      intent: intent || undefined,
      mode: live && canEverAct ? undefined : "shadow",
    });
  }

  return (
    <section className="biz-glass-panel rounded-xl p-4" aria-labelledby="command-heading">
      <h2 id="command-heading" className="text-sm font-semibold text-[var(--color-biz-text)]">
        Ask {agent.name}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
        Describe what you need. The agent plans against its own capabilities — you cannot name a
        tool, and it cannot reach one it does not hold.
      </p>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <label className="block">
          <span className="sr-only">What do you need?</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Which zones are under capacity pressure right now?"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-[var(--color-biz-text)] placeholder:text-[var(--color-biz-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          />
        </label>

        <fieldset>
          <legend className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-biz-muted)]">
            Intent
          </legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Request intent">
            <IntentChip
              label="Read from my wording"
              active={intent === ""}
              onClick={() => setIntent("")}
              title="The platform classifies your request. Anything it does not recognise is treated as read-only."
            />
            {OFFERED_INTENTS.map((id) => {
              const p = AGENT_INTENT[id];
              const unavailable = p.canAct && !canEverAct;
              return (
                <IntentChip
                  key={id}
                  label={p.label}
                  active={intent === id}
                  disabled={unavailable}
                  onClick={() => setIntent(id)}
                  title={
                    unavailable
                      ? `${agent.name} is read-only — it holds no capability that changes anything.`
                      : p.hint
                  }
                />
              );
            })}
          </div>
        </fieldset>

        {/*
          The consequence line. This is the whole reason the intent is a control rather than a
          hidden classification: the operator reads what this run will be allowed to do before
          they start it, not after a step is refused.
        */}
        <p
          className={`rounded-lg border px-3 py-2 text-xs ${
            willBeAbleToAct ? TONE_CLASS.attention : TONE_CLASS.info
          }`}
        >
          {willBeAbleToAct
            ? "This run may change something, within this agent's limits. High-risk actions still go to a human."
            : selected?.canAct && !live
              ? "Shadow mode: the agent will plan and authorise the change, then stop without making it."
              : "This run will read and explain only. No change will be made."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`flex items-center gap-2 text-xs ${
              canEverAct ? "text-[var(--color-biz-text)]" : "text-[var(--color-biz-muted)]"
            }`}
            title={
              canEverAct
                ? "Off by default. An exploratory run should never be how a side effect happens."
                : `${agent.name} is read-only by construction.`
            }
          >
            <input
              type="checkbox"
              checked={live && canEverAct}
              disabled={!canEverAct}
              onChange={(e) => setLive(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-black/30 focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            />
            Allow this run to act
          </label>

          <button
            type="submit"
            disabled={goal.trim().length < 3 || mutation.isPending}
            className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {mutation.isPending ? "Running…" : "Run"}
          </button>
        </div>
      </form>

      {mutation.isError && (
        <p role="alert" className={`mt-3 rounded-lg border px-3 py-2 text-xs ${TONE_CLASS.critical}`}>
          The run could not be started. {(mutation.error as Error)?.message ?? ""}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={result.status} />
            <Badge tone={result.mode === "LIVE" ? "attention" : "info"}>{result.mode}</Badge>
            {resolvedIntent && (
              <Badge
                tone={AGENT_INTENT[resolvedIntent.intent]?.tone ?? "neutral"}
                // Both halves: how the intent was decided, and the exact evidence for it. An
                // operator questioning a refusal can see the words that produced it.
                title={`${INTENT_SOURCE_HINT[resolvedIntent.source] ?? ""} ${resolvedIntent.evidence}`.trim()}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    TONE_DOT[AGENT_INTENT[resolvedIntent.intent]?.tone ?? "neutral"]
                  }`}
                  aria-hidden
                />
                {AGENT_INTENT[resolvedIntent.intent]?.label ?? resolvedIntent.intent}
              </Badge>
            )}
            <a
              href={`/agents/runs/${result.runId}`}
              className="ml-auto text-xs text-emerald-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            >
              Full timeline →
            </a>
          </div>

          {/*
            §9 — the agent needed one more detail. This is NOT a failure, and it must not be
            styled as one: the run understood the request, found the single thing it could not
            supply, and asked. Presenting that in red would teach operators that asking good
            questions is a fault.
          */}
          {clarifications.length > 0 && (
            <div className={`rounded-lg border px-3 py-2 ${TONE_CLASS.attention}`}>
              <p className="text-xs font-medium">One more detail is needed</p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {clarifications.map((q) => (
                  <li key={`${q.capability}:${q.field}`}>
                    {q.question}{" "}
                    <span className="opacity-70">({q.capability})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-3 text-xs leading-relaxed text-[var(--color-biz-text)]">
            {result.summary}
          </pre>
          <p className="text-[11px] text-[var(--color-biz-muted)]">
            Assembled from the recorded steps, not written by the model.
          </p>
        </div>
      )}
    </section>
  );
}

function IntentChip({
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
        active
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
          : "border-white/10 bg-white/[0.03] text-[var(--color-biz-muted)] hover:border-white/20"
      } ${disabled ? "cursor-not-allowed opacity-35" : ""}`}
    >
      {label}
    </button>
  );
}
