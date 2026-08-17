"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  MapPin,
  Radio,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { adminApi, type WorkforceAnalytics } from "@/services/admin-api";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

function MetricRow({ label, value, heat }: { label: string; value: string; heat?: "good" | "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-biz-line)] py-2.5 last:border-0">
      <span className="text-sm text-[var(--color-biz-muted)]">{label}</span>
      <span
        data-stat-value
        className={cn(
          "text-sm font-bold tabular-nums",
          heat === "good" && "text-[var(--color-biz-success)]",
          heat === "warn" && "text-[var(--color-biz-warning)]",
          heat === "bad" && "text-[var(--color-biz-danger)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function heatForRate(pct: number): "good" | "warn" | "bad" {
  if (pct >= 70) return "good";
  if (pct >= 40) return "warn";
  return "bad";
}

export default function WorkforcePage() {
  const analytics = useQuery({
    queryKey: ["admin", "workforce"],
    queryFn: () => adminApi.workforceAnalytics(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const data = analytics.data as WorkforceAnalytics | undefined;
  const onlineRate = data && data.totalProviders > 0 ? data.onlineProviders / data.totalProviders : 0;
  const checkInRate = data && data.totalProviders > 0 ? data.attendanceCheckInsToday / data.totalProviders : 0;

  const attendanceSeries = useMemo(
    () => (data?.checkInsByDay ?? []).map((row) => ({ label: dayLabel(row.date), value: row.count })),
    [data?.checkInsByDay],
  );
  const hourlySeries = useMemo(
    () => (data?.checkInsByHour ?? []).map((row) => ({ label: `${String(row.hour).padStart(2, "0")}h`, value: row.count })),
    [data?.checkInsByHour],
  );
  const fleetSeries = useMemo(
    () => [
      { label: "Idle online", value: data?.idleOnline ?? 0 },
      { label: "On job", value: data?.busyProviders ?? 0 },
      { label: "Offline", value: data?.offlineProviders ?? 0 },
    ],
    [data?.idleOnline, data?.busyProviders, data?.offlineProviders],
  );
  const jobSeries = useMemo(
    () =>
      (data?.jobsByStatus ?? []).map((row) => ({
        label: row.status.replace(/_/g, " ").toLowerCase(),
        value: row.count,
      })),
    [data?.jobsByStatus],
  );
  const cityMax = Math.max(1, ...(data?.cities ?? []).map((c) => c.count));

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Users} tone="success" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Workforce Analytics</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Partner OS — attendance, live roster, and performance · auto-refresh 60s
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void analytics.refetch()} className="biz-btn">
          <RefreshCw size={14} className={analytics.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {analytics.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading workforce analytics…
        </div>
      ) : analytics.isError || !data ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-5 text-[var(--color-biz-danger)]">
          Could not load workforce analytics. Please try again.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Online partners"
              value={formatNumber(data.onlineProviders)}
              sub={`${formatPercent(onlineRate)} of ${formatNumber(data.totalProviders)} roster`}
              icon={Radio}
              tone="success"
            />
            <StatTile
              label="On job"
              value={formatNumber(data.busyProviders)}
              sub={`${formatNumber(data.idleOnline)} idle online`}
              icon={Activity}
              tone={data.busyProviders > 0 ? "accent" : "default"}
            />
            <StatTile
              label="Active jobs"
              value={formatNumber(data.activeJobs)}
              sub={`${formatNumber(data.openSessions)} open check-in sessions`}
              icon={ClipboardCheck}
              tone="accent"
            />
            <StatTile
              label="Check-ins today"
              value={formatNumber(data.attendanceCheckInsToday)}
              sub={`${formatPercent(checkInRate)} of roster`}
              icon={UserCheck}
              tone={data.attendanceCheckInsToday > 0 ? "success" : "default"}
            />
            <StatTile
              label="Avg acceptance"
              value={`${data.avgAcceptanceRate.toFixed(1)}%`}
              sub="Across approved partners"
              icon={TrendingUp}
              tone={data.avgAcceptanceRate >= 70 ? "success" : data.avgAcceptanceRate >= 40 ? "accent" : "danger"}
            />
            <StatTile
              label="Avg completion"
              value={`${data.avgCompletionRate.toFixed(1)}%`}
              sub={`${data.avgRating.toFixed(1)} avg rating`}
              icon={CheckCircle2}
              tone={data.avgCompletionRate >= 70 ? "success" : data.avgCompletionRate >= 40 ? "accent" : "danger"}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel p-6">
              <SectionHead
                icon={UserCheck}
                tone="success"
                title="Attendance trend"
                subtitle="Partner check-ins over the last 14 days"
                meta="14 days"
              />
              <IsoBarChart
                data={attendanceSeries}
                format={formatNumber}
                accent="emerald"
                layout="area"
                height={280}
                isLoading={analytics.isFetching && attendanceSeries.length === 0}
              />
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead
                icon={Clock}
                tone="cyan"
                title="Check-ins today"
                subtitle="Live hourly attendance since midnight"
                meta="Today"
              />
              <IsoBarChart
                data={hourlySeries}
                format={formatNumber}
                accent="blue"
                layout="column"
                height={280}
                isLoading={analytics.isFetching && hourlySeries.length === 0}
              />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Users} tone="success" title="Fleet mix" meta={`${formatNumber(data.totalProviders)} roster`} />
              <IsoBarChart data={fleetSeries} format={formatNumber} accent="emerald" layout="bar" height={160} />
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={ClipboardCheck} tone="cyan" title="Job pipeline" meta={`${formatNumber(data.activeJobs)} live`} />
              {jobSeries.length ? (
                <IsoBarChart data={jobSeries} format={formatNumber} accent="amber" layout="bar" height={160} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No active jobs on the board.</p>
              )}
            </div>
            <div className="biz-glass-panel flex flex-col p-6">
              <SectionHead icon={CheckCircle2} tone="warning" title="Performance health" meta={`${data.avgRating.toFixed(1)} ★`} />
              <GlassRing3D
                value={data.avgCompletionRate}
                label="Complete"
                sub={`${data.avgAcceptanceRate.toFixed(1)}% acceptance · ${data.avgOnTimeRate.toFixed(1)}% on-time`}
                tone={data.avgCompletionRate >= 70 ? "success" : data.avgCompletionRate >= 40 ? "warning" : "danger"}
              />
              <div className="mt-2">
                <MetricRow label="Acceptance" value={`${data.avgAcceptanceRate.toFixed(1)}%`} heat={heatForRate(data.avgAcceptanceRate)} />
                <MetricRow label="On-time" value={`${data.avgOnTimeRate.toFixed(1)}%`} heat={heatForRate(data.avgOnTimeRate)} />
                <MetricRow
                  label="Cancellation"
                  value={`${data.avgCancellationRate.toFixed(1)}%`}
                  heat={data.avgCancellationRate > 20 ? "bad" : data.avgCancellationRate > 10 ? "warn" : "good"}
                />
              </div>
            </div>
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead
              icon={TrendingUp}
              tone="success"
              title="Top partners"
              subtitle="Highest completion rate on the live roster"
              meta={`${data.topPartners.length} shown`}
            />
            {data.topPartners.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.topPartners.map((partner) => (
                  <article key={partner.id} className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-sm font-bold tracking-tight">{partner.name}</h3>
                      <span className={cn("ops-alert-pill", partner.online ? "is-good" : "is-warm")}>
                        {partner.online ? "Online" : "Offline"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{partner.city || "Unassigned"}</p>
                    <p data-stat-value className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
                      {partner.completionRate.toFixed(0)}%
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                      {formatNumber(partner.completedBookings)} jobs · {partner.rating.toFixed(1)} ★
                    </p>
                    <div className={cn("biz-meter mt-3", partner.completionRate >= 70 ? "biz-meter--success" : "biz-meter--warning")}>
                      <span style={{ width: `${Math.max(8, Math.min(100, partner.completionRate))}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">No approved partners yet.</p>
            )}
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead
              icon={MapPin}
              tone="cyan"
              title="Cities"
              subtitle="Approved partners on the roster by city"
              meta={`${data.cities.length} cities`}
            />
            {data.cities.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.cities.map((city) => (
                  <article key={city.city} className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold tracking-tight">{city.city}</h3>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-biz-muted)]">
                        Roster
                      </span>
                    </div>
                    <p data-stat-value className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
                      {formatNumber(city.count)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">partners</p>
                    <div className="biz-meter biz-meter--success mt-3">
                      <span style={{ width: `${Math.max(city.count ? 8 : 0, Math.round((city.count / cityMax) * 100))}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">No city coverage on the roster yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
