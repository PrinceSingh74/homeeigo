"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  TrendingUp,
} from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useChartProfiler } from "@/lib/chart-profiler";

type DayPoint = { date: string; count?: number; revenue?: number };

export const AdminDashboardCharts = memo(function AdminDashboardCharts({
  bookingsByDay,
  revenueByDay,
  maxRevenue,
  isLoading,
  activeNow,
  thisMonthRevenue,
  totalRevenue,
}: {
  bookingsByDay: DayPoint[];
  revenueByDay: DayPoint[];
  maxRevenue: number;
  isLoading: boolean;
  activeNow: number;
  thisMonthRevenue: number;
  totalRevenue: number;
}) {
  useRenderProbe("AdminDashboardCharts");
  useMountProbe("AdminDashboardCharts");

  const bookingValues = useMemo(
    () => bookingsByDay.map((d) => ({ label: d.date, value: d.count ?? 0 })),
    [bookingsByDay],
  );
  const revenueValues = useMemo(
    () => revenueByDay.map((d) => ({ label: d.date, value: d.revenue ?? 0 })),
    [revenueByDay],
  );
  const bookingKey = useMemo(() => bookingValues.map((v) => `${v.label}:${v.value}`).join("|"), [bookingValues]);
  const revenueKey = useMemo(() => revenueValues.map((v) => `${v.label}:${v.value}`).join("|"), [revenueValues]);
  useChartProfiler("AdminDashboardCharts", `${bookingKey}|${revenueKey}`);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <ChartCard
        title="Bookings (last 7 days)"
        values={bookingValues}
        format={(v) => formatNumber(v)}
        icon={LayoutDashboard}
        isLoading={isLoading}
      />
      <ChartCard
        title="Revenue (last 7 days)"
        values={revenueValues}
        format={(v) => inr(v, true)}
        max={maxRevenue}
        icon={CreditCard}
        accent="green"
        isLoading={isLoading}
      />
      <div className="biz-card flex flex-col gap-3 p-5">
        <Building2 className="h-5 w-5 text-[var(--color-biz-accent)]" />
        <div>
          <p className="text-sm font-semibold">Operations health</p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            Live data refreshes every 120 seconds.
          </p>
        </div>
        <ul className="mt-2 space-y-2 text-xs">
          <li className="flex items-center justify-between rounded-md bg-[var(--color-biz-elevated)]/50 px-3 py-2">
            <span className="text-[var(--color-biz-muted)]">Providers online</span>
            <span className="font-medium">{formatNumber(activeNow)}</span>
          </li>
          <li className="flex items-center justify-between rounded-md bg-[var(--color-biz-elevated)]/50 px-3 py-2">
            <span className="text-[var(--color-biz-muted)]">This month</span>
            <span className="font-medium">{inr(thisMonthRevenue, true)}</span>
          </li>
          <li className="flex items-center justify-between rounded-md bg-[var(--color-biz-elevated)]/50 px-3 py-2">
            <span className="text-[var(--color-biz-muted)]">All-time</span>
            <span className="font-medium">{inr(totalRevenue, true)}</span>
          </li>
        </ul>
        <Link
          href="/analytics"
          className="mt-auto text-xs font-medium text-[var(--color-biz-accent)] hover:underline"
        >
          Open analytics →
        </Link>
      </div>
    </div>
  );
});

const ChartCard = memo(function ChartCard({
  title,
  values,
  format,
  max,
  icon: Icon,
  accent = "primary",
  isLoading,
}: {
  title: string;
  values: { label: string; value: number }[];
  format: (v: number) => string;
  max?: number;
  icon: typeof TrendingUp;
  accent?: "primary" | "green";
  isLoading?: boolean;
}) {
  const localMax = max ?? Math.max(1, ...values.map((v) => v.value));
  const barClass =
    accent === "green"
      ? "bg-emerald-500/80"
      : "bg-[var(--color-biz-accent)]/80";

  return (
    <div className="biz-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <Icon className="h-4 w-4 text-[var(--color-biz-muted)]" />
      </div>
      <div className="flex h-44 items-end justify-between gap-2">
        {isLoading
          ? Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-full flex-1 max-w-12 rounded-t bg-[var(--color-biz-elevated)]"
              />
            ))
          : values.map((v, i) => (
              <div key={`${v.label}-${i}`} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full max-w-12 rounded-t ${barClass}`}
                  style={{
                    height: `${(v.value / localMax) * 100}%`,
                    minHeight: 6,
                  }}
                  title={`${v.label}: ${format(v.value)}`}
                />
                <span className="text-[10px] text-[var(--color-biz-muted)]">
                  {v.label.slice(5)}
                </span>
              </div>
            ))}
      </div>
    </div>
  );
});
