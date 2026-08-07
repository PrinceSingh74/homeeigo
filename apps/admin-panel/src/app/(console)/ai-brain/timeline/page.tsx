"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";

export default function ActivityTimelinePage() {
  const timeline = useQuery({
    queryKey: ["ai-timeline-full"],
    queryFn: () => adminApi.aiBrain.timeline(30),
    staleTime: 30_000,
  });

  const stats = (timeline.data as { stats?: Record<string, unknown> })?.stats;
  const entries = (timeline.data as { entries?: Array<Record<string, unknown>> })?.entries ?? [];
  const analytics = (timeline.data as { analytics?: Array<Record<string, unknown>> })?.analytics ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 biz-page-enter">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity size={24} className="text-cyan-400" />
            AI Activity Timeline
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Complete audit trail of AI Brain requests</p>
        </div>
        <button type="button" onClick={() => void timeline.refetch()} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm">
          <RefreshCw size={14} className={timeline.isFetching ? "animate-spin inline" : "inline"} /> Refresh
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Total (30d)" value={formatNumber(Number(stats?.total ?? 0))} icon={Activity} trend={null} />
        <KpiCard label="Blocked" value={formatNumber(Number(stats?.blocked ?? 0))} icon={Activity} trend={null} />
        <KpiCard label="Fallbacks" value={formatNumber(Number(stats?.fallback ?? 0))} icon={Activity} trend={null} />
        <KpiCard label="Cost USD" value={`$${Number(stats?.totalCostUsd ?? 0).toFixed(4)}`} icon={Activity} trend={null} />
      </div>

      {timeline.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--color-biz-line)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-[var(--color-biz-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Request</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Prompt</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tokens</th>
                  <th className="px-3 py-2 text-left">Latency</th>
                  <th className="px-3 py-2 text-left">Time</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id as string} className="border-t border-[var(--color-biz-line)]/50">
                    <td className="px-3 py-2 font-mono text-xs">{String(e.requestId).slice(0, 8)}…</td>
                    <td className="px-3 py-2">{e.actorRole as string}</td>
                    <td className="px-3 py-2 text-xs">{e.promptId as string ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={e.blocked ? "text-red-400" : e.status === "SUCCESS" ? "text-emerald-400" : ""}>
                        {e.status as string}
                      </span>
                    </td>
                    <td className="px-3 py-2">{(e.promptTokens as number) + (e.completionTokens as number)}</td>
                    <td className="px-3 py-2">{e.latencyMs as number}ms</td>
                    <td className="px-3 py-2 text-xs text-[var(--color-biz-muted)]">{new Date(e.createdAt as string).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {analytics.length > 0 && (
            <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase text-[var(--color-biz-muted)]">Prompt Analytics (30d)</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {analytics.map((a) => (
                  <div key={a.promptId as string} className="rounded-lg border border-[var(--color-biz-line)]/50 p-3 text-sm">
                    <div className="font-mono text-xs text-cyan-400">{a.promptId as string}</div>
                    <div className="mt-1">{a.requestCount as number} requests · {a.avgLatencyMs as number}ms avg</div>
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
