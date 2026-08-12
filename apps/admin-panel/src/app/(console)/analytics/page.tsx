"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { AnalyticsPerformanceBoundary } from "@/components/perf/AnalyticsPerformanceBoundary";
import { useAdminAnalyticsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { adminApi } from "@/services/admin-api";
import { daysAgoIso, formatNumber, formatPercent, inr, todayIso } from "@/lib/format";

const AdminAnalyticsCharts = dynamic(
  () =>
    import("@/components/analytics/AdminAnalyticsCharts").then((m) => ({
      default: m.AdminAnalyticsCharts,
    })),
  { ssr: false },
);

const PRESETS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
] as const;

type PresetId = (typeof PRESETS)[number]["id"] | "custom";

export default function AnalyticsPage() {
  const dashboard = useAdminDashboardQuery();
  const [preset, setPreset] = useState<PresetId>("30d");
  const [customStart, setCustomStart] = useState<string>(daysAgoIso(29));
  const [customEnd, setCustomEnd] = useState<string>(todayIso());

  const range = useMemo(() => {
    if (preset === "custom") return { startDate: customStart, endDate: customEnd };
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
    return { startDate: daysAgoIso(days - 1), endDate: todayIso() };
  }, [preset, customStart, customEnd]);

  const { data, isLoading, isFetching, isError, refetch } = useAdminAnalyticsQuery(range);
  const pipeline = useQuery({
    queryKey: ["data-pipeline-health"],
    queryFn: () => adminApi.dataPipeline.health(),
    staleTime: 60_000,
  });
  const overview = data?.overview;
  const dailyBookings = dashboard.data?.charts.bookingsByDay ?? [];
  const dailyRevenue = dashboard.data?.charts.revenueByDay ?? [];
  const topServices = data?.topServices ?? [];
  const maxServiceRevenue = Math.max(1, ...topServices.map((s) => s.revenue));

  const completionRate =
    overview && overview.totalBookings > 0 ? overview.completedBookings / overview.totalBookings : 0;
  const cancellationRate =
    overview && overview.totalBookings > 0 ? overview.cancelledBookings / overview.totalBookings : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">
          Analytics
          <span className="mt-1 block text-sm font-normal text-[var(--color-biz-muted)]">
            Revenue, conversion, top services
          </span>
        </h1>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                preset === p.id
                  ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                  : "border border-[var(--color-biz-line)] hover:bg-[var(--color-biz-elevated)]"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              preset === "custom"
                ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                : "border border-[var(--color-biz-line)] hover:bg-[var(--color-biz-elevated)]"
            }`}
          >
            <CalendarDays className="h-3 w-3" />
            Custom
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-md border border-[var(--color-biz-line)] p-1.5 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
            aria-label="Refresh"
          >
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {preset === "custom" ? (
        <div className="biz-card flex flex-wrap items-end gap-3 p-4">
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">
            From
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 block rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 px-3 text-sm"
            />
          </label>
          <label className="text-[10px] font-semibold uppercase text-[var(--color-biz-muted)]">
            To
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={todayIso()}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 px-3 text-sm"
            />
          </label>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenue" value={isLoading ? "—" : inr(overview?.totalRevenue ?? 0, true)} icon={TrendingUp} />
        <KpiCard
          label="Completed"
          value={isLoading ? "—" : formatNumber(overview?.completedBookings ?? 0)}
          sub={overview ? formatPercent(completionRate) + " completion" : undefined}
          icon={CheckCircle2}
          accent="green"
        />
        <KpiCard
          label="Cancellations"
          value={isLoading ? "—" : formatNumber(overview?.cancelledBookings ?? 0)}
          sub={overview ? formatPercent(cancellationRate) + " rate" : undefined}
          icon={XCircle}
          accent="red"
        />
        <KpiCard
          label="New users"
          value={isLoading ? "—" : formatNumber(data?.userMetrics.newUsers ?? 0)}
          sub={data ? `${formatNumber(data.userMetrics.activeUsers)} active` : undefined}
          icon={UserPlus}
        />
      </div>

      {isError ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Failed to load analytics.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </p>
      ) : null}

      <AnalyticsPerformanceBoundary label="AdminAnalyticsCharts">
        <AdminAnalyticsCharts
          dailyBookings={dailyBookings}
          dailyRevenue={dailyRevenue}
          topServices={topServices}
          maxServiceRevenue={maxServiceRevenue}
          isLoading={isLoading}
          rangeLabel={`${range.startDate} → ${range.endDate}`}
        />
      </AnalyticsPerformanceBoundary>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Platform commission"
          value={isLoading ? "—" : inr(overview?.platformCommission ?? 0, true)}
          icon={TrendingUp}
          accent="green"
        />
        <KpiCard
          label="Provider payouts"
          value={isLoading ? "—" : inr(overview?.providerPayouts ?? 0, true)}
          icon={Users}
          accent="amber"
        />
        <KpiCard
          label="Repeat booking rate"
          value={isLoading ? "—" : formatPercent(data?.userMetrics.repeatBookingRate ?? 0)}
          icon={Users}
          accent="green"
        />
      </div>

      <section className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--color-biz-accent)]" />
          <h2 className="text-sm font-semibold">ML Data Pipeline</h2>
        </div>
        {pipeline.isLoading ? (
          <p className="text-xs text-[var(--color-biz-muted)]">Loading pipeline health…</p>
        ) : pipeline.isError ? (
          <p className="text-xs text-red-500">Pipeline health unavailable</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div>
              <span className="text-[var(--color-biz-muted)]">Fresh datasets</span>
              <p className="font-medium">
                {pipeline.data?.pipeline.freshness ?? 0} / {pipeline.data?.pipeline.totalDatasets ?? 0}
              </p>
            </div>
            <div>
              <span className="text-[var(--color-biz-muted)]">Quality score</span>
              <p className="font-medium">{formatPercent(pipeline.data?.pipeline.qualityScore ?? 0)}</p>
            </div>
            <div>
              <span className="text-[var(--color-biz-muted)]">MLOps</span>
              <p className="font-medium">{String(pipeline.data?.pipeline.mlops?.status ?? "—")}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
