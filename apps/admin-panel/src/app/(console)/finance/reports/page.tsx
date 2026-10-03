"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { apiRequestBlob } from "@/lib/api-client";
import { ScheduledReportStatus } from "@/components/hq/ScheduledReportStatus";
import { isRenderableNumber, MISSING, renderPercent, renderScore } from "@/lib/intelligence-render";
import { inr } from "@/lib/format";

const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

/**
 * Rupee formatting is kept — `inr()` is the platform's money formatter and switching the board page
 * to a bare number would be a downgrade. The guard is only on the missing case: a figure the platform
 * does not have renders as "Not reported", never as ₹0.
 */
function money(v: unknown): string {
  return isRenderableNumber(v) ? inr(v, true) : MISSING;
}

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
      // Shared client: bearer + coordinated refresh; throws a typed error instead of silently returning.
      const blob = await apiRequestBlob("/api/admin/finance/reports/export", { auth: true, query: { period, format } });
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
        <KpiCard label="Finance health" value={renderScore(health.score)} icon={TrendingUp} loading={isLoading} />
        <KpiCard label="GMV" value={money(report.gmv)} icon={FileText} loading={isLoading} />
        <KpiCard label="Net revenue" value={money(report.netRevenue)} icon={FileText} loading={isLoading} />
        <KpiCard label="Platform margin" value={renderPercent(report.platformMarginPct)} icon={FileText} loading={isLoading} />
      </div>

      {/*
        The figure above that cannot be read at face value, said plainly rather than left to a reader
        to discover. It comes straight from the ledger-backed source; it is not recomputed here and
        not smoothed. Hiding it on the page that produces the board PDF would be the one place it
        could quietly become a board figure.

        Net revenue is deliberately NOT listed. Its mixed-period defect was repaired at the source —
        `getOverview` now subtracts in-window refunds rather than the all-time total, verified live at
        30-day GMV 21,283 minus in-period refunds 2,732 = 18,551, where the old formula produced
        -10,070.70. Leaving a warning about a defect that no longer exists would be its own kind of
        lie, and would train readers to ignore the box.
      */}
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-xl border border-[var(--color-biz-danger)]/30 bg-[var(--color-biz-danger)]/5 p-3"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-biz-danger)]" aria-hidden />
        <div className="min-w-0 text-xs">
          <p className="font-semibold text-[var(--color-biz-danger)]">Known data-quality issue in these figures</p>
          <p className="mt-0.5 text-[var(--color-biz-muted)]">
            <strong>Platform margin</strong> is derived from figures on different period bases, and is
            undefined when GMV is zero — the source returns 0, which is indistinguishable from a
            genuine zero margin. It is carried unchanged from the authoritative source and is not
            recomputed on this page.
          </p>
        </div>
      </div>

      <ScheduledReportStatus />

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
