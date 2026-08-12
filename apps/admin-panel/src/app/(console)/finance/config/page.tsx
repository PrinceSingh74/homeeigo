"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

const CONFIG_FIELDS = [
  {
    key: "OPERATING_EXPENSE_MONTHLY",
    label: "Operating Expense (monthly)",
    hint: "Salaries, infra, marketing, G&A — enables EBITDA, burn rate, profit forecast",
    unit: "₹/mo",
  },
  {
    key: "CASH_ON_HAND",
    label: "Cash on Hand",
    hint: "Current bank balance — enables cash runway",
    unit: "₹",
  },
  {
    key: "PAYMENT_GATEWAY_FEE_PCT",
    label: "Payment Gateway Fee",
    hint: "COGS gateway rate (Razorpay domestic default 2%)",
    unit: "%",
  },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  db: "database",
  env: "legacy env",
  default: "system default",
  missing: "not set",
};

export default function FinanceConfigPage() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const config = useQuery({
    queryKey: ["admin", "finance", "config"],
    queryFn: () => adminApi.financeConfigGet(),
    staleTime: 30_000,
  });

  const history = useQuery({
    queryKey: ["admin", "finance", "config", "history"],
    queryFn: () => adminApi.financeConfigHistory(undefined, 30),
    staleTime: 30_000,
  });

  const intel = useQuery({
    queryKey: ["admin", "finance", "intelligence"],
    queryFn: () => adminApi.financeIntelligence(30),
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: (payload: { key: string; value: number; reason?: string }) =>
      adminApi.financeConfigUpdate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "finance", "config"] });
      void qc.invalidateQueries({ queryKey: ["admin", "finance", "config", "history"] });
      void qc.invalidateQueries({ queryKey: ["admin", "finance", "intelligence"] });
      void qc.invalidateQueries({ queryKey: ["hq"] });
    },
  });

  const resolved = config.data?.resolved;
  const entryMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of config.data?.entries ?? []) m.set(e.key, e.value);
    return m;
  }, [config.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-biz-muted)]">Finance HQ</p>
          <h1 className="text-2xl font-bold">CFO Finance Config</h1>
          <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
            Authoritative inputs for EBITDA, burn rate, cash runway and profit forecast. Changes are audited.
          </p>
        </div>
        <Link href="/hq/finance" className="text-sm text-[var(--color-biz-accent)] hover:underline">
          ← Finance HQ
        </Link>
      </div>

      {intel.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="biz-glass-panel p-4">
            <p className="text-xs text-[var(--color-biz-muted)]">Gross margin</p>
            <p className="text-lg font-semibold">
              {intel.data.grossMargin.grossMarginPct != null
                ? `${intel.data.grossMargin.grossMarginPct.toFixed(1)}%`
                : "—"}
            </p>
          </div>
          <div className="biz-glass-panel p-4">
            <p className="text-xs text-[var(--color-biz-muted)]">EBITDA (30d)</p>
            <p className="text-lg font-semibold">
              {intel.data.ebitda.ebitda != null ? inr(intel.data.ebitda.ebitda, true) : "—"}
            </p>
          </div>
          <div className="biz-glass-panel p-4">
            <p className="text-xs text-[var(--color-biz-muted)]">Monthly burn</p>
            <p className="text-lg font-semibold">
              {intel.data.burnRate.monthlyBurn != null ? inr(intel.data.burnRate.monthlyBurn, true) : "—"}
            </p>
          </div>
          <div className="biz-glass-panel p-4">
            <p className="text-xs text-[var(--color-biz-muted)]">Cash runway</p>
            <p className="text-lg font-semibold">
              {intel.data.cashRunway.status === "profitable"
                ? "∞"
                : intel.data.cashRunway.runwayMonths != null
                  ? `${intel.data.cashRunway.runwayMonths.toFixed(1)} mo`
                  : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {CONFIG_FIELDS.map((field) => {
          const sourceKey =
            field.key === "OPERATING_EXPENSE_MONTHLY"
              ? "operatingExpenseMonthly"
              : field.key === "CASH_ON_HAND"
                ? "cashOnHand"
                : "gatewayFeePct";
          const source = resolved?.sources[sourceKey as keyof typeof resolved.sources];
          const current =
            field.key === "OPERATING_EXPENSE_MONTHLY"
              ? resolved?.operatingExpenseMonthly
              : field.key === "CASH_ON_HAND"
                ? resolved?.cashOnHand
                : resolved?.gatewayFeePct;
          const draft = drafts[field.key] ?? (current != null ? String(current) : "");

          return (
            <div key={field.key} className="biz-glass-panel space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{field.label}</h2>
                  <p className="text-xs text-[var(--color-biz-muted)]">{field.hint}</p>
                </div>
                <span className="rounded-full border border-[var(--color-biz-line)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-biz-muted)]">
                  source: {SOURCE_LABEL[source ?? "missing"]}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Value ({field.unit})
                  <input
                    type="number"
                    min={0}
                    step={field.unit === "%" ? "0.01" : "1"}
                    value={draft}
                    onChange={(e) => setDrafts({ ...drafts, [field.key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  Reason (audit trail)
                  <input
                    type="text"
                    value={reasons[field.key] ?? ""}
                    onChange={(e) => setReasons({ ...reasons, [field.key]: e.target.value })}
                    placeholder="e.g. Q3 board-approved opex"
                    className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-biz-muted)]">
                  DB value: {entryMap.has(field.key) ? inr(entryMap.get(field.key)!, field.unit !== "%") : "not stored"}
                </p>
                <button
                  type="button"
                  disabled={saveMut.isPending || draft === ""}
                  onClick={() => {
                    const value = Number(draft);
                    if (!Number.isFinite(value) || value < 0) return;
                    void saveMut.mutateAsync({
                      key: field.key,
                      value,
                      reason: reasons[field.key] || undefined,
                    });
                  }}
                  className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <section className="biz-glass-panel p-5">
        <h2 className="mb-3 font-semibold">Change history</h2>
        {history.isLoading ? (
          <div className="biz-skeleton h-24 w-full rounded" />
        ) : (history.data?.history.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No config changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Key</th>
                  <th className="py-2 pr-4">Before → After</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {history.data!.history.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-biz-line)]/50">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{row.configKey}</td>
                    <td className="py-2 pr-4">
                      {row.valueBefore ?? "—"} → {row.valueAfter}
                    </td>
                    <td className="py-2 pr-4 text-[var(--color-biz-muted)]">{row.reason ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{row.changedBy.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
