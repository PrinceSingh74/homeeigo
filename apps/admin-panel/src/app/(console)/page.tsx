"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Crown,
  Gauge,
  TrendingUp,
  ShieldAlert,
  Activity,
  LayoutGrid,
  Megaphone,
  Bot,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminKeys, useAdminBookingsQuery, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { inr } from "@/lib/format";
import { DashboardDOMBoundary } from "@/components/perf/DashboardDOMBoundary";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { ExecutiveKpiGrid, type ExecutiveViewMode } from "@/components/hq/ExecutiveKpiGrid";
import { AiBriefingPanel } from "@/components/hq/AiBriefingPanel";
import { ViewModeSwitcher } from "@/components/hq/ViewModeSwitcher";
import { HqQuickLinkGrid } from "@/components/hq/HqQuickLinkGrid";
import { ExecutiveBriefs } from "@/components/hq/ExecutiveBriefs";
import { ExecutiveCoveragePanel } from "@/components/hq/ExecutiveCoveragePanel";
import { DeferAfterPaint } from "@/components/perf/DeferAfterPaint";
import { Icon3D } from "@/components/hq/Icon3D";
import { HQ_SECTIONS } from "@/lib/hq-navigation";
import { adminApi } from "@/services/admin-api";

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

/**
 * Phase-9 executive brief (Capability 12).
 *
 * Mounted below the fold, beside the existing intelligence panel rather than replacing it: that one
 * shows headline figures from finance and geo-intelligence, this one shows where every figure came
 * from, how fresh it is, and what is known to be wrong with it. Lazy like its neighbours, because it
 * assembles nine sources server-side and must not sit in the first paint.
 */
const ExecutiveIntelligenceBrief = dynamic(
  () => import("@/components/hq/ExecutiveIntelligenceBrief").then((m) => m.ExecutiveIntelligenceBrief),
  { ssr: false },
);

const ExecutiveIntelligencePanel = dynamic(
  () => import("@/components/hq/ExecutiveIntelligencePanel").then((m) => m.ExecutiveIntelligencePanel),
  { ssr: false },
);

const InvestorDashboard = dynamic(
  () => import("@/components/hq/InvestorDashboard").then((m) => m.InvestorDashboard),
  { ssr: false },
);

const HQ_ICONS: Record<string, LucideIcon> = {
  operations: Gauge,
  marketplace: LayoutGrid,
  growth: Megaphone,
  finance: TrendingUp,
  risk: ShieldAlert,
  ai: Bot,
  monitoring: Activity,
  platform: Settings,
};

export default function ExecutiveHqPage() {
  useRenderProbe("ExecutiveHqPage");
  useMountProbe("ExecutiveHqPage");
  const [viewMode, setViewMode] = useState<ExecutiveViewMode>("default");
  const dashboard = useAdminDashboardQuery();
  const finance = useQuery({
    queryKey: adminKeys.financeDashboard(30),
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

  const syncedAt = dashboard.dataUpdatedAt
    ? new Date(dashboard.dataUpdatedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const hqLinks = useMemo(
    () =>
      HQ_SECTIONS.filter((s) => s.id !== "executive").map((s) => ({
        href: s.dashboardHref,
        label: s.shortLabel,
        description: s.description,
        icon: HQ_ICONS[s.id] ?? Activity,
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
    <div className="exec-hq mx-auto max-w-[1600px] space-y-8 biz-page-enter" data-dashboard-page>
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Crown} tone="warning" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">
                Executive HQ
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <span className="biz-live-dot" aria-hidden />
                Live
              </span>
              {syncedAt ? (
                <span className="text-[11px] text-[var(--color-biz-faint)]">Synced {syncedAt}</span>
              ) : null}
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
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
            className="biz-btn !px-3.5 !py-2 !text-xs"
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

      <div className="grid items-stretch gap-5 xl:grid-cols-2">
        <ExecutiveBriefs />
        <AiBriefingPanel stats={stats} isLoading={dashboard.isLoading} />
      </div>

      <DeferAfterPaint
        label="ExecutiveCoveragePanel"
        fallback={<div className="biz-skeleton h-40 rounded-2xl" aria-hidden />}
      >
        <ExecutiveCoveragePanel />
      </DeferAfterPaint>

      <section className="biz-glass-panel p-6">
        <div className="exec-section-head">
          <div className="exec-section-head__title">
            <Icon3D icon={Gauge} tone="default" size="md" />
            <h2 className="text-sm font-semibold leading-none tracking-tight">HQ Command</h2>
          </div>
          <span className="exec-section-head__meta">8 operating systems</span>
        </div>
        <HqQuickLinkGrid links={hqLinks} columns={4} />
      </section>

      <DashboardDOMBoundary label="below-fold" fallback={null} rootMargin="-420px 0px 0px 0px">
        <div className="space-y-8">
          <ExecutiveIntelligencePanel />
          <ExecutiveIntelligenceBrief />
          <ExecutiveGeoPanel />
          <AdminDashboardCharts
            bookingsByDay={bookingsByDay}
            revenueByDay={revenueByDay}
            maxRevenue={maxRevenue}
            isLoading={dashboard.isLoading}
            activeNow={stats?.activeNow ?? 0}
            thisMonthRevenue={stats?.thisMonthRevenue ?? 0}
            totalRevenue={stats?.totalRevenue ?? 0}
            totalBookings={stats?.totalBookings ?? 0}
            averageRating={stats?.averageRating ?? 0}
            completedBookings={stats?.completedBookings ?? 0}
          />

          <section className="biz-glass-panel overflow-hidden p-0">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--color-biz-line)] px-6 py-4">
              <div className="exec-section-head__title">
                <Icon3D icon={Activity} tone="cyan" size="md" />
                <h2 className="text-sm font-semibold leading-none tracking-tight">Live bookings</h2>
              </div>
              <Link href="/bookings" className="text-xs font-medium text-[var(--color-biz-accent)] hover:underline">
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
              flush
            />
          </section>

          <PlatformLaunchpad />
        </div>
      </DashboardDOMBoundary>
    </div>
  );
}
