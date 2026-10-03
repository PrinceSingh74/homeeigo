"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleSlash, ShieldAlert, XCircle } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { useAgentRunQuery } from "@/hooks/use-agents";

import { FRESHNESS_HINT } from "@/lib/agent-states";
import type { AgentRunStep } from "@/services/agents-api";

/**
 * One run's timeline — §66.
 *
 * Assembled entirely from persisted rows. The plan block shows the capability names, the server's
 * risk classification and the redacted arguments that were actually authorised; the step list shows
 * what each step did and, crucially, what was OBSERVED afterwards. There is no model narration
 * anywhere on this page, because a model's account of its own run is a claim about it rather than a
 * record of it — and the two diverge in exactly the cases an operator is here to investigate.
 *
 * The tool-execution table at the bottom is the independent check. It comes from
 * `ai_tool_executions`, the authoritative record every non-agent caller writes to as well, so an
 * operator can confirm the agent's own step rows against a source the agent layer does not own.
 */

const STEP_STYLES: Record<string, { cls: string; icon: typeof CheckCircle2 }> = {
  VERIFIED: { cls: "text-emerald-400", icon: CheckCircle2 },
  EXECUTED: { cls: "text-emerald-400", icon: CheckCircle2 },
  SHADOWED: { cls: "text-sky-400", icon: CircleSlash },
  PLANNED: { cls: "text-zinc-400", icon: CircleSlash },
  SKIPPED: { cls: "text-zinc-400", icon: CircleSlash },
  AWAITING_APPROVAL: { cls: "text-amber-400", icon: ShieldAlert },
  POLICY_DENIED: { cls: "text-amber-400", icon: ShieldAlert },
  VERIFICATION_FAILED: { cls: "text-red-400", icon: XCircle },
  INDETERMINATE: { cls: "text-orange-400", icon: ShieldAlert },
  FAILED: { cls: "text-red-400", icon: XCircle },
};

