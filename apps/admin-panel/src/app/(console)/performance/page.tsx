"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";
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
    <div className="mx-auto max-w-7xl space-y-6">
      <CommandCenterRail />
      <SectionHead
        icon={TrendingUp}
        tone="success"
        title="Performance"
        subtitle="Fleet score, career, and quality from the canonical workforce analytics service — not a second score engine."
      />
      {q.isError ? (
        <div className="biz-glass-panel p-4" role="alert">
          <p className="text-sm">Performance data unavailable.</p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Acceptance" value={d ? `${d.avgAcceptanceRate.toFixed(1)}%` : "—"} loading={q.isLoading} />
            <StatTile label="Completion" value={d ? `${d.avgCompletionRate.toFixed(1)}%` : "—"} loading={q.isLoading} />
            <StatTile label="On-time" value={d ? `${d.avgOnTimeRate.toFixed(1)}%` : "—"} loading={q.isLoading} />
            <StatTile label="Cancellation" value={d ? `${d.avgCancellationRate.toFixed(1)}%` : "—"} tone="danger" loading={q.isLoading} />
          </div>
          <DataTable
            title="Top partners"
            columns={["Partner", "City", "Status", "Rating", "Acceptance", "Completion", "Jobs"]}
            rows={rows}
            loading={q.isLoading}
            emptyMessage="No partner performance rows yet."
          />
        </>
      )}
    </div>
  );
}
