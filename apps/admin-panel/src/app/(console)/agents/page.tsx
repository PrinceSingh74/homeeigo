"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Radio, ShieldAlert, Timer } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { AgentCard } from "@/components/agents/AgentCard";
import {
  Badge,
  DependencyBadge,
  Metric,
  PanelState,
  RiskBadge,
  RunStatusBadge,
  SectionHeading,
} from "@/components/agents/AgentPrimitives";
import { formatCost, formatMs, formatRelative } from "@/lib/agent-states";
import {
  useAgentOrphansQuery,
  useAgentOverviewQuery,
  useAgentRunsQuery,
} from "@/hooks/use-agents";

/**
 * Agent Command Center.
 *
 * An operations screen, not a chatbot surface. The question it answers on load is "is anything
 * wrong, and is anyone waiting on me" — everything else is one click away.
 *
 * Two rules it follows strictly (§66):
 *   - Nothing that is UNKNOWN renders as healthy or as zero. `null` from the server means the
 *     platform declined to measure, and it reads as "Insufficient data".
 *   - Blocking conditions render ABOVE the metrics, because a kill switch or an unseeded registry
 *     makes every number below it misleading.
 */

const RUN_FILTERS = [
  { id: "all", label: "All" },
  { id: "ESCALATED", label: "Escalated" },
  { id: "FAILED", label: "Failed" },
  { id: "COMPLETED", label: "Completed" },
] as const;

