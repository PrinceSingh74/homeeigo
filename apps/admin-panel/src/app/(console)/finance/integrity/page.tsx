"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ShieldCheck } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function FinanceIntegrityPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "integrity"],
    queryFn: () => adminApi.financeIntegrity(),
  });

  const runMut = useMutation({
    mutationFn: () => adminApi.runFinanceIntegrity(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "integrity"] }),
  });

  const dashboard = (data?.dashboard ?? {}) as Record<string, unknown>;
  const categories = (dashboard.categories ?? {}) as Record<string, number>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Finance Integrity Center</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Ledger, settlement, refund, payout, and chargeback integrity</p>
        </div>
        <button
          type="button"
          disabled={runMut.isPending}
          onClick={() => runMut.mutate()}
          className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {runMut.isPending ? "Running…" : "Run integrity check"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Integrity score" value={`${dashboard.integrityScore ?? 0}/100`} icon={ShieldCheck} loading={isLoading} />
        <KpiCard label="Finance health" value={`${dashboard.financeHealthScore ?? 0}/100`} icon={Activity} loading={isLoading} />
        <KpiCard label="Open issues" value={String(dashboard.issuesCount ?? 0)} icon={ShieldCheck} accent="red" loading={isLoading} />
        <KpiCard label="Status" value={String(dashboard.status ?? "—")} icon={ShieldCheck} loading={isLoading} />
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Issue categories</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
          {Object.entries(categories).map(([k, v]) => (
            <li key={k} className="flex justify-between rounded-lg bg-[var(--color-biz-elevated)] px-3 py-2 capitalize">
              <span>{k}</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
