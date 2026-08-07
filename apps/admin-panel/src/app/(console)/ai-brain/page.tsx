"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  Clock,
  Database,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";

export default function AiBrainConsolePage() {
  const timeline = useQuery({
    queryKey: ["ai-brain-timeline"],
    queryFn: () => adminApi.aiBrain.timeline(7),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const memoryStats = useQuery({
    queryKey: ["ai-brain-memory-stats"],
    queryFn: () => adminApi.aiBrain.memoryStats(),
    staleTime: 60_000,
  });
  const prompts = useQuery({
    queryKey: ["ai-brain-prompts"],
    queryFn: () => adminApi.aiBrain.prompts(),
    staleTime: 60_000,
  });
  const contextHistory = useQuery({
    queryKey: ["ai-brain-context-history"],
    queryFn: () => adminApi.aiBrain.contextHistory(15),
    staleTime: 30_000,
  });
  const health = useQuery({
    queryKey: ["ai-brain-health"],
    queryFn: () => adminApi.aiBrain.health(),
    staleTime: 30_000,
  });

  const stats = (timeline.data as { stats?: Record<string, unknown> })?.stats;
  const entries = (timeline.data as { entries?: Array<Record<string, unknown>> })?.entries ?? [];
  const analytics = (timeline.data as { analytics?: Array<Record<string, unknown>> })?.analytics ?? [];
  const promptList = (prompts.data as { prompts?: Array<Record<string, unknown>> })?.prompts ?? [];
  const memStats = memoryStats.data as Record<string, unknown> | undefined;
  const ctxHistory = (contextHistory.data as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 biz-page-enter">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="text-cyan-400" size={28} />
            Enterprise AI Brain
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Context engineering, memory platform, and prompt intelligence
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void timeline.refetch();
            void memoryStats.refetch();
            void prompts.refetch();
            void contextHistory.refetch();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          <RefreshCw size={14} className={timeline.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {timeline.isLoading ? (
        <div className="flex items-center justify-center py-16 text-[var(--color-biz-muted)]">
          <Loader2 className="animate-spin mr-2" size={20} />
          Loading AI Brain metrics…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total AI Requests (7d)"
              value={formatNumber(Number(stats?.total ?? 0))}
              icon={Activity}
              trend={null}
            />
            <KpiCard
              label="Blocked Requests"
              value={formatNumber(Number(stats?.blocked ?? 0))}
              icon={Shield}
              trend={null}
            />
            <KpiCard
              label="Avg Latency"
              value={`${formatNumber(Number(stats?.avgLatencyMs ?? 0))} ms`}
              icon={Clock}
              trend={null}
            />
            <KpiCard
              label="Memory Records"
              value={formatNumber(Number(memStats?.total ?? 0))}
              icon={Database}
              trend={null}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                <Zap size={16} />
                Gateway Health
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Status</span>
                  <span className="font-medium text-emerald-400">{(health.data as Record<string, unknown>)?.status as string ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Gateway</span>
                  <span>{(health.data as Record<string, unknown>)?.gateway ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="flex justify-between">
                  <span>7d Cost (USD)</span>
                  <span>${Number(stats?.totalCostUsd ?? 0).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fallbacks</span>
                  <span>{formatNumber(Number(stats?.fallback ?? 0))}</span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                <Database size={16} />
                Memory Statistics
              </h2>
              <div className="space-y-1 text-sm">
                {Object.entries((memStats?.byType as Record<string, number>) ?? {}).map(([type, count]) => (
                  <div key={type} className="flex justify-between">
                    <span className="text-[var(--color-biz-muted)]">{type}</span>
                    <span>{formatNumber(count)}</span>
                  </div>
                ))}
                {(!memStats?.byType || Object.keys(memStats.byType as object).length === 0) && (
                  <p className="text-[var(--color-biz-muted)]">No memory records yet</p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              <FileText size={16} />
              Prompt Registry ({promptList.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-biz-line)] text-left text-[var(--color-biz-muted)]">
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Category</th>
                    <th className="pb-2">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {promptList.slice(0, 10).map((p) => (
                    <tr key={p.promptId as string} className="border-b border-[var(--color-biz-line)]/50">
                      <td className="py-2 pr-4 font-mono text-xs">{p.promptId as string}</td>
                      <td className="py-2 pr-4">{p.name as string}</td>
                      <td className="py-2 pr-4">{p.category as string}</td>
                      <td className="py-2">{(p.activeVersion as Record<string, unknown>)?.version as number ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              <MessageSquare size={16} />
              Activity Timeline
            </h2>
            <div className="space-y-2">
              {entries.slice(0, 15).map((e) => (
                <div
                  key={e.id as string}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-biz-line)]/50 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs text-[var(--color-biz-muted)]">{e.requestId as string}</span>
                    <span className="ml-2">{e.actorRole as string}</span>
                    {e.promptId ? <span className="ml-2 text-xs text-cyan-400">{e.promptId as string}</span> : null}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-biz-muted)]">
                    <span>{e.status as string}</span>
                    <span>{e.latencyMs as number}ms</span>
                    <span>{new Date(e.createdAt as string).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {entries.length === 0 && (
                <p className="text-sm text-[var(--color-biz-muted)]">No activity recorded yet</p>
              )}
            </div>
          </section>

          {analytics.length > 0 && (
            <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Prompt Analytics
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {analytics.map((a) => (
                  <div key={a.promptId as string} className="rounded-lg border border-[var(--color-biz-line)]/50 p-3 text-sm">
                    <div className="font-mono text-xs text-cyan-400">{a.promptId as string}</div>
                    <div className="mt-1 flex justify-between">
                      <span>Requests</span>
                      <span>{a.requestCount as number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Latency</span>
                      <span>{a.avgLatencyMs as number}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {ctxHistory.length > 0 && (
            <section className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Context Snapshots
              </h2>
              <div className="space-y-1 text-sm">
                {ctxHistory.map((c) => (
                  <div key={c.id as string} className="flex justify-between py-1">
                    <span className="font-mono text-xs">{c.contextHash as string}</span>
                    <span>{c.contextSize as number} chars</span>
                    <span className="text-[var(--color-biz-muted)]">{new Date(c.builtAt as string).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