export default function AgentCommandCenterPage() {
  const overview = useAgentOverviewQuery();
  const orphans = useAgentOrphansQuery();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const runs = useAgentRunsQuery(statusFilter === "all" ? {} : { status: statusFilter });

  const agents = useMemo(() => overview.data?.agents ?? [], [overview.data]);
  const health = useMemo(() => overview.data?.health ?? [], [overview.data]);
  const dependencies = overview.data?.dependencies ?? [];
  const config = overview.data?.config;
  const readiness = overview.data?.readiness;

  const healthById = useMemo(
    () => new Map(health.map((h) => [h.agentId, h])),
    [health],
  );

  const fleet = useMemo(() => {
    const pendingApprovals = health.reduce((s, h) => s + h.pendingApprovals, 0);
    const inFlight = health.reduce((s, h) => s + h.metrics.inFlight, 0);
    const attention = health.filter((h) =>
      ["BLOCKED", "ERROR", "DEGRADED"].includes(h.state),
    ).length;
    // Summed only where the server actually measured. Treating null as 0 here would understate
    // spend and, worse, make "we have no data" look like "we spent nothing".
    const measured = health.filter((h) => h.metrics.costUsd !== null);
    const cost = measured.length
      ? measured.reduce((s, h) => s + (h.metrics.costUsd ?? 0), 0)
      : null;
    return { pendingApprovals, inFlight, attention, cost };
  }, [health]);

  const blocking = config?.killSwitch || (readiness && !readiness.ready);

  return (
    <PageShell
      title="Agent command center"
      subtitle="Governed agent runtimes — operational state, approvals, runs and dependency health"
    >
      {/* Blocking conditions first. Everything below is misleading while one of these holds. */}
      {config && !config.enabled ? (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-500/25 bg-zinc-500/10 p-3 text-sm text-zinc-300">
          <Radio className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Agent layer is switched off</p>
            <p className="text-xs">
              <code className="font-mono">AGENTS_ENABLED</code> is not <code>true</code>. No run
              starts, in any mode. Metrics below are historical.
            </p>
          </div>
        </div>
      ) : null}

      {config?.killSwitch ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Kill switch engaged</p>
            <p className="text-xs">
              No new agent run will start in any mode until it is released. Work already approved
              follows safe-state semantics.
            </p>
          </div>
        </div>
      ) : null}

      {readiness && !readiness.ready ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Agent layer is not ready</p>
            <p className="text-xs">
              {readiness.reasons.join(", ") || "Readiness probe failed"}
              {readiness.missingTools.length > 0
                ? ` — ${readiness.missingTools.length} capability tools are missing from the registry, so every tool call fails at the audit write, before the handler.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* Fleet summary */}
      <div className="biz-glass-panel rounded-xl p-4">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Metric
            label="Agents"
            value={
              overview.isLoading
                ? "—"
                : `${health.filter((h) => h.executionMode === "LIVE").length} live / ${agents.length}`
            }
            hint="Live means side effects are permitted right now"
          />
          <Metric
            label="Needing attention"
            value={overview.isLoading ? "—" : String(fleet.attention)}
            emphasis={fleet.attention > 0 ? "critical" : "positive"}
            hint="Blocked, error or degraded"
          />
          <Metric
            label="Awaiting human"
            value={overview.isLoading ? "—" : String(fleet.pendingApprovals)}
            emphasis={fleet.pendingApprovals > 0 ? "attention" : undefined}
            hint="Designed outcome for high-risk actions — not a failure"
          />
          <Metric
            label="In flight"
            value={overview.isLoading ? "—" : String(fleet.inFlight)}
            hint="Runs currently executing"
          />
          <Metric
            label="Spend / 24h"
            value={overview.isLoading ? "—" : formatCost(fleet.cost)}
            hint="Summed only across agents the server actually measured"
          />
        </dl>
        {blocking ? null : (
          <p className="mt-3 border-t border-[var(--color-biz-line)] pt-2 text-[11px] text-[var(--color-biz-muted)]">
            Execution environments:{" "}
            <span className="font-mono">{config?.executionEnvironments.join(", ")}</span> · an
            unrecognised environment keeps every agent in shadow.
          </p>
        )}
      </div>

      {/* Agents */}
      <section className="space-y-3">
        <SectionHeading
          title="Agents"
          subtitle="State is computed from flags, readiness, in-flight runs and measured failure rates"
        />
        <PanelState
          loading={overview.isLoading}
          error={overview.isError}
          empty={!overview.isLoading && agents.length === 0}
          emptyLabel="No agent definitions loaded."
        >
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.agentId} status={a} health={healthById.get(a.agentId)} />
            ))}
          </div>
        </PanelState>
      </section>

      {/* Dependencies */}
      <section className="space-y-3">
        <SectionHeading
          title="Dependency health"
          subtitle="Measured probes. A probe that cannot run reports Unknown — never OK."
        />
        <PanelState loading={overview.isLoading} error={overview.isError}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dependencies.map((d) => (
              <div
                key={d.name}
                className="biz-glass-panel flex items-start justify-between gap-3 rounded-lg p-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{d.name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">{d.detail}</p>
                </div>
                <DependencyBadge status={d.status} />
              </div>
            ))}
          </div>
        </PanelState>
      </section>

      {/* Live operations */}
      <section className="space-y-3">
        <SectionHeading
          title="Live operations"
          subtitle="Most recent agent runs across the fleet"
          right={
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter runs by status">
              {RUN_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={statusFilter === f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-biz-accent)] ${
                    statusFilter === f.id
                      ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-text)]"
                      : "border-[var(--color-biz-line)] text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />

        {/* Desktop: table. Mobile: cards — a shrunk table is unusable on a phone (§38). */}
        <div className="biz-glass-panel hidden overflow-x-auto rounded-xl md:block">
          <PanelState
            loading={runs.isLoading}
            error={runs.isError}
            empty={!runs.isLoading && (runs.data ?? []).length === 0}
            emptyLabel="No runs match this filter."
          >
            <table className="w-full min-w-[900px] text-left text-xs">
              <caption className="sr-only">Recent agent runs</caption>
              <thead className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Run</th>
                  <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Risk</th>
                  <th scope="col" className="px-4 py-2 font-medium">Mode</th>
                  <th scope="col" className="px-4 py-2 font-medium">Trigger</th>
                  <th scope="col" className="px-4 py-2 font-medium">Steps</th>
                  <th scope="col" className="px-4 py-2 font-medium">Latency</th>
                  <th scope="col" className="px-4 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr
                    key={r.runId}
                    className="border-b border-[var(--color-biz-line)] last:border-0 hover:bg-[var(--color-biz-elevated)]"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/agents/runs/${r.runId}`}
                        className="font-mono text-[11px] text-[var(--color-biz-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-biz-accent)]"
                      >
                        {r.runId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{r.agentId}</td>
                    <td className="px-4 py-2"><RunStatusBadge status={r.status} /></td>
                    <td className="px-4 py-2"><RiskBadge risk={r.riskTier} /></td>
                    <td className="px-4 py-2">
                      <Badge tone={r.mode === "LIVE" ? "positive" : "info"}>{r.mode}</Badge>
                    </td>
                    <td className="px-4 py-2 text-[var(--color-biz-muted)]">{r.triggerType}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {r.stepCount} / {r.toolCallCount} tools
                    </td>
                    <td className="px-4 py-2 tabular-nums">{formatMs(r.latencyMs)}</td>
                    <td className="px-4 py-2 text-[var(--color-biz-muted)]">
                      {formatRelative(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelState>
        </div>

        <div className="space-y-2 md:hidden">
          <PanelState
            loading={runs.isLoading}
            error={runs.isError}
            empty={!runs.isLoading && (runs.data ?? []).length === 0}
            emptyLabel="No runs match this filter."
          >
            {(runs.data ?? []).map((r) => (
              <Link
                key={r.runId}
                href={`/agents/runs/${r.runId}`}
                className="biz-glass-panel block rounded-lg p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[var(--color-biz-accent)]">
                    {r.runId.slice(0, 8)}
                  </span>
                  <RunStatusBadge status={r.status} />
                </div>
                <p className="mt-1 truncate text-xs">{r.agentId} · {r.triggerType}</p>
                <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">
                  {r.stepCount} steps · {formatMs(r.latencyMs)} · {formatRelative(r.createdAt)}
                </p>
              </Link>
            ))}
          </PanelState>
        </div>
      </section>

      {/* Recovery */}
      {(orphans.data?.count ?? 0) > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            title="Orphaned runs"
            subtitle="Abandoned by a dead process. Reported, never auto-restarted — a run whose side effect may have landed needs a human."
          />
          <div className="biz-glass-panel rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-amber-300">
              <Timer className="h-4 w-4" aria-hidden />
              {orphans.data?.count} run(s) past their lease
            </div>
            <ul className="mt-3 space-y-1 text-[11px] text-[var(--color-biz-muted)]">
              {(orphans.data?.orphans ?? []).slice(0, 5).map((o) => (
                <li key={o.runId} className="font-mono">
                  {o.runId.slice(0, 8)} · {o.agentId} · {o.status} · last beat{" "}
                  {formatRelative(o.heartbeatAt)}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-biz-muted)]">
        <Activity className="h-3 w-3" aria-hidden />
        Counts shown as “Insufficient data” are not zero — the platform declined to compute a rate
        from fewer than five runs.
      </p>
    </PageShell>
  );
}
