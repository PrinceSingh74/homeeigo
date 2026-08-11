"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";

export default function MemoryExplorerPage() {
  const stats = useQuery({ queryKey: ["ai-memory-stats"], queryFn: () => adminApi.aiBrain.memoryStats() });
  const memories = useQuery({ queryKey: ["ai-memories"], queryFn: () => adminApi.aiBrain.memories({ limit: 30 }) });

  const memStats = stats.data as Record<string, unknown> | undefined;
  const rows = (memories.data as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 biz-page-enter">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database size={24} className="text-cyan-400" />
            Memory Explorer
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Enterprise memory store — session, semantic, conversation</p>
        </div>
        <button type="button" onClick={() => { void stats.refetch(); void memories.refetch(); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Active Memories" value={formatNumber(Number(memStats?.total ?? 0))} icon={Database} />
        <KpiCard label="Archived" value={formatNumber(Number(memStats?.archived ?? 0))} icon={Database} />
        <KpiCard label="Types" value={formatNumber(Object.keys((memStats?.byType as object) ?? {}).length)} icon={Database} />
      </div>

      {memories.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id as string} className="rounded-lg border border-[var(--color-biz-line)] px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="font-mono text-xs text-cyan-400">{m.memoryKey as string}</span>
                <span className="text-[var(--color-biz-muted)]">{m.memoryType as string}</span>
              </div>
              <p className="mt-1 text-[var(--color-biz-muted)]">{(m.summary as string) ?? JSON.stringify(m.content).slice(0, 120)}</p>
              <div className="mt-1 flex gap-4 text-xs text-[var(--color-biz-muted)]">
                <span>importance: {m.importance as number}</span>
                <span>v{m.version as number}</span>
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-[var(--color-biz-muted)]">No memories stored yet</p>}
        </div>
      )}
    </div>
  );
}
