"use client";

import { memo, useMemo } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import { useChartProfiler } from "@/lib/chart-profiler";

const BarChart = memo(function BarChart({
  values,
  format,
  color = "primary",
}: {
  values: { label: string; value: number }[];
  format: (v: number) => string;
  color?: "primary" | "emerald";
}) {
  const max = useMemo(() => Math.max(1, ...values.map((v) => v.value)), [values]);
  const dataKey = useMemo(
    () => values.map((v) => `${v.label}:${v.value}`).join("|"),
    [values],
  );
  useChartProfiler("AdminAnalyticsBarChart", dataKey);

  if (values.length === 0) {
    return <p className="py-12 text-center text-xs text-[var(--color-biz-muted)]">No data available.</p>;
  }
  return (
    <div className="flex h-44 items-end justify-between gap-2">
      {values.map((v, i) => (
        <div key={`${v.label}-${i}`} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`w-full max-w-12 rounded-t ${color === "emerald" ? "bg-emerald-500/80" : "bg-[var(--color-biz-accent)]/80"}`}
            style={{ height: `${(v.value / max) * 100}%`, minHeight: 6 }}
            title={`${v.label}: ${format(v.value)}`}
          />
          <span className="text-[10px] text-[var(--color-biz-muted)]">{v.label.slice(5)}</span>
        </div>
      ))}
    </div>
  );
});

export const AdminAnalyticsCharts = memo(function AdminAnalyticsCharts({
  dailyBookings,
  dailyRevenue,
  topServices,
  maxServiceRevenue,
  isLoading,
  rangeLabel,
}: {
  dailyBookings: { date: string; count: number }[];
  dailyRevenue: { date: string; revenue: number }[];
  topServices: { name: string; bookings: number; revenue: number }[];
  maxServiceRevenue: number;
  isLoading: boolean;
  rangeLabel: string;
}) {
  const bookingValues = useMemo(
    () => dailyBookings.map((d) => ({ label: d.date, value: d.count })),
    [dailyBookings],
  );
  const revenueValues = useMemo(
    () => dailyRevenue.map((d) => ({ label: d.date, value: d.revenue })),
    [dailyRevenue],
  );

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="biz-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold">Daily bookings (last 7d)</p>
            <BarChart3 className="h-4 w-4 text-[var(--color-biz-muted)]" />
          </div>
          <BarChart values={bookingValues} format={formatNumber} />
        </div>
        <div className="biz-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold">Daily revenue (last 7d)</p>
            <TrendingUp className="h-4 w-4 text-[var(--color-biz-muted)]" />
          </div>
          <BarChart values={revenueValues} format={(v) => inr(v, true)} color="emerald" />
        </div>
      </div>

      <div className="biz-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Top services</p>
          <span className="text-[10px] text-[var(--color-biz-muted)]">{rangeLabel}</span>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 rounded bg-[var(--color-biz-elevated)]" />
            ))}
          </div>
        ) : topServices.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No service revenue in this period.</p>
        ) : (
          <ul className="space-y-2.5">
            {topServices.map((s, i) => {
              const pct = (s.revenue / maxServiceRevenue) * 100;
              return (
                <li key={`${s.name}-${i}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-[var(--color-biz-muted)]">
                      {formatNumber(s.bookings)} bookings · {inr(s.revenue, true)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--color-biz-elevated)]">
                    <div className="h-full rounded-full bg-[var(--color-biz-accent)]" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
});
