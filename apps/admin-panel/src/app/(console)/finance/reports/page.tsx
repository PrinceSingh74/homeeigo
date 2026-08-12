"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { useAdminStore } from "@/stores/admin-store";
import { inr } from "@/lib/format";
import { resolveApiBase } from "@/lib/api-base";

const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

export default function FinanceReportsPage() {
  const [exporting, setExporting] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "reports"],
    queryFn: () => adminApi.financeReports("monthly"),
  });

  const report = (data?.report ?? {}) as Record<string, unknown>;
  const health = (data?.health ?? {}) as Record<string, unknown>;
  const components = (health.components ?? {}) as Record<string, number>;

  const downloadReport = async (period: string, format: string, label: string) => {
    const key = `${period}-${format}`;
    setExporting(key);
    try {
      const base = resolveApiBase();
      const token = useAdminStore.getState().accessToken;
      const url = `${base.replace(/\/$/, "")}/api/admin/finance/reports/export?period=${period}&format=${format}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) return;
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download =
        format === "pdf"
          ? `HOMEEIGO-Executive-Report-${period}.pdf`
          : `homigo-finance-${period}-${label}.${format === "xlsx" ? "xlsx" : "csv"}`;
      a.click();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Executive Reports</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Board report and finance health score</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={exporting === `${p}-csv`}
              onClick={() => void downloadReport(p, "csv", p)}
              className="rounded-lg border px-3 py-1.5 text-sm capitalize hover:bg-[var(--color-biz-surface)] disabled:opacity-50"
            >
              {exporting === `${p}-csv` ? "…" : `${p} CSV`}
            </button>
          ))}
          <button
            type="button"
            disabled={exporting === "monthly-xlsx"}
            onClick={() => void downloadReport("monthly", "xlsx", "report")}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--color-biz-surface)] disabled:opacity-50"
          >
            {exporting === "monthly-xlsx" ? "…" : "Excel"}
          </button>
          <button
            type="button"
            disabled={exporting === "monthly-pdf"}
            onClick={() => void downloadReport("monthly", "pdf", "report")}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--color-biz-surface)] disabled:opacity-50"
          >
            {exporting === "monthly-pdf" ? "…" : "PDF"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Finance health" value={`${health.score ?? 0}/100`} icon={TrendingUp} loading={isLoading} />
        <KpiCard label="GMV" value={inr(Number(report.gmv ?? 0), true)} icon={FileText} loading={isLoading} />
        <KpiCard label="Net revenue" value={inr(Number(report.netRevenue ?? 0), true)} icon={FileText} loading={isLoading} />
        <KpiCard label="Platform margin" value={`${report.platformMarginPct ?? 0}%`} icon={FileText} loading={isLoading} />
      </div>

      <div className="rounded-xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-4">
        <h2 className="mb-3 font-semibold">Health components</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {Object.entries(components).map(([k, v]) => (
            <li key={k} className="flex justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2">
              <span className="capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
              <span>{v}/100</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
