"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, TrendingUp, XCircle } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { OperationsPage } from "@/components/operations/OperationsPage";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";

export default function PerformancePage() {
  const q = useQuery({
    queryKey: ["admin", "workforce"],
    queryFn: () => adminApi.workforceAnalytics(),
    staleTime: 30_000,
  });
  const d = q.data;
  const rows = (d?.topPartners ?? []).map((p) => [
    <Link key={p.id} href={`/vendors/${p.id}`} className="font-semibold text-[var(--color-biz-accent)]">
      {p.name}
    </Link>,
    p.city ?? "—",
    p.online ? "online" : "offline",
    p.rating.toFixed(2),
    `${p.acceptanceRate.toFixed(1)}%`,
    `${p.completionRate.toFixed(1)}%`,
    formatNumber(p.completedBookings),
  ]);

  return (
    <OperationsPage
      icon={TrendingUp}
      iconTone="success"
      title="Performance"
      subtitle="Fleet acceptance, completion, on-time, and quality from the canonical workforce analytics service — not a second score engine."
    >
      {q.isError ? (
        <div className="biz-glass-panel p-5" role="alert">
          <p className="text-sm font-semibold">Performance data unavailable.</p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            This list is partner job quality — it does not change availability or post finance.
          </p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="biz-kpi-grid">
            <KpiCard
              label="Acceptance"
              value={d ? `${d.avgAcceptanceRate.toFixed(1)}%` : "—"}
              sub="Offers taken vs offered"
              icon={CheckCircle2}
              loading={q.isLoading}
              accent="green"
            />
            <KpiCard
              label="Completion"
              value={d ? `${d.avgCompletionRate.toFixed(1)}%` : "—"}
              sub="Jobs finished after accept"
              icon={TrendingUp}
              loading={q.isLoading}
            />
            <KpiCard
              label="On-time"
              value={d ? `${d.avgOnTimeRate.toFixed(1)}%` : "—"}
              sub="Arrived within SLA"
              icon={Clock}
              loading={q.isLoading}
            />
            <KpiCard
              label="Cancellation"
              value={d ? `${d.avgCancellationRate.toFixed(1)}%` : "—"}
              sub="Cancelled after accept"
              icon={XCircle}
              loading={q.isLoading}
              accent="red"
            />
          </div>
          <DataTable
            title="Top partners"
            hint="Online here is availability, not lifecycle. Jobs completed is the job axis."
            icon={TrendingUp}
            iconTone="success"
            columns={["Partner", "City", "Status", "Rating", "Acceptance", "Completion", "Jobs"]}
            rows={rows}
            loading={q.isLoading}
            emptyMessage="No partner performance rows yet"
            emptyDescription="Rows appear once partners complete jobs and the workforce analytics service has scores."
          />
        </>
      )}
    </OperationsPage>
  );
}
