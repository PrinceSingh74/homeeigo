"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, ShieldAlert } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import {
  AgentStateBadge,
  Badge,
  Metric,
  PanelState,
  RiskBadge,
  RunStatusBadge,
  SectionHeading,
} from "@/components/agents/AgentPrimitives";
import { AgentCommandBar } from "@/components/agents/AgentCommandBar";
import {
  formatCost,
  formatCount,
  formatMs,
  formatRate,
  formatRelative,
} from "@/lib/agent-states";
import { useAgentOverviewQuery, useAgentRunsQuery } from "@/hooks/use-agents";

/**
 * One agent's workspace.
 *
 * Answers, in order: what state is it in and why, what is it allowed to do, what has it actually
 * been doing, and what is waiting on a human. The capability list is shown in full rather than
 * behind a disclosure, because "what can this thing do" is the first question anyone asks about an
 * agent and hiding it behind a click makes the answer feel evasive.
 */
export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const overview = useAgentOverviewQuery();
  const runs = useAgentRunsQuery({ agentId });


  const status = useMemo(
    () => (overview.data?.agents ?? []).find((a) => a.agentId === agentId),
    [overview.data, agentId],
  );
  const health = useMemo(
    () => (overview.data?.health ?? []).find((h) => h.agentId === agentId),
    [overview.data, agentId],
  );

  const m = health?.metrics;

  return (
    <PageShell
      title={status?.name ?? "Agent"}
      subtitle={status?.description ?? "Loading agent definition…"}
    >
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-biz-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-biz-accent)]"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to command center
      </Link>

      <PanelState
        loading={overview.isLoading}
        error={overview.isError || (!overview.isLoading && !status)}
      >
        {status && (
          <>
            {/* State + why, before any number. */}
            <section className="biz-glass-panel rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                {health ? (
                  <AgentStateBadge state={health.state} reason={health.stateReason} />
                ) : null}
                {status.readOnly ? (
                  <Badge tone="info" title="No write capability at all — enforced at registry load">
                    <Lock className="h-3 w-3" aria-hidden />
                    Read-only
                  </Badge>
                ) : null}
                <Badge tone="neutral">Max autonomous risk: {status.maxAutonomousRisk}</Badge>
                <Badge tone="neutral">Runs as {status.actorRole}</Badge>
                {health?.rolloutPct !== null && health?.rolloutPct !== undefined ? (
                  <Badge tone="info">Rollout {health.rolloutPct}%</Badge>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-[var(--color-biz-muted)]">{health?.stateReason}</p>

              {health && health.pendingApprovals > 0 ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">
                      {health.pendingApprovals} action(s) awaiting a human decision
                    </p>
                    <p>
                      Decide these in the{" "}
                      <Link href="/ai-brain/approvals" className="underline">
                        High-Risk Approvals
                      </Link>{" "}
                      queue — the surface that carries non-self-approval and single-consume rules.
                    </p>
                  </div>
                </div>
              ) : null}

              <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-6">
                <Metric label={`Runs / ${m?.windowHours ?? 24}h`} value={formatCount(m?.runs ?? null)} />
                <Metric label="Completed" value={formatCount(m?.completed ?? null)} />
                <Metric label="Failed" value={formatCount(m?.failed ?? null)} />
                <Metric label="Escalated" value={formatCount(m?.escalated ?? null)} />
                <Metric label="Success" value={formatRate(m?.successRate ?? null)} />
                <Metric label="Spend" value={formatCost(m?.costUsd ?? null)} />
              </dl>
              <dl className="mt-3 grid grid-cols-2 gap-4 border-t border-[var(--color-biz-line)] pt-3 md:grid-cols-4">
                <Metric label="Avg latency" value={formatMs(m?.avgLatencyMs ?? null)} />
                <Metric label="p95 latency" value={formatMs(m?.p95LatencyMs ?? null)} />
                <Metric
                  label="Verification failures"
                  value={formatCount(m?.verificationFailures ?? null)}
                  emphasis={(m?.verificationFailures ?? 0) > 0 ? "critical" : undefined}
                  hint="Tool reported success, the world disagreed"
                />
                <Metric label="Last run" value={formatRelative(m?.lastRunAt ?? null)} />
              </dl>
            </section>

            <AgentCommandBar agent={status} />

            {/* Capabilities — the agent's entire vocabulary. */}
            <section className="space-y-3">
              <SectionHeading
                title="Capabilities"
                subtitle="The complete set. A plan naming anything outside this list is rejected before any tool lookup."
              />
              <div className="grid gap-2 md:grid-cols-2">
                {status.capabilities.map((c) => (
                  <div key={c.name} className="biz-glass-panel rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px]">{c.name}</span>
                      <RiskBadge risk={c.risk} />
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">{c.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.dataClasses.map((dc) => (
                        <Badge key={dc} tone="neutral">{dc}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Bounds */}
            <section className="space-y-3">
              <SectionHeading
                title="Bounds"
                subtitle="Checked before each step, never after. The tighter of the agent's own limit and the platform ceiling."
              />
              <dl className="biz-glass-panel grid grid-cols-2 gap-4 rounded-xl p-4 md:grid-cols-6">
                <Metric label="Max steps" value={String(status.bounds.maxSteps)} />
                <Metric label="Max tools" value={String(status.bounds.maxToolCalls)} />
                <Metric label="Max elapsed" value={formatMs(status.bounds.maxElapsedMs)} />
                <Metric label="Max cost" value={`$${status.bounds.maxCostUsd}`} />
                <Metric label="Max tokens" value={status.bounds.maxTokens.toLocaleString()} />
                <Metric label="Max depth" value={String(status.bounds.maxDepth)} />
              </dl>
            </section>

            {/* Runs */}
            <section className="space-y-3">
              <SectionHeading title="Recent runs" subtitle={`Last ${runs.data?.length ?? 0} for this agent`} />
              <div className="biz-glass-panel overflow-x-auto rounded-xl">
                <PanelState
                  loading={runs.isLoading}
                  error={runs.isError}
                  empty={!runs.isLoading && (runs.data ?? []).length === 0}
                  emptyLabel="This agent has not run yet."
                >
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <caption className="sr-only">Recent runs for {status.name}</caption>
                    <thead className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Run</th>
                        <th scope="col" className="px-4 py-2 font-medium">Status</th>
                        <th scope="col" className="px-4 py-2 font-medium">Risk</th>
                        <th scope="col" className="px-4 py-2 font-medium">Trigger</th>
                        <th scope="col" className="px-4 py-2 font-medium">Stopped</th>
                        <th scope="col" className="px-4 py-2 font-medium">Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(runs.data ?? []).map((r) => (
                        <tr key={r.runId} className="border-b border-[var(--color-biz-line)] last:border-0">
                          <td className="px-4 py-2">
                            <Link
                              href={`/agents/runs/${r.runId}`}
                              className="font-mono text-[11px] text-[var(--color-biz-accent)] hover:underline"
                            >
                              {r.runId.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-4 py-2"><RunStatusBadge status={r.status} /></td>
                          <td className="px-4 py-2"><RiskBadge risk={r.riskTier} /></td>
                          <td className="px-4 py-2 text-[var(--color-biz-muted)]">{r.triggerType}</td>
                          <td className="px-4 py-2 font-mono text-[11px] text-[var(--color-biz-muted)]">
                            {r.stopReason ?? r.errorCode ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-[var(--color-biz-muted)]">
                            {formatRelative(r.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </PanelState>
              </div>
            </section>
          </>
        )}
      </PanelState>
    </PageShell>
  );
}
