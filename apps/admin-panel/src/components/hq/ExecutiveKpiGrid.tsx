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
  const completionPct = stats?.completionRatePct ?? null;
  const cancellationPct = stats?.cancellationRatePct ?? null;
  const partnerRating = stats?.partnerRatingMean ?? stats?.averageRating ?? null;

  const gmv = typeof financeOverview?.gmv === "number" ? financeOverview.gmv : null;
  const netRevenue = typeof financeOverview?.netRevenue === "number" ? financeOverview.netRevenue : null;
  const marginPct = gmv != null && gmv > 0 && netRevenue != null ? Math.round((netRevenue / gmv) * 100) : null;
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
        label: "Paid booking value",
        value: dash(inr(stats?.thisMonthRevenue ?? 0, true)),
        sub: `This month · lifetime ${inr(stats?.totalRevenue ?? 0, true)}`,
        icon: IndianRupee,
        tone: "default",
      },
      {
        key: "bookings",
        label: "Bookings",
        value: dash(formatNumber(stats?.totalBookings ?? 0)),
        sub: `All time · ${formatNumber(stats?.completedBookings ?? 0)} completed`,
        icon: CalendarCheck,
        tone: "cyan",
        meter: completionPct ?? undefined,
      },
      {
        key: "gmv",
        label: "Captured GMV",
        value: dash(gmv == null ? "—" : inr(gmv, true)),
        sub: "Payments plus wallet · 30-day",
        icon: TrendingUp,
        tone: "success",
      },
      {
        key: "net",
        label: "Net captured",
        value: dash(netRevenue == null ? "—" : inr(netRevenue, true)),
        sub: "Captured GMV minus refunds · 30-day",
        icon: IndianRupee,
        tone: netRevenue != null && netRevenue < 0 ? "danger" : "success",
      },
      {
        key: "margin",
        label: "Profit %",
        value: dash(marginPct == null ? "—" : `${marginPct}%`),
        sub: "Net captured / captured GMV",
        icon: Percent,
        tone: marginPct == null ? "default" : marginPct >= 20 ? "success" : marginPct >= 0 ? "warning" : "danger",
        meter: marginPct == null ? undefined : Math.max(0, Math.min(100, marginPct)),
      },
      {
        key: "customers",
        label: "Customers",
        value: dash(formatNumber(stats?.totalUsers ?? 0)),
        sub: "Registered user base",
        icon: Users,
        tone: "default",
      },
      {
        key: "partners",
        label: "Partners",
        value: dash(formatNumber(stats?.totalProviders ?? 0)),
        sub: `${formatNumber(stats?.activeNow ?? 0)} online now · ${onlinePct}%`,
        icon: Wrench,
        tone: "cyan",
        meter: onlinePct,
      },
      {
        key: "nps",
        label: "Partner rating",
        value: dash(partnerRating != null ? `${partnerRating.toFixed(1)}★` : "—"),
        sub: "Mean of partner ratings",
        icon: Star,
        tone: (partnerRating ?? 0) >= 4 ? "success" : partnerRating == null ? "default" : partnerRating >= 3 ? "warning" : "danger",
        meter: partnerRating != null ? Math.round((partnerRating / 5) * 100) : undefined,
      },
      {
        key: "util",
        label: "Completion",
        value: dash(completionPct != null ? `${completionPct}%` : "—"),
        sub: "Completed over finished bookings",
        icon: Activity,
        tone: completionPct == null ? "default" : completionPct >= 70 ? "success" : completionPct >= 40 ? "warning" : "danger",
        meter: completionPct ?? undefined,
      },
      {
        key: "growth",
        label: "Cancellation",
        value: dash(cancellationPct != null ? `${cancellationPct}%` : "—"),
        sub: "Cancelled over finished bookings",
        icon: TrendingUp,
        tone: cancellationPct == null ? "default" : cancellationPct >= 20 ? "danger" : cancellationPct > 0 ? "warning" : "success",
        meter: cancellationPct ?? undefined,
      },
    ];
  }, [stats, isLoading, gmv, netRevenue, marginPct, completionPct, cancellationPct, partnerRating, onlinePct]);

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
            value={isLoading || completionPct == null ? "—" : `${completionPct}%`}
            hint="of finished bookings"
            icon={Activity}
          />
          <RibbonStat
            label="Partner rating"
            value={isLoading || partnerRating == null ? "—" : `${partnerRating.toFixed(1)}★`}
            hint="mean partner rating"
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
