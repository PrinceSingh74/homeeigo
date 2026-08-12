"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

const TYPES = ["WALLET_TOPUP", "WALLET_DEBIT", "REFERRAL_COMMISSION", "GIFT_CARD", "CASHBACK", "HCOIN"] as const;

export default function FinanceBackfillPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["admin", "backfill", "history"],
    queryFn: () => adminApi.backfill.history(),
  });
  const { data: issues } = useQuery({
    queryKey: ["admin", "backfill", "issues"],
    queryFn: () => adminApi.backfill.issues(),
  });

  const runMut = useMutation({
    mutationFn: () => adminApi.backfill.run(selected.length ? selected : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "backfill"] });
    },
  });

  const latest = runs?.[0];
  const toggle = (t: string) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Historical Ledger Backfill</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Detect & generate missing journals for legacy transactions — idempotent, never duplicates
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Last scanned" value={String(latest?.recordsScanned ?? 0)} icon={Database} loading={isLoading} />
        <KpiCard label="Last backfilled" value={String(latest?.recordsBackfilled ?? 0)} icon={Database} accent="green" loading={isLoading} />
        <KpiCard label="Last skipped" value={String(latest?.recordsSkipped ?? 0)} icon={Database} loading={isLoading} />
        <KpiCard label="Last failed" value={String(latest?.recordsFailed ?? 0)} icon={Database} accent="red" loading={isLoading} />
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Run backfill</h2>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                selected.includes(t)
                  ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                  : "border-[var(--color-biz-line)] text-[var(--color-biz-muted)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-biz-muted)]">
          {selected.length ? `Selected: ${selected.join(", ")}` : "No filter — all types will be scanned"}
        </p>
        <button
          type="button"
          disabled={runMut.isPending}
          onClick={() => runMut.mutate()}
          className="mt-3 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {runMut.isPending ? "Running…" : "Run backfill"}
        </button>
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Run history</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--color-biz-muted)]">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Types</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Scanned</th>
                <th className="py-2 pr-4">Backfilled</th>
                <th className="py-2 pr-4">Skipped</th>
                <th className="py-2 pr-4">Failed</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-biz-line)]">
                  <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 max-w-[180px] truncate" title={r.types}>{r.types}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                  <td className="py-2 pr-4">{r.recordsScanned}</td>
                  <td className="py-2 pr-4">{r.recordsBackfilled}</td>
                  <td className="py-2 pr-4">{r.recordsSkipped}</td>
                  <td className="py-2 pr-4">{r.recordsFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Recent issues</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--color-biz-muted)]">
              <tr>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Record</th>
                <th className="py-2 pr-4">Outcome</th>
                <th className="py-2 pr-4">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(issues ?? []).slice(0, 50).map((i, idx) => (
                <tr key={idx} className="border-t border-[var(--color-biz-line)]">
                  <td className="py-2 pr-4">{String(i.backfillType)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{String(i.recordId)}</td>
                  <td className="py-2 pr-4">{String(i.outcome)}</td>
                  <td className="py-2 pr-4">{String(i.detail ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
