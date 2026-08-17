"use client";

import { memo, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { Building2, CreditCard, LayoutDashboard, Star, CheckCircle2 } from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useChartProfiler } from "@/lib/chart-profiler";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { Icon3D } from "@/components/hq/Icon3D";

type DayPoint = { date: string; count?: number; revenue?: number };

export const AdminDashboardCharts = memo(function AdminDashboardCharts({
  bookingsByDay,
  revenueByDay,
  maxRevenue: _maxRevenue,
  isLoading,
  activeNow,
  thisMonthRevenue,
  totalRevenue,
  totalBookings = 0,
  averageRating = 0,
  completedBookings = 0,
}: {
  bookingsByDay: DayPoint[];
  revenueByDay: DayPoint[];
  maxRevenue: number;
  isLoading: boolean;
  activeNow: number;
  thisMonthRevenue: number;
  totalRevenue: number;
  totalBookings?: number;
  averageRating?: number;
  completedBookings?: number;
}) {
  useRenderProbe("AdminDashboardCharts");
  useMountProbe("AdminDashboardCharts");

  const bookingValues = useMemo(
    () => bookingsByDay.map((d) => ({ label: d.date.slice(5), value: d.count ?? 0 })),
    [bookingsByDay],
  );
  const revenueValues = useMemo(
    () => revenueByDay.map((d) => ({ label: d.date.slice(5), value: d.revenue ?? 0 })),
    [revenueByDay],
  );
  const bookingKey = useMemo(() => bookingValues.map((v) => `${v.label}:${v.value}`).join("|"), [bookingValues]);
  const revenueKey = useMemo(() => revenueValues.map((v) => `${v.label}:${v.value}`).join("|"), [revenueValues]);
  useChartProfiler("AdminDashboardCharts", `${bookingKey}|${revenueKey}`);

  const completion =
    totalBookings > 0 ? Math.round((completedBookings / Math.max(1, totalBookings)) * 100) : 0;
  const ringTone = completion >= 70 ? "success" : completion >= 40 ? "warning" : "danger";

  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-3">
      <div className="biz-glass-panel flex h-full flex-col p-6">
        <div className="exec-section-head">
          <p className="text-sm font-semibold leading-none">Bookings · last 7 days</p>
          <Icon3D icon={LayoutDashboard} tone="default" size="sm" />
        </div>
        <IsoBarChart
          data={bookingValues}
          format={(v) => formatNumber(v)}
          accent="blue"
          isLoading={isLoading}
          height={210}
        />
      </div>
      <div className="biz-glass-panel flex h-full flex-col p-6">
        <div className="exec-section-head">
          <p className="text-sm font-semibold leading-none">Revenue · last 7 days</p>
          <Icon3D icon={CreditCard} tone="success" size="sm" />
        </div>
        <IsoBarChart
          data={revenueValues}
          format={(v) => inr(v, true)}
          accent="emerald"
          isLoading={isLoading}
          height={210}
          layout="area"
        />
      </div>
      <div className="biz-glass-panel flex h-full flex-col p-6">
        <div className="exec-section-head">
          <p className="text-sm font-semibold leading-none">Operations health</p>
          <Icon3D icon={Building2} tone="cyan" size="sm" />
        </div>
        <GlassRing3D
          value={completion}
          label="Complete"
          sub={`${formatNumber(activeNow)} partners live · ${inr(thisMonthRevenue, true)} MTD`}
          tone={ringTone}
        />
        <ul className="mt-auto space-y-2.5 text-xs">
          <HealthRow label="All-time revenue" value={inr(totalRevenue, true)} />
          <HealthRow
            label="Avg rating"
            value={`${averageRating.toFixed(1)}★`}
            icon={<Star className="h-3 w-3 text-[var(--color-biz-warning)]" />}
          />
          <HealthRow
            label="Closed bookings"
            value={formatNumber(completedBookings)}
            icon={<CheckCircle2 className="h-3 w-3 text-[var(--color-biz-success)]" />}
          />
        </ul>
        <Link
          href="/analytics"
          className="mt-4 text-xs font-medium text-[var(--color-biz-accent)] hover:underline"
        >
          Open analytics →
        </Link>
      </div>
    </div>
  );
});

function HealthRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/40 px-3 py-2 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 text-[var(--color-biz-muted)]">
        {icon}
        {label}
      </span>
      <span className="biz-num font-medium tabular-nums">{value}</span>
    </li>
  );
}
