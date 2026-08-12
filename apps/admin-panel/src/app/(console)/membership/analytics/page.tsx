"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { AnalyticsPerformanceBoundary } from "@/components/perf/AnalyticsPerformanceBoundary";
import { adminApi } from "@/services/admin-api";

const MembershipTrendCharts = dynamic(
  () =>
    import("@/components/analytics/MembershipTrendCharts").then((m) => ({
      default: m.MembershipTrendCharts,
    })),
  { ssr: false },
);

const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

export default function MembershipAnalyticsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("monthly");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "membership", "analytics", period],
    queryFn: () => adminApi.subscriptions.analytics(period),
  });
  const d = data as Record<string, unknown> | undefined;
  const trends = (d?.trends as { points?: Array<Record<string, unknown>> })?.points ?? [];
  const planDist = (d?.planDistribution as Array<Record<string, unknown>>) ?? [];
  const funnel = d?.upgradeFunnel as Record<string, unknown> | undefined;
  const exportUrl = `/api/admin/membership/analytics/export?period=${period}&format=csv`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Membership Analytics</h1>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-1.5 text-sm"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <a
            href={exportUrl}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-biz-bg)]"
          >
            <Download size={14} />
            Export CSV
          </a>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="MRR" value={`₹${d?.mrr ?? 0}`} icon={BarChart3} loading={isLoading} />
        <KpiCard label="ARR" value={`₹${d?.arr ?? 0}`} icon={BarChart3} loading={isLoading} />
        <KpiCard label="Churn %" value={`${d?.churnRatePct ?? 0}%`} icon={BarChart3} loading={isLoading} />
        <KpiCard label="Retention %" value={`${d?.retentionRatePct ?? 0}%`} icon={BarChart3} loading={isLoading} />
        <KpiCard label="Avg LTV" value={`₹${d?.avgLtv ?? 0}`} icon={BarChart3} loading={isLoading} />
        <KpiCard label="Active subs" value={String(d?.activeSubscribers ?? 0)} icon={BarChart3} loading={isLoading} />
        <KpiCard label="New this month" value={String(d?.newThisMonth ?? 0)} icon={BarChart3} loading={isLoading} />
        <KpiCard
          label="Revenue growth"
          value={`${(d?.trends as { revenueGrowthPct?: number })?.revenueGrowthPct ?? 0}%`}
          icon={BarChart3}
          loading={isLoading}
        />
      </div>

      <AnalyticsPerformanceBoundary label="MembershipTrendCharts">
        <MembershipTrendCharts trends={trends} />
      </AnalyticsPerformanceBoundary>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="biz-card p-4">
          <h2 className="mb-3 font-semibold">Plan Distribution</h2>
          <ul className="space-y-2 text-sm">
            {planDist.map((p) => (
              <li key={String(p.planId)} className="flex justify-between">
                <span>{String(p.planName)}</span>
                <span className="text-[var(--color-biz-muted)]">
                  {String(p.count)} ({String(p.sharePct)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="biz-card p-4">
          <h2 className="mb-3 font-semibold">Upgrade Funnel</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span>Total customers</span>
              <span>{String(funnel?.totalCustomers ?? 0)}</span>
            </li>
            <li className="flex justify-between">
              <span>Ever subscribed</span>
              <span>{String(funnel?.everSubscribed ?? 0)}</span>
            </li>
            <li className="flex justify-between">
              <span>Active subscribers</span>
              <span>{String(funnel?.activeSubscribers ?? 0)}</span>
            </li>
            <li className="flex justify-between">
              <span>Conversion %</span>
              <span>{String(funnel?.conversionToSubscribePct ?? 0)}%</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
