"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, IndianRupee, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  usePartnerDashboardQuery,
  usePartnerEarningsQuery,
  usePartnerInvoicesQuery,
  usePartnerPayoutsQuery,
} from "@/hooks/use-partner-data";
import { usePartnerEarningsStream } from "@/hooks/use-partner-earnings-stream";
import { formatDate, formatInr } from "@/lib/format";
import { cn } from "@/lib/cn";

type EarningsPeriod = "daily" | "weekly" | "monthly" | "yearly";

const PERIOD_DAYS: Record<EarningsPeriod, number> = {
  daily: 7,
  weekly: 28,
  monthly: 30,
  yearly: 365,
};

export function EarningsOverview() {
  const [period, setPeriod] = useState<EarningsPeriod>("monthly");

  const dashboard = usePartnerDashboardQuery();
  const earnings = usePartnerEarningsQuery(PERIOD_DAYS[period]);
  const payouts = usePartnerPayoutsQuery();
  const invoices = usePartnerInvoicesQuery();
  const { snapshot: live } = usePartnerEarningsStream();

  const summary = useMemo(() => {
    const d = dashboard.data?.earnings;
    const yearlyTotal =
      payouts.data?.analytics.yearly.reduce((s, r) => s + r.amount, 0) ??
      d?.lifetime ??
      0;
    return {
      today: live?.todayEarnings ?? d?.today ?? 0,
      weekly: live?.weeklyEarnings ?? d?.thisWeek ?? 0,
      monthly: live?.monthlyEarnings ?? d?.thisMonth ?? 0,
      yearly: yearlyTotal,
      trend: d?.todayChange ?? 0,
    };
  }, [dashboard.data, live, payouts.data]);

  const chartData = useMemo(() => {
    const analytics = payouts.data?.analytics;
    if (analytics) {
      const series =
        period === "daily"
          ? analytics.daily
          : period === "weekly"
            ? analytics.weekly
            : period === "monthly"
              ? analytics.monthly
              : analytics.yearly;
      if (series.length > 0) {
        return series.map((row) => ({
          date: row.period,
          gross: row.amount,
          net: row.amount,
        }));
      }
    }
    return (earnings.data?.series ?? []).map((row) => ({
      date: row.date.slice(5),
      gross: row.amount,
      net: row.amount,
    }));
  }, [earnings.data, payouts.data, period]);

  const breakdownRows = useMemo(() => {
    const rows = invoices.data?.earnings ?? [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PERIOD_DAYS[period]);
    return rows
      .filter((r) => new Date(r.date) >= cutoff)
      .map((r) => ({
        date: formatDate(r.date),
        gross: r.gross,
        commission: r.commission,
        tax: 0,
        deductions: Math.max(0, r.gross - r.commission - r.net),
        net: r.net,
        bookings: 1,
      }));
  }, [invoices.data, period]);

  const settlements = invoices.data?.settlements ?? [];
  const isLoading = dashboard.isLoading && !dashboard.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Today's earnings"
          amount={summary.today}
          sub="vs yesterday"
          trend={summary.trend}
          loading={isLoading}
        />
        <SummaryCard title="This week" amount={summary.weekly} sub="7 days" loading={isLoading} />
        <SummaryCard title="This month" amount={summary.monthly} sub="30 days" loading={isLoading} />
        <SummaryCard title="This year" amount={summary.yearly} sub="365 days" loading={isLoading} />
      </div>

      <PartnerCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Earnings trend</h2>
          <div className="flex flex-wrap gap-2">
            {(["daily", "weekly", "monthly", "yearly"] as EarningsPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
                  period === p
                    ? "bg-partner-primary text-white"
                    : "bg-partner-bg/60 text-partner-muted hover:text-partner-text",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          {earnings.isLoading && chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-partner-muted" />
            </div>
          ) : chartData.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-partner-muted">
              No earnings in this period yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip
                  formatter={(value) => formatInr(Number(value))}
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: 8,
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="gross"
                  stroke="#3b82f6"
                  name="Gross"
                  dot={{ r: 3 }}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  stroke="#10b981"
                  name="Net"
                  dot={{ r: 3 }}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </PartnerCard>

      <PartnerCard className="overflow-x-auto">
        <h2 className="mb-4 font-display text-lg font-semibold">Earnings breakdown</h2>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-partner-line text-partner-muted">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 text-right font-medium">Gross</th>
              <th className="py-2 pr-4 text-right font-medium">Commission</th>
              <th className="py-2 pr-4 text-right font-medium">Deductions</th>
              <th className="py-2 pr-4 text-right font-medium">Net</th>
              <th className="py-2 text-right font-medium">Jobs</th>
            </tr>
          </thead>
          <tbody>
            {breakdownRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-partner-muted">
                  No job earnings in this period.
                </td>
              </tr>
            ) : (
              breakdownRows.map((row, idx) => (
                <tr key={idx} className="border-b border-partner-line/60 last:border-0">
                  <td className="py-3 pr-4">{row.date}</td>
                  <td className="py-3 pr-4 text-right font-medium">{formatInr(row.gross)}</td>
                  <td className="py-3 pr-4 text-right text-partner-danger">
                    -{formatInr(row.commission)}
                  </td>
                  <td className="py-3 pr-4 text-right text-partner-danger">
                    -{formatInr(row.deductions)}
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-partner-success">
                    {formatInr(row.net)}
                  </td>
                  <td className="py-3 text-right">{row.bookings}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PartnerCard>

      <PartnerCard>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Settlement history</h2>
          <Link
            href="/earnings/payouts"
            className="inline-flex items-center gap-1 text-xs font-medium text-partner-primary hover:underline"
          >
            Request payout <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="space-y-2">
          {settlements.length === 0 ? (
            <p className="text-sm text-partner-muted">No settlements yet.</p>
          ) : (
            settlements.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl bg-partner-bg/40 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{s.settlementNumber}</p>
                  <p className="text-xs capitalize text-partner-muted">{s.status}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatInr(s.netAmount)}</p>
                  <p className="text-xs text-partner-muted">{formatDate(s.date)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </PartnerCard>
    </div>
  );
}

function SummaryCard({
  title,
  amount,
  sub,
  trend,
  loading,
}: {
  title: string;
  amount: number;
  sub: string;
  trend?: number;
  loading?: boolean;
}) {
  const positive = (trend ?? 0) >= 0;
  return (
    <PartnerCard className="!p-5">
      <div className="flex items-center gap-2 text-partner-muted">
        <IndianRupee className="h-4 w-4" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      <p className="font-display mt-2 text-2xl font-bold">
        {loading ? "—" : formatInr(amount)}
      </p>
      <p className="mt-1 text-[10px] text-partner-muted">{sub}</p>
      {trend !== undefined && !loading ? (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-xs font-medium",
            positive ? "text-partner-success" : "text-partner-danger",
          )}
        >
          {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {Math.abs(trend)}% vs prior day
        </p>
      ) : null}
    </PartnerCard>
  );
}
