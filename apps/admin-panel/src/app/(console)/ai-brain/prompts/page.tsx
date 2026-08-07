"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { adminApi } from "@/services/admin-api";

export default function PromptRegistryPage() {
  const prompts = useQuery({ queryKey: ["ai-prompts"], queryFn: () => adminApi.aiBrain.prompts() });

  const list = (prompts.data as { prompts?: Array<Record<string, unknown>>; categories?: string[] })?.prompts ?? [];
  const categories = (prompts.data as { categories?: string[] })?.categories ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4 biz-page-enter">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText size={24} className="text-cyan-400" />
            Prompt Registry
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Centralized prompt library — {categories.length} categories
          </p>
        </div>
        <button type="button" onClick={() => void prompts.refetch()} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {prompts.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((p) => (
            <div key={p.promptId as string} className="rounded-xl border border-[var(--color-biz-line)] p-4">
              <div className="font-mono text-xs text-cyan-400">{p.promptId as string}</div>
              <h3 className="mt-1 font-semibold">{p.name as string}</h3>
              <div className="mt-2 flex gap-2 text-xs">
                <span className="rounded bg-white/10 px-2 py-0.5">{p.category as string}</span>
                <span className="text-[var(--color-biz-muted)]">owner: {p.owner as string}</span>
              </div>
              {p.description ? <p className="mt-2 text-sm text-[var(--color-biz-muted)]">{p.description as string}</p> : null}
              {(p.activeVersion as Record<string, unknown>) ? (
                <div className="mt-2 text-xs text-[var(--color-biz-muted)]">
                  v{(p.activeVersion as Record<string, unknown>).version as number} · max {(p.activeVersion as Record<string, unknown>).maxTokens as number} tokens
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
