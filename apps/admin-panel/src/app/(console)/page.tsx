"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { useAdminBookingsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { inr } from "@/lib/format";
import { DashboardDOMBoundary } from "@/components/perf/DashboardDOMBoundary";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { ExecutiveKpiGrid, type ExecutiveViewMode } from "@/components/hq/ExecutiveKpiGrid";
import { AiBriefingPanel } from "@/components/hq/AiBriefingPanel";
import { ViewModeSwitcher } from "@/components/hq/ViewModeSwitcher";
import { HqQuickLinkGrid } from "@/components/hq/HqQuickLinkGrid";
import { HQ_SECTIONS } from "@/lib/hq-navigation";
import { adminApi } from "@/services/admin-api";
import { Gauge, TrendingUp, ShieldAlert, Activity } from "lucide-react";

const PlatformLaunchpad = dynamic(
  () => import("@/components/dashboard/PlatformLaunchpad").then((m) => m.PlatformLaunchpad),
  { ssr: false },
);

const AdminDashboardCharts = dynamic(
  () =>
    import("@/components/dashboard/AdminDashboardCharts").then((m) => ({
      default: m.AdminDashboardCharts,
    })),
  { ssr: false },
);

const ExecutiveGeoPanel = dynamic(
  () => import("@/components/hq/ExecutiveGeoPanel").then((m) => m.ExecutiveGeoPanel),
  { ssr: false },
);

const ExecutiveIntelligencePanel = dynamic(
  () => import("@/components/hq/ExecutiveIntelligencePanel").then((m) => m.ExecutiveIntelligencePanel),
  { ssr: false },
);

const ExecutiveCoveragePanel = dynamic(
  () => import("@/components/hq/ExecutiveCoveragePanel").then((m) => m.ExecutiveCoveragePanel),
  { ssr: false },
);

const ExecutiveBriefs = dynamic(
  () => import("@/components/hq/ExecutiveBriefs").then((m) => m.ExecutiveBriefs),
  { ssr: false },
);

const InvestorDashboard = dynamic(
  () => import("@/components/hq/InvestorDashboard").then((m) => m.InvestorDashboard),
  { ssr: false },
);

export default function ExecutiveHqPage() {
  useRenderProbe("ExecutiveHqPage");
  useMountProbe("ExecutiveHqPage");
  const [viewMode, setViewMode] = useState<ExecutiveViewMode>("default");
  const dashboard = useAdminDashboardQuery();
  const finance = useQuery({
    queryKey: ["admin", "finance", "dashboard", "executive"],
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 120_000,
    refetchInterval: false,
  });
  const recent = useAdminBookingsQuery({ page: 1, limit: 6, poll: false });

  const stats = dashboard.data?.stats;
  const bookingsByDay = useMemo(
    () => dashboard.data?.charts.bookingsByDay ?? [],
    [dashboard.data?.charts.bookingsByDay],
  );
  const revenueByDay = useMemo(
    () => dashboard.data?.charts.revenueByDay ?? [],
    [dashboard.data?.charts.revenueByDay],
  );
  const maxRevenue = useMemo(
    () => Math.max(1, ...revenueByDay.map((d) => d.revenue)),
    [revenueByDay],
  );

  const hqLinks = useMemo(
    () =>
      HQ_SECTIONS.filter((s) => s.id !== "executive").map((s) => ({
        href: s.dashboardHref,
        label: s.shortLabel,
        description: s.description,
        icon:
          s.id === "operations"
            ? Gauge
            : s.id === "finance"
              ? TrendingUp
              : s.id === "risk"
                ? ShieldAlert
                : Activity,
      })),
    [],
  );

  const recentRows = useMemo(
    () =>
      (recent.data?.bookings ?? []).map((b) => [
        <span key={`id-${b.id}`} className="font-mono text-xs">
          {b.bookingNumber ?? b.id.slice(0, 8)}
        </span>,
        b.user,
        b.provider,
        b.service,
        inr(b.amount),
        <StatusBadge key={`st-${b.id}`} status={b.status} />,
      ]),
    [recent.data?.bookings],
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 biz-page-enter" data-dashboard-page>
      <header className="flex flex-col gap-4 border-b border-[var(--color-biz-line)] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-biz-accent-dim)] text-xl shadow-[0_0_24px_rgb(61_126_255_/_0.12)] ring-1 ring-inset ring-[rgb(61_126_255_/_0.25)]"
            aria-hidden
          >
            👑
          </span>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="biz-display text-2xl font-bold tracking-tight md:text-[1.75rem]">
                Executive HQ
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <span className="biz-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p className="max-w-2xl text-sm text-[var(--color-biz-muted)]">
              Business overview — live intelligence across markets, partners, and revenue
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ViewModeSwitcher mode={viewMode} onChange={setViewMode} />
          <button
            type="button"
            onClick={() => {
              void dashboard.refetch();
              void finance.refetch();
            }}
            disabled={dashboard.isFetching}
            className="biz-btn !px-3 !py-1.5 !text-xs"
          >
            {dashboard.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>
      </header>

      {dashboard.isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm font-medium text-red-300">
            Couldn&apos;t load dashboard data.{" "}
            <button type="button" onClick={() => void dashboard.refetch()} className="underline">
              Try again
            </button>
          </p>
        </div>
      ) : null}

      <ExecutiveKpiGrid
        stats={stats}
        financeOverview={(finance.data?.overview ?? null) as Record<string, number> | null}
        isLoading={dashboard.isLoading}
        mode={viewMode}
      />

      {viewMode === "investor" ? <InvestorDashboard /> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ExecutiveBriefs />
        </div>
        <div className="space-y-4">
          <AiBriefingPanel stats={stats} isLoading={dashboard.isLoading} />
          <ExecutiveCoveragePanel />
          <section className="biz-glass-panel p-4">
            <h2 className="mb-3 text-sm font-semibold">HQ Navigation</h2>
            <HqQuickLinkGrid links={hqLinks.slice(0, 4)} columns={2} />
          </section>
        </div>
      </div>

      <DashboardDOMBoundary label="below-fold" fallback={null} rootMargin="-420px 0px 0px 0px">
        <div className="space-y-6">
          <ExecutiveIntelligencePanel />
          <ExecutiveGeoPanel />
          <AdminDashboardCharts
            bookingsByDay={bookingsByDay}
            revenueByDay={revenueByDay}
            maxRevenue={maxRevenue}
            isLoading={dashboard.isLoading}
            activeNow={stats?.activeNow ?? 0}
            thisMonthRevenue={stats?.thisMonthRevenue ?? 0}
            totalRevenue={stats?.totalRevenue ?? 0}
          />

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="biz-display flex items-center gap-2 font-semibold tracking-tight">
                <span className="h-3.5 w-0.5 rounded-full bg-[var(--color-biz-accent)]" aria-hidden />
                Live bookings
              </h2>
              <Link href="/bookings" className="text-sm font-medium text-[var(--color-biz-accent)] hover:underline">
                View all
              </Link>
            </div>
            <DataTable
              headers={["ID", "Customer", "Partner", "Service", "Amount", "Status"]}
              isLoading={recent.isLoading}
              isFetching={recent.isFetching && !recent.data}
              isError={recent.isError}
              errorMessage="Failed to load recent bookings."
              onRetry={() => void recent.refetch()}
              emptyMessage="No bookings yet."
              rows={recentRows}
            />
          </section>

          <PlatformLaunchpad />
        </div>
      </DashboardDOMBoundary>
    </div>
  );
}
