"use client";

import { memo, useMemo } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { LazyBarChart } from "@/components/charts/LazyBarChart";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/cn";

const BAR_COLORS = [
  "#2563eb",
  "#3b82f6",
  "#4f46e5",
  "#6366f1",
  "#7c3aed",
  "#8b5cf6",
  "#7c3aed",
];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DashboardEarningsChart = memo(function DashboardEarningsChart() {
  const { data, isLoading } = usePartnerDashboardQuery();

  const sparkline = data?.earnings.sparkline ?? [];
  const chartData = useMemo(
    () =>
      sparkline.map((d) => ({
        day: DOW[new Date(d.date).getDay()] ?? d.date.slice(5),
        amount: d.amount,
      })),
    [sparkline],
  );
  const max = useMemo(
    () => (chartData.length > 0 ? Math.max(...chartData.map((d) => d.amount), 1) : 1),
    [chartData],
  );

  const weekly = data?.earnings.thisWeek ?? 0;
  const monthly = data?.earnings.thisMonth ?? 0;
  const lifetime = data?.earnings.lifetime ?? 0;
  const commission = data?.earnings.weeklyCommission ?? 0;
  // Net take-home % comes straight from the API — no frontend commission math.
  const trend = data?.earnings.weeklyTakeHomePct ?? 0;
  const commissionRate = data?.earnings.commissionRate ?? 0;
  const trendPositive = trend >= 50;

  return (
    <DashboardPanel
      title="Earnings Overview"
      action={
        <span className="rounded-lg border border-partner-line px-2.5 py-1 text-xs font-medium text-partner-text-secondary">
          This Week
        </span>
      }
      bodyClassName="gap-5"
    >
      <div className="space-y-1">
        <p className="font-display text-4xl font-bold leading-none tracking-[-0.03em] text-partner-text">
          {isLoading ? "—" : formatInr(weekly)}
        </p>
        <p
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            trendPositive ? "text-partner-success" : "text-partner-warning",
          )}
        >
          {trendPositive ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {trend}% net take-home this week
        </p>
      </div>

      <div className="h-[128px] w-full">
        {isLoading || chartData.length === 0 ? (
          <div className="h-full w-full rounded-lg bg-white/[0.03]" />
        ) : (
          <LazyBarChart data={chartData} max={max} colors={BAR_COLORS} />
        )}
      </div>

      <div className="grid gap-3 border-t border-partner-line pt-5 text-xs">
        {[
          ["This Month", formatInr(monthly), "text-partner-text"],
          ["Total Earnings", formatInr(lifetime), "text-partner-text"],
          ["Platform Commission (7d)", formatInr(commission), "text-partner-accent"],
          ["Commission Tier", `${commissionRate}%`, "text-partner-text-secondary"],
        ].map(([label, value, valueClass]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-partner-text-secondary">{label}</span>
            <span className={cn("font-semibold tabular-nums", valueClass)}>{value}</span>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
});
