"use client";

import { useQuery } from "@tanstack/react-query";
import { Layers, Loader2, RefreshCw } from "lucide-react";
import { adminApi } from "@/services/admin-api";

export default function ContextExplorerPage() {
  const history = useQuery({
    queryKey: ["ai-context-history"],
    queryFn: () => adminApi.aiBrain.contextHistory(30),
    staleTime: 30_000,
  });

  const rows = (history.data as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 biz-page-enter">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers size={24} className="text-cyan-400" />
            Context Explorer
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Built context snapshots and history</p>
        </div>
        <button type="button" onClick={() => void history.refetch()} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm">
          <RefreshCw size={14} className={history.isFetching ? "animate-spin inline" : "inline"} /> Refresh
        </button>
      </header>

      {history.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="rounded-xl border border-[var(--color-biz-line)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-[var(--color-biz-muted)]">
              <tr>
                <th className="px-4 py-2 text-left">Hash</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Size</th>
                <th className="px-4 py-2 text-left">Built</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id as string} className="border-t border-[var(--color-biz-line)]/50">
                  <td className="px-4 py-2 font-mono text-xs">{r.contextHash as string}</td>
                  <td className="px-4 py-2">{r.actorRole as string}</td>
                  <td className="px-4 py-2">{r.contextSize as number}</td>
                  <td className="px-4 py-2 text-[var(--color-biz-muted)]">{new Date(r.builtAt as string).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-4 text-sm text-[var(--color-biz-muted)]">No context snapshots yet</p>}
        </div>
      )}
    </div>
  );
}
