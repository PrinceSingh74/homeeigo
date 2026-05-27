"use client";

import { TrendingDown } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  DEMO_DASHBOARD,
  DEMO_WEEKLY_EARNINGS,
  formatInr,
} from "@/lib/partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
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

export function DashboardEarningsChart() {
  const max = Math.max(...DEMO_WEEKLY_EARNINGS.map((d) => d.amount));

  return (
    <DashboardPanel
      title="Earnings Overview"
      action={
        <button
          type="button"
          className="rounded-lg border border-partner-line px-2.5 py-1 text-xs font-medium text-partner-text-secondary"
        >
          This Week ▾
        </button>
      }
      bodyClassName="gap-5"
    >
      <div className="space-y-1">
        <p className="font-display text-4xl font-bold leading-none tracking-[-0.03em] text-partner-text">
          {formatInr(DEMO_DASHBOARD.weeklyEarnings)}
        </p>
        <p className="flex items-center gap-1 text-xs font-medium text-partner-danger">
          <TrendingDown className="h-3.5 w-3.5" />
          {DEMO_DASHBOARD.weeklyEarningsChange}% vs last week
        </p>
      </div>

      <div className="h-[128px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={DEMO_WEEKLY_EARNINGS}
            margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
            barCategoryGap="18%"
          >
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              dy={4}
            />
            <YAxis hide domain={[0, max * 1.12]} />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={36}>
              {DEMO_WEEKLY_EARNINGS.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-3 border-t border-partner-line pt-5 text-xs">
        {[
          ["This Month", formatInr(DEMO_DASHBOARD.monthlyEarnings), "text-partner-text"],
          ["Total Earnings", formatInr(DEMO_DASHBOARD.lifetimeEarnings), "text-partner-text"],
          ["Incentives", formatInr(DEMO_DASHBOARD.incentivesEarned), "text-partner-accent"],
        ].map(([label, value, valueClass]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-partner-text-secondary">{label}</span>
            <span className={cn("font-semibold tabular-nums", valueClass)}>{value}</span>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}
