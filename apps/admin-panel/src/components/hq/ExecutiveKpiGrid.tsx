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
  Radio,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import type { DashboardStats } from "@/types/admin";
import { GlassPanel } from "./GlassPanel";
import { Icon3D } from "./Icon3D";
import { cn } from "@/lib/cn";

type FinanceOverview = Record<string, number | { count?: number; amount?: number }>;

export type ExecutiveViewMode = "default" | "board" | "investor" | "weekly";

type KpiTone = "default" | "cyan" | "success" | "warning" | "danger";

type KpiDef = {
  key: string;
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone: KpiTone;
  meter?: number;
};

const MODE_KEYS: Record<ExecutiveViewMode, readonly string[]> = {
  default: ["revenue", "bookings", "gmv", "net", "customers", "partners", "nps", "util"],
  board: ["revenue", "bookings", "gmv", "net", "margin", "customers", "partners", "util"],
  investor: ["gmv", "net", "margin", "growth", "revenue", "customers", "partners", "util"],
  weekly: ["revenue", "bookings", "customers", "nps", "util", "growth", "gmv", "partners"],
};

const VALUE: Record<KpiTone, string> = {
  default: "text-[var(--color-biz-text)]",
  cyan: "text-[var(--color-biz-cyan)]",
  success: "text-[var(--color-biz-success)]",
  warning: "text-[var(--color-biz-warning)]",
  danger: "text-[var(--color-biz-danger)]",
};

