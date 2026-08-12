"use client";

import { memo, useMemo } from "react";
import {
  Activity,
  IndianRupee,
  Percent,
  TrendingUp,
  Users,
  Wrench,
  CalendarCheck,
  Star,
  Zap,
} from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import type { DashboardStats } from "@/types/admin";
import { GlassPanel } from "./GlassPanel";

type FinanceOverview = Record<string, number | { count?: number; amount?: number }>;

export type ExecutiveViewMode = "default" | "board" | "investor" | "weekly";

export const ExecutiveKpiGrid = memo(function ExecutiveKpiGrid({
  stats,
  financeOverview,
  isLoading,
  mode,
}: {
  stats?: DashboardStats | null;
  financeOverview?: FinanceOverview | null;
  isLoading: boolean;
  mode: ExecutiveViewMode;
}) {
  const completionPct = stats?.totalBookings
    ? Math.round(((stats.completedBookings ?? 0) / Math.max(1, stats.totalBookings)) * 100)
    : 0;

  const gmv = Number(financeOverview?.gmv ?? stats?.thisMonthRevenue ?? 0);
  const netRevenue = Number(financeOverview?.netRevenue ?? stats?.thisMonthRevenue ?? 0);
  const marginPct = gmv > 0 ? Math.round((netRevenue / gmv) * 100) : 0;

  const allKpis = useMemo(
    () => [
      {
        key: "revenue",
        label: "Today's Revenue",
        value: isLoading ? "—" : inr(stats?.thisMonthRevenue ?? 0, true),
        sub: `Total ${inr(stats?.totalRevenue ?? 0, true)}`,
        icon: IndianRupee,
        modes: ["default", "board", "investor", "weekly"] as ExecutiveViewMode[],
      },
      {
        key: "bookings",
        label: "Today's Bookings",
        value: isLoading ? "—" : formatNumber(stats?.totalBookings ?? 0),
        sub: `${formatNumber(stats?.completedBookings ?? 0)} completed`,
        icon: CalendarCheck,
        modes: ["default", "board", "weekly"] as ExecutiveViewMode[],
      },
      {
        key: "gmv",
        label: "GMV",
        value: isLoading ? "—" : inr(gmv, true),
        sub: "30-day gross",
        icon: TrendingUp,
        modes: ["default", "investor", "board"] as ExecutiveViewMode[],
      },
      {
        key: "net",
        label: "Net Revenue",
        value: isLoading ? "—" : inr(netRevenue, true),
        sub: "Platform take",
        icon: IndianRupee,
        modes: ["default", "investor", "board"] as ExecutiveViewMode[],
      },
      {
        key: "margin",
        label: "Profit %",
        value: isLoading ? "—" : `${marginPct}%`,
        sub: "Net / GMV",
        icon: Percent,
        modes: ["investor", "board"] as ExecutiveViewMode[],
      },
      {
        key: "customers",
        label: "Active Customers",
        value: isLoading ? "—" : formatNumber(stats?.totalUsers ?? 0),
        sub: "Registered users",
        icon: Users,
        modes: ["default", "weekly", "board"] as ExecutiveViewMode[],
      },
      {
        key: "partners",
        label: "Active Partners",
        value: isLoading ? "—" : formatNumber(stats?.totalProviders ?? 0),
        sub: `${formatNumber(stats?.activeNow ?? 0)} online now`,
        icon: Wrench,
        modes: ["default", "board"] as ExecutiveViewMode[],
      },
      {
        key: "nps",
        label: "NPS Proxy",
        value: isLoading ? "—" : `${(stats?.averageRating ?? 0).toFixed(1)}★`,
        sub: "Avg rating",
        icon: Star,
        modes: ["default", "weekly"] as ExecutiveViewMode[],
      },
      {
        key: "util",
        label: "Utilization",
        value: isLoading ? "—" : `${completionPct}%`,
        sub: "Booking completion",
        icon: Activity,
        modes: ["default", "board", "weekly"] as ExecutiveViewMode[],
      },
      {
        key: "growth",
        label: "Growth Rate",
        value: isLoading ? "—" : `${completionPct > 0 ? "+" : ""}${Math.min(99, completionPct)}%`,
        sub: "Completion trend",
        icon: TrendingUp,
        modes: ["investor", "weekly"] as ExecutiveViewMode[],
      },
      {
        key: "health",
        label: "Platform Health",
        value: isLoading ? "—" : (stats?.activeNow ?? 0) > 0 ? "Operational" : "Idle",
        sub: `${formatNumber(stats?.activeNow ?? 0)} live sessions`,
        icon: Zap,
        modes: ["default", "board", "investor", "weekly"] as ExecutiveViewMode[],
      },
    ],
    [stats, isLoading, gmv, netRevenue, marginPct, completionPct],
  );

  const visible = allKpis.filter((k) => k.modes.includes(mode));

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-executive-kpi-grid>
      {visible.map((kpi) => (
        <GlassPanel key={kpi.key} className="biz-kpi p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
              {kpi.label}
            </span>
            <span className="biz-icon-chip">
              <kpi.icon className="h-4 w-4" />
            </span>
          </div>
          <p data-stat-value className="mt-2 text-[1.75rem] font-bold leading-9 tabular-nums tracking-tight">
            {kpi.value}
          </p>
          {kpi.sub ? <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{kpi.sub}</p> : null}
        </GlassPanel>
      ))}
    </section>
  );
});
