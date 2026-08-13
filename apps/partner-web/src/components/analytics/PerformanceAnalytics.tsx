"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Clock, Loader2, Star, ThumbsUp } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  usePartnerBookingsQuery,
  usePartnerDashboardQuery,
  usePartnerEarningsQuery,
  usePartnerInvoicesQuery,
  usePartnerMeQuery,
} from "@/hooks/use-partner-data";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type Period = "week" | "month" | "year";

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, year: 365 };

export function PerformanceAnalytics() {
  const [period, setPeriod] = useState<Period>("month");
  const days = PERIOD_DAYS[period];

  const me = usePartnerMeQuery();
  const dashboard = usePartnerDashboardQuery();
  const earnings = usePartnerEarningsQuery(days);
  const bookings = usePartnerBookingsQuery({ page: 1, limit: 100, sortBy: "recent" });
  const invoices = usePartnerInvoicesQuery();

  const rates = dashboard.data?.rates;
  // rates.* are already percentages (0–100) from the provider record.
  const acceptancePct = Math.round(rates?.acceptanceRate ?? 0);
  const completionPct = Math.round(rates?.completionRate ?? 0);
  const rating = me.data?.rating ?? dashboard.data?.rating ?? 0;
  const avgResponse = me.data?.avgResponseTime ?? 0;

  const earningsTrend = useMemo(
    () =>
      (earnings.data?.series ?? []).map((s) => ({
        date: s.date.slice(5),
        earnings: s.amount,
      })),
    [earnings.data],
  );

  const bookingsTrend = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const byDay = new Map<string, { bookings: number; completed: number }>();
    for (const b of bookings.data?.bookings ?? []) {
      const d = new Date(b.scheduledDate);
      if (d < cutoff) continue;
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key) ?? { bookings: 0, completed: 0 };
      row.bookings += 1;
      if (b.status === "completed") row.completed += 1;
      byDay.set(key, row);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  }, [bookings.data, days]);

  const topServices = useMemo(() => {
    const map = new Map<string, { bookings: number; earnings: number }>();
    for (const e of invoices.data?.earnings ?? []) {
      const row = map.get(e.service) ?? { bookings: 0, earnings: 0 };
      row.bookings += 1;
      row.earnings += e.net;
      map.set(e.service, row);
    }
    return Array.from(map.entries())
      .map(([service, v]) => ({ service, ...v }))
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, 8);
  }, [invoices.data]);

  const ratingTrend = earningsTrend.map((row) => ({
    date: row.date,
    rating: rating > 0 ? rating : 0,
  }));

  const acceptanceTrend = earningsTrend.map((row) => ({
    date: row.date,
    rate: acceptancePct,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["week", "month", "year"] as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={cn(
              "rounded-lg px-4 py-2 text-xs font-semibold capitalize transition",
              period === p
                ? "bg-partner-primary text-white"
                : "border border-partner-line text-partner-muted hover:text-partner-text",
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Acceptance rate"
          value={`${acceptancePct}%`}
          icon={ThumbsUp}
          loading={dashboard.isLoading}
        />
        <MetricCard
          label="Completion rate"
          value={`${completionPct}%`}
          icon={CheckCircle2}
          loading={dashboard.isLoading}
        />
        <MetricCard
          label="Customer rating"
          value={rating > 0 ? `${rating.toFixed(1)}/5` : "—"}
          icon={Star}
          loading={me.isLoading}
        />
        <MetricCard
          label="Avg response"
          value={avgResponse > 0 ? `${Math.round(avgResponse)}s` : "—"}
          icon={Clock}
          loading={me.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Earnings trend" loading={earnings.isLoading}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={earningsTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip formatter={(v) => formatInr(Number(v))} />
              <Line type="monotone" dataKey="earnings" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Bookings trend" loading={bookings.isLoading}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bookingsTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="bookings" fill="#3b82f6" name="Booked" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="completed" fill="#10b981" name="Completed" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Acceptance rate" loading={dashboard.isLoading}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={acceptanceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="rate" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Rating" loading={me.isLoading}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={ratingTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip />
              <Line type="monotone" dataKey="rating" stroke="#ec4899" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <PartnerCard className="overflow-x-auto">
        <h2 className="mb-4 font-display text-lg font-semibold">Top services</h2>
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-partner-line text-partner-muted">
              <th className="py-2 pr-4 font-medium">Service</th>
              <th className="py-2 pr-4 text-right font-medium">Jobs</th>
              <th className="py-2 text-right font-medium">Earnings</th>
            </tr>
          </thead>
          <tbody>
            {topServices.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-partner-muted">
                  No completed jobs yet.
                </td>
              </tr>
            ) : (
              topServices.map((s) => (
                <tr key={s.service} className="border-b border-partner-line/60 last:border-0">
                  <td className="py-3 pr-4">{s.service}</td>
                  <td className="py-3 pr-4 text-right">{formatNumber(s.bookings)}</td>
                  <td className="py-3 text-right font-semibold">{formatInr(s.earnings)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PartnerCard>

      <PartnerCard>
        <p className="text-sm font-semibold">Commission breakdown ({period})</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
          <Stat label="Gross" value={formatInr(earnings.data?.totalGross ?? 0, true)} />
          <Stat label="Commission" value={formatInr(earnings.data?.totalCommission ?? 0, true)} />
          <Stat label="Net" value={formatInr(earnings.data?.totalNet ?? 0, true)} />
        </div>
      </PartnerCard>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  icon: typeof Star;
  loading?: boolean;
}) {
  return (
    <PartnerCard className="!p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-partner-muted">{label}</p>
          <p className="font-display mt-1 text-2xl font-bold">{loading ? "—" : value}</p>
        </div>
        <Icon className="h-5 w-5 text-partner-primary" />
      </div>
    </PartnerCard>
  );
}

function ChartPanel({
  title,
  loading,
  children,
}: {
  title: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PartnerCard>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" /> : null}
      </div>
      {children}
    </PartnerCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-partner-line bg-partner-bg/60 p-3">
      <p className="text-partner-muted">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
