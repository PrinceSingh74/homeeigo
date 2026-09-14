"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Database,
  Loader2,
  Percent,
  RefreshCw,
  Repeat,
  TrendingUp,
  UserPlus,
  Wallet,
  XCircle,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { AnalyticsPerformanceBoundary } from "@/components/perf/AnalyticsPerformanceBoundary";
import { Icon3D } from "@/components/hq/Icon3D";
import { useAdminAnalyticsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { adminApi } from "@/services/admin-api";
import { daysAgoIso, formatNumber, formatPercent, inr, todayIso } from "@/lib/format";
import { AdminApiError, getApiLoadHint, getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

const AdminAnalyticsCharts = dynamic(
  () =>
    import("@/components/analytics/AdminAnalyticsCharts").then((m) => ({
      default: m.AdminAnalyticsCharts,
    })),
  { ssr: false },
);

const PRESETS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
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

  const { data, isLoading, isFetching, isError, error, refetch } = useAdminAnalyticsQuery(range);
  const analyticsHint = isError ? getApiLoadHint(error) : null;
  const pipeline = useQuery({
    queryKey: ["data-pipeline-health"],
    queryFn: async () => {
      const result = await adminApi.dataPipeline.health();
      if (!result?.pipeline) {
        throw new Error("Pipeline health payload missing");
      }
      return result;
    },
    staleTime: 60_000,
    retry: 1,
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

  const rangeActions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="biz-segment">
        {PRESETS.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={cn("biz-segment-btn", preset === p.id && "is-active")}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("custom")}
          className={cn("biz-segment-btn inline-flex items-center gap-1", preset === "custom" && "is-active")}
        >
          <CalendarDays className="h-3 w-3" />
          Custom
        </button>
      </div>
      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="biz-btn p-2"
        aria-label="Refresh"
      >
        {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <GrowthPage
      icon={BarChart3}
      title="Analytics"
      subtitle="Revenue, job completion, new customers, and service mix for the selected window. Numbers come from live bookings — not estimates."
      actions={rangeActions}
    >
      {preset === "custom" ? (
        <div className="biz-card flex flex-wrap items-end gap-4 p-4">
          <Field label="From" className="w-44">
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="biz-input"
            />
          </Field>
          <Field label="To" className="w-44">
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={todayIso()}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="biz-input"
            />
          </Field>
        </div>
      ) : null}

      <div className="biz-kpi-grid">
        <KpiCard
          label="Revenue"
          value={isLoading || isError ? "—" : inr(overview?.totalRevenue ?? 0, true)}
          sub="Completed job value"
          icon={TrendingUp}
          loading={isLoading || isError}
        />
        <KpiCard
          label="Completed jobs"
          value={isLoading || isError ? "—" : formatNumber(overview?.completedBookings ?? 0)}
          sub={overview ? `${formatPercent(completionRate)} completion` : undefined}
          icon={CheckCircle2}
          accent="green"
          loading={isLoading || isError}
        />
        <KpiCard
          label="Cancellations"
          value={isLoading || isError ? "—" : formatNumber(overview?.cancelledBookings ?? 0)}
          sub={overview ? `${formatPercent(cancellationRate)} of bookings` : undefined}
          icon={XCircle}
          accent="red"
          loading={isLoading || isError}
        />
        <KpiCard
          label="New customers"
          value={isLoading || isError ? "—" : formatNumber(data?.userMetrics.newUsers ?? 0)}
          sub={data ? `${formatNumber(data.userMetrics.activeUsers)} active` : undefined}
          icon={UserPlus}
          loading={isLoading || isError}
        />
      </div>

      {isError ? (
        <div className="biz-glass-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" role="alert">
          <div className="flex min-w-0 items-start gap-3">
            <Icon3D icon={AlertTriangle} size="sm" tone="danger" />
            <div>
              <p className="text-sm font-semibold">{getErrorMessage(error, "Failed to load analytics.")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-biz-muted)]">
                {analyticsHint ??
                  "This page loads GET /api/admin/analytics for the selected dates. Empty bookings would show zeros — this banner means the request itself failed."}
                {error instanceof AdminApiError && error.code === "FORBIDDEN"
                  ? " Analytics needs ANALYTICS:READ. Seeing Growth HQ (campaigns / gift cards) is a different grant."
                  : null}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void refetch()} className="biz-btn shrink-0 text-xs">
            Retry
          </button>
        </div>
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

      <div className="grid gap-3.5 sm:grid-cols-3">
        <KpiCard
          label="Platform commission"
          value={isLoading || isError ? "—" : inr(overview?.platformCommission ?? 0, true)}
          sub="Homeeigo take"
          icon={Percent}
          accent="green"
          loading={isLoading || isError}
        />
        <KpiCard
          label="Partner payouts"
          value={isLoading || isError ? "—" : inr(overview?.providerPayouts ?? 0, true)}
          sub="Earnings posted to partners"
          icon={Wallet}
          accent="amber"
          loading={isLoading || isError}
        />
        <KpiCard
          label="Repeat booking rate"
          value={isLoading || isError ? "—" : formatPercent(data?.userMetrics.repeatBookingRate ?? 0)}
          sub="Customers who booked again"
          icon={Repeat}
          accent="green"
          loading={isLoading || isError}
        />
      </div>

      <Panel
        title="ML data pipeline"
        hint="Freshness of training datasets feeding forecasting and allocation"
        icon={Database}
        iconTone="cyan"
      >
        {pipeline.isLoading ? (
          <p className="text-sm text-[var(--color-biz-muted)]">Loading pipeline health…</p>
        ) : pipeline.isError ? (
          <p className="text-sm text-[var(--color-biz-danger)]">Pipeline health unavailable</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                Fresh datasets
              </p>
              <p className="biz-num mt-1 text-lg font-semibold">
                {pipeline.data?.pipeline.freshness ?? 0} / {pipeline.data?.pipeline.totalDatasets ?? 0}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                Quality score
              </p>
              <p className="biz-num mt-1 text-lg font-semibold">
                {Number(pipeline.data?.pipeline.qualityScore ?? 0).toFixed(0)}%
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                MLOps
              </p>
              <p className="mt-1 text-lg font-semibold capitalize">
                {String(pipeline.data?.pipeline.mlops?.status ?? "—")}
              </p>
            </div>
          </div>
        )}
      </Panel>
    </GrowthPage>
  );
}
