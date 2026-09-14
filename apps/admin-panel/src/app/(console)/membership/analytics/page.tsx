"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Filter,
  IndianRupee,
  LineChart,
  Percent,
  ShieldCheck,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnalyticsPerformanceBoundary } from "@/components/perf/AnalyticsPerformanceBoundary";
import { adminApi } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { MeterBar } from "@/components/hq/primitives";

const MembershipTrendCharts = dynamic(
  () =>
    import("@/components/analytics/MembershipTrendCharts").then((m) => ({
      default: m.MembershipTrendCharts,
    })),
  { ssr: false },
);

const PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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
  const maxPlan = Math.max(1, ...planDist.map((p) => num(p.count)));

  return (
    <GrowthPage
      icon={LineChart}
      title="Membership Analytics"
      subtitle="Recurring revenue, churn, plan mix, and how many customers convert into a paid plan."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof PERIODS)[number])}
            className="biz-select w-36"
            aria-label="Period"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <a href={exportUrl} className="biz-btn">
            <Download size={14} />
            Export CSV
          </a>
        </div>
      }
    >
      <div className="biz-kpi-grid">
        <KpiCard
          label="MRR"
          value={inr(num(d?.mrr))}
          sub="Monthly recurring revenue"
          icon={IndianRupee}
          loading={isLoading}
        />
        <KpiCard
          label="ARR"
          value={inr(num(d?.arr))}
          sub="Annualised run-rate"
          icon={TrendingUp}
          loading={isLoading}
        />
        <KpiCard
          label="Churn"
          value={`${num(d?.churnRatePct).toFixed(1)}%`}
          sub="Subscribers lost"
          icon={UserMinus}
          accent="red"
          loading={isLoading}
        />
        <KpiCard
          label="Retention"
          value={`${num(d?.retentionRatePct).toFixed(1)}%`}
          sub="Subscribers kept"
          icon={ShieldCheck}
          accent="green"
          loading={isLoading}
        />
      </div>
      <div className="biz-kpi-grid">
        <KpiCard
          label="Avg LTV"
          value={inr(num(d?.avgLtv))}
          sub="Lifetime value per member"
          icon={IndianRupee}
          loading={isLoading}
        />
        <KpiCard
          label="Active subscribers"
          value={formatNumber(num(d?.activeSubscribers))}
          sub="Paying now"
          icon={Users}
          loading={isLoading}
        />
        <KpiCard
          label="New this month"
          value={formatNumber(num(d?.newThisMonth))}
          sub="Started a plan"
          icon={UserPlus}
          loading={isLoading}
        />
        <KpiCard
          label="Revenue growth"
          value={`${num((d?.trends as { revenueGrowthPct?: number })?.revenueGrowthPct).toFixed(1)}%`}
          sub="Vs previous period"
          icon={Percent}
          loading={isLoading}
        />
      </div>

      <AnalyticsPerformanceBoundary label="MembershipTrendCharts">
        <MembershipTrendCharts trends={trends} />
      </AnalyticsPerformanceBoundary>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plan mix" hint="Share of active subscribers by plan" icon={Filter} iconTone="cyan">
          {planDist.length > 0 ? (
            <div className="space-y-3">
              {planDist.map((p) => (
                <MeterBar
                  key={String(p.planId)}
                  label={`${String(p.planName)} · ${formatNumber(num(p.count))}`}
                  value={num(p.sharePct ?? (num(p.count) / maxPlan) * 100)}
                  suffix="%"
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No plan mix yet"
              description="Plan distribution appears once subscribers are on paid plans."
            />
          )}
        </Panel>
        <Panel
          title="Upgrade funnel"
          hint="How many customers ever convert to a membership"
          icon={TrendingUp}
          iconTone="success"
        >
          <dl className="space-y-3">
            {(
              [
                ["Total customers", num(funnel?.totalCustomers)],
                ["Ever subscribed", num(funnel?.everSubscribed)],
                ["Active subscribers", num(funnel?.activeSubscribers)],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--color-biz-line)] pb-2 last:border-0"
              >
                <dt className="text-sm text-[var(--color-biz-muted)]">{label}</dt>
                <dd className="biz-num text-sm font-semibold">{formatNumber(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm">
            Conversion{" "}
            <span className="biz-num font-semibold">{num(funnel?.conversionToSubscribePct).toFixed(1)}%</span>
            <span className="text-[var(--color-biz-muted)]"> of customers ever subscribed</span>
          </p>
        </Panel>
      </div>
    </GrowthPage>
  );
}