const METER: Record<KpiTone, string> = {
  default: "",
  cyan: "",
  success: "biz-meter--success",
  warning: "biz-meter--warning",
  danger: "biz-meter--danger",
};

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
  const onlinePct =
    stats && stats.totalProviders > 0
      ? Math.round((stats.activeNow / stats.totalProviders) * 100)
      : 0;
  const healthy = (stats?.activeNow ?? 0) > 0;

  const catalog = useMemo<KpiDef[]>(() => {
    const dash = (v: string) => (isLoading ? "—" : v);
    return [
      {
        key: "revenue",
        label: "Today's Revenue",
        value: dash(inr(stats?.thisMonthRevenue ?? 0, true)),
        sub: `Lifetime ${inr(stats?.totalRevenue ?? 0, true)}`,
        icon: IndianRupee,
        tone: "default",
      },
      {
        key: "bookings",
        label: "Today's Bookings",
        value: dash(formatNumber(stats?.totalBookings ?? 0)),
        sub: `${formatNumber(stats?.completedBookings ?? 0)} completed`,
        icon: CalendarCheck,
        tone: "cyan",
        meter: completionPct,
      },
      {
        key: "gmv",
        label: "GMV",
        value: dash(inr(gmv, true)),
        sub: "30-day gross merchandise",
        icon: TrendingUp,
        tone: "success",
      },
      {
        key: "net",
        label: "Net Revenue",
        value: dash(inr(netRevenue, true)),
        sub: "Platform take · 30-day",
        icon: IndianRupee,
        tone: netRevenue < 0 ? "danger" : "success",
      },
      {
        key: "margin",
        label: "Profit %",
        value: dash(`${marginPct}%`),
        sub: "Net / GMV",
        icon: Percent,
        tone: marginPct >= 20 ? "success" : marginPct >= 0 ? "warning" : "danger",
        meter: Math.max(0, Math.min(100, marginPct)),
      },
      {
        key: "customers",
        label: "Active Customers",
        value: dash(formatNumber(stats?.totalUsers ?? 0)),
        sub: "Registered user base",
        icon: Users,
        tone: "default",
      },
      {
        key: "partners",
        label: "Active Partners",
        value: dash(formatNumber(stats?.totalProviders ?? 0)),
        sub: `${formatNumber(stats?.activeNow ?? 0)} online now · ${onlinePct}%`,
        icon: Wrench,
        tone: "cyan",
        meter: onlinePct,
      },
      {
        key: "nps",
        label: "NPS Proxy",
        value: dash(`${(stats?.averageRating ?? 0).toFixed(1)}★`),
        sub: "Average service rating",
        icon: Star,
        tone: (stats?.averageRating ?? 0) >= 4 ? "success" : (stats?.averageRating ?? 0) >= 3 ? "warning" : "danger",
        meter: Math.round(((stats?.averageRating ?? 0) / 5) * 100),
      },
      {
        key: "util",
        label: "Utilization",
        value: dash(`${completionPct}%`),
        sub: "Booking completion rate",
        icon: Activity,
        tone: completionPct >= 70 ? "success" : completionPct >= 40 ? "warning" : "danger",
        meter: completionPct,
      },
      {
        key: "growth",
        label: "Growth Rate",
        value: dash(`${completionPct > 0 ? "+" : ""}${Math.min(99, completionPct)}%`),
        sub: "Completion trend proxy",
        icon: TrendingUp,
        tone: "default",
        meter: Math.min(100, completionPct),
      },
    ];
  }, [stats, isLoading, gmv, netRevenue, marginPct, completionPct, onlinePct]);

  const visible = MODE_KEYS[mode]
    .map((key) => catalog.find((k) => k.key === key))
    .filter((k): k is KpiDef => Boolean(k));

  return (
    <div className="space-y-4" data-executive-kpi-grid>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((kpi) => (
          <GlassPanel key={kpi.key} className="biz-kpi flex min-h-[160px] flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
                {kpi.label}
              </span>
              <Icon3D icon={kpi.icon} tone={kpi.tone} size="md" />
            </div>
            <p
              data-stat-value
              className={cn(
                "text-[1.75rem] font-bold leading-none tracking-tight",
                VALUE[kpi.tone],
              )}
            >
              {kpi.value}
            </p>
            <p className="text-xs leading-snug text-[var(--color-biz-muted)]">{kpi.sub}</p>
            {kpi.meter != null ? (
              <div
                className={cn("biz-meter mt-auto", METER[kpi.tone])}
                role="meter"
                aria-label={kpi.label}
                aria-valuenow={kpi.meter}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.max(4, Math.min(100, kpi.meter))}%` }} />
              </div>
            ) : (
              <div className="biz-meter mt-auto" aria-hidden />
            )}
          </GlassPanel>
        ))}
      </section>

      <GlassPanel className="overflow-hidden p-0">
        <div className="biz-status-ribbon">
          <div className="flex items-center gap-3 bg-[var(--color-biz-elevated)]/40">
            <Icon3D icon={Zap} tone={healthy ? "success" : "warning"} size="md" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
                Platform Health
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold leading-tight">
                {isLoading ? "—" : healthy ? "Operational" : "Idle"}
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                  <span className="biz-live-dot" aria-hidden />
                  Live
                </span>
              </p>
            </div>
          </div>
          <RibbonStat
            label="Live sessions"
            value={isLoading ? "—" : formatNumber(stats?.activeNow ?? 0)}
            hint="active now"
            icon={Radio}
          />
          <RibbonStat
            label="Partners online"
            value={isLoading ? "—" : `${formatNumber(stats?.activeNow ?? 0)}/${formatNumber(stats?.totalProviders ?? 0)}`}
            hint={`${onlinePct}% of fleet`}
            icon={Wrench}
          />
          <RibbonStat
            label="Completion"
            value={isLoading ? "—" : `${completionPct}%`}
            hint="bookings closed"
            icon={Activity}
          />
          <RibbonStat
            label="Avg rating"
            value={isLoading ? "—" : `${(stats?.averageRating ?? 0).toFixed(1)}★`}
            hint="NPS proxy"
            icon={Star}
          />
        </div>
      </GlassPanel>
    </div>
  );
});

function RibbonStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon3D icon={Icon} tone="default" size="sm" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          {label}
        </p>
        <p data-stat-value className="mt-0.5 truncate text-base font-semibold tabular-nums leading-tight">
          {value}
        </p>
        {hint ? <p className="text-[10px] text-[var(--color-biz-faint)]">{hint}</p> : null}
      </div>
    </div>
  );
}