function VerificationCell({ step }: { step: AgentRunStep }) {
  const v = step.verification as
    | {
        verdict?: string;
        check?: string;
        observed?: string;
        expected?: string;
        reason?: string;
        freshness?: { verdict?: string; field?: string; ageMs?: number; reason?: string };
      }
    | null;
  if (!v?.verdict) return <span className="text-[var(--color-biz-muted)]">—</span>;

  const tone =
    v.verdict === "VERIFIED"
      ? "text-emerald-400"
      : v.verdict === "FAILED"
        ? "text-red-400"
        : v.verdict === "UNKNOWN"
          ? "text-orange-400"
          : "text-zinc-400";

  return (
    <div className="space-y-0.5">
      <span className={`font-medium ${tone}`}>{v.verdict}</span>
      {/*
        `observed` is the point of the whole column. "The tool succeeded" and "the world changed"
        are different claims, and this is the one that says which of them is actually supported.
      */}
      {v.observed ? (
        <p className="text-[11px] text-[var(--color-biz-muted)]">
          observed: <span className="font-mono">{v.observed}</span>
        </p>
      ) : null}
      {v.reason ? <p className="text-[11px] text-[var(--color-biz-muted)]">{v.reason}</p> : null}
      {/*
        Freshness sits beside the post-condition because an operator reading a step needs BOTH
        answers: did the write land, and was the data behind it current. A verified write on
        stale evidence is a real outcome that neither column alone describes.

        UNKNOWN is amber, not neutral. Everywhere else neutral means 'nothing to report'; here
        it would mean 'we could not date what we acted on', which is the opposite of nothing.
      */}
      {v.freshness?.verdict && v.freshness.verdict !== "NOT_REQUIRED" ? (
        <p
          className={`text-[11px] ${
            v.freshness.verdict === "FRESH" ? "text-[var(--color-biz-muted)]" : "text-amber-400"
          }`}
          title={FRESHNESS_HINT[v.freshness.verdict] ?? undefined}
        >
          data {v.freshness.verdict.toLowerCase()}
          {typeof v.freshness.ageMs === "number"
            ? ` · ${Math.round(v.freshness.ageMs / 1000)}s old`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

export default function AgentRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const query = useAgentRunQuery(runId);
  const run = query.data?.run;
  const executions = query.data?.executions ?? [];

  const plan = run?.plan as
    | {
        goal?: string;
        reason?: string;
        steps?: Array<{
          capability: string;
          risk: string;
          reason: string;
          expectedEffect: string;
          arguments: Record<string, unknown>;
        }>;
      }
    | null
    | undefined;

  return (
    <PageShell
      title="Agent run"
      subtitle={run ? `${run.agentId} · ${run.status}` : "Loading run timeline…"}
    >
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-biz-accent)] hover:underline"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to control center
      </Link>

      {query.isLoading ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Loading…</p>
      ) : query.isError || !run ? (
        <p className="text-sm text-red-400">This run could not be loaded.</p>
      ) : (
        <>
          <section className="biz-glass-panel p-5">
            <h2 className="text-sm font-semibold">Identity</h2>
            {/*
              Versions are shown because a run is only interpretable against the definition it ran
              under. "Why did it do that" is unanswerable if the agent, prompt, policy and toolset
              have all moved on since.
            */}
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-xs md:grid-cols-4">
              <div>
                <dt className="text-[var(--color-biz-muted)]">Run</dt>
                <dd className="mt-0.5 font-mono text-[11px] break-all">{run.runId}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Agent / prompt</dt>
                <dd className="mt-0.5 font-mono text-[11px]">
                  {run.agentVersion} · {run.agentId}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Policy ruleset</dt>
                <dd className="mt-0.5 font-mono text-[11px]">{run.policyVersion ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Toolset</dt>
                <dd className="mt-0.5 font-mono text-[11px]">{run.toolsetVersion ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Model</dt>
                <dd className="mt-0.5 font-mono text-[11px]">
                  {run.modelProvider ?? "—"} / {run.modelName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Trigger</dt>
                <dd className="mt-0.5">
                  {run.triggerType}
                  {run.subjectId ? ` · ${run.subjectType}:${run.subjectId}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Causation / depth</dt>
                <dd className="mt-0.5 font-mono text-[11px]">
                  {run.causationId ? run.causationId.slice(0, 12) : "—"} · d{run.depth}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-biz-muted)]">Cost / tokens</dt>
                <dd className="mt-0.5">
                  ${(run.costUsd ?? 0).toFixed(5)} · {run.promptTokens + run.completionTokens}
                </dd>
              </div>
            </dl>

            {run.escalationReason ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-semibold">Handed to a human</p>
                  <p>{run.escalationReason}</p>
                </div>
              </div>
            ) : null}
          </section>

          {plan?.steps ? (
            <section className="biz-glass-panel p-5">
              <h2 className="text-sm font-semibold">Authorised plan</h2>
              <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{plan.reason}</p>
              <p className="mt-2 font-mono text-[11px] text-[var(--color-biz-muted)]">
                hash {run.planHash?.slice(0, 16) ?? "—"}
              </p>
              <ol className="mt-3 space-y-2">
                {plan.steps.map((s, i) => (
                  <li key={`${s.capability}-${i}`} className="rounded-md border border-[var(--color-biz-line)] p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px]">{s.capability}</span>
                      <span className="text-[10px] text-[var(--color-biz-muted)]">{s.risk}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">{s.reason}</p>
                    <pre className="mt-1 overflow-x-auto text-[10px] text-[var(--color-biz-muted)]">
                      {JSON.stringify(s.arguments)}
                    </pre>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Step timeline</h2>
            <div className="biz-glass-panel overflow-x-auto" tabIndex={0} role="region" aria-label="Step timeline table">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Phase</th>
                    <th className="px-4 py-2 font-medium">Capability</th>
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-4 py-2 font-medium">Policy</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Verification</th>
                    <th className="px-4 py-2 font-medium">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {run.steps.map((s) => {
                    const style = STEP_STYLES[s.status] ?? { cls: "text-zinc-400", icon: CircleSlash };
                    const Icon = style.icon;
                    return (
                      <tr key={s.stepIndex} className="border-b border-[var(--color-biz-line)] last:border-0 align-top">
                        <td className="px-4 py-2">{s.stepIndex}</td>
                        <td className="px-4 py-2 text-[var(--color-biz-muted)]">{s.phase}</td>
                        <td className="px-4 py-2 font-mono text-[11px]">{s.capability ?? "—"}</td>
                        <td className="px-4 py-2 font-mono text-[11px]">{s.toolId ?? "—"}</td>
                        <td className="px-4 py-2 text-[var(--color-biz-muted)]">{s.policyDecision ?? "—"}</td>
                        <td className={`px-4 py-2 ${style.cls}`}>
                          <span className="inline-flex items-center gap-1">
                            <Icon className="h-3 w-3" aria-hidden />
                            {s.status}
                          </span>
                          {s.errorCode ? (
                            <p className="text-[11px] text-[var(--color-biz-muted)]">{s.errorCode}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <VerificationCell step={s} />
                        </td>
                        <td className="px-4 py-2">{s.durationMs ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Authoritative tool executions</h2>
            <p className="text-xs text-[var(--color-biz-muted)]">
              From <span className="font-mono">ai_tool_executions</span> — the same record every
              non-agent caller writes to. Shown separately so the agent&apos;s own step rows can be
              checked against a source the agent layer does not own.
            </p>
            <div className="biz-glass-panel overflow-x-auto" tabIndex={0} role="region" aria-label="Authoritative tool executions table">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Execution</th>
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Policy</th>
                    <th className="px-4 py-2 font-medium">Approval</th>
                    <th className="px-4 py-2 font-medium">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((e) => (
                    <tr key={e.executionId} className="border-b border-[var(--color-biz-line)] last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px]">{e.executionId.slice(0, 8)}</td>
                      <td className="px-4 py-2 font-mono text-[11px]">{e.toolId}</td>
                      <td className="px-4 py-2">{e.status}</td>
                      <td className="px-4 py-2 text-[var(--color-biz-muted)]">{e.policyDecision}</td>
                      <td className="px-4 py-2 font-mono text-[11px]">
                        {e.approvalId ? e.approvalId.slice(0, 8) : "—"}
                      </td>
                      <td className="px-4 py-2">{e.durationMs ?? "—"}</td>
                    </tr>
                  ))}
                  {executions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-[var(--color-biz-muted)]">
                        No tool executed in this run.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
