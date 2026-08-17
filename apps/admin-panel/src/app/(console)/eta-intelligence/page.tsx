"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { adminApi } from "@/services/admin-api";
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

export default function EtaIntelligencePage() {
  const dashboard = useQuery({
    queryKey: ["eta-dashboard"],
    queryFn: () => adminApi.etaIntelligence.dashboard(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const quality = useQuery({
    queryKey: ["eta-quality"],
    queryFn: () => adminApi.etaIntelligence.quality(),
    staleTime: 60_000,
  });
  const readiness = useQuery({
    queryKey: ["eta-readiness"],
    queryFn: () => adminApi.etaIntelligence.readiness(),
    staleTime: 60_000,
  });
  const google = useQuery({
    queryKey: ["eta-google"],
    queryFn: () => adminApi.etaIntelligence.google(),
    staleTime: 60_000,
  });
  const trips = useQuery({
    queryKey: ["eta-trips"],
    queryFn: () => adminApi.etaIntelligence.trips(25),
    staleTime: 30_000,
  });
  const geofences = useQuery({
    queryKey: ["eta-geofence-cities"],
    queryFn: () => adminApi.geofences.list({ activeOnly: true }),
    staleTime: 120_000,
  });

  const d = dashboard.data as Record<string, unknown> | undefined;
  const q = quality.data as Record<string, unknown> | undefined;
  const r = readiness.data as Record<string, unknown> | undefined;
  const g = google.data as Record<string, unknown> | undefined;
  const labeled = (d?.cities as Array<{ city: string; count: number }>) ?? [];

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fence of geofences.data ?? []) {
      const city = fence.city?.trim();
      if (city && !counts.has(city)) counts.set(city, 0);
    }
    for (const row of labeled) {
      const city = row.city?.trim() || "Unknown";
      counts.set(city, (counts.get(city) ?? 0) + row.count);
    }
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()]
      .map(([city, count]) => ({ city, count, share: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  }, [geofences.data, labeled]);

  const tripRows = useMemo(
    () =>
      ((trips.data?.trips as Array<Record<string, unknown>>) ?? []).map((t) => [
        <span key={`b-${String(t.bookingId)}`} className="font-mono text-xs">
          {String(t.bookingId).slice(0, 10)}…
        </span>,
        String(t.city ?? "—"),
        <StatusBadge key={`s-${String(t.bookingId)}`} status={String(t.status ?? "").toLowerCase()} />,
        `${Number(t.qualityScore ?? 0).toFixed(0)}%`,
        t.actualTravelDurationMin != null ? `${Number(t.actualTravelDurationMin)} min` : "—",
        t.googleEtaMinutes != null ? `${Number(t.googleEtaMinutes)} min` : "—",
        t.gapMinutes != null ? (
          <span
            key={`g-${String(t.bookingId)}`}
            className={Number(t.gapMinutes) > 5 ? "font-semibold text-[var(--color-biz-warning)]" : ""}
          >
            {Number(t.gapMinutes) > 0 ? "+" : ""}
            {Number(t.gapMinutes).toFixed(1)} min
          </span>
        ) : (
          "—"
        ),
      ]),
    [trips.data],
  );

  const readinessPct = Math.min(100, Number(r?.readinessPct ?? 0));
  const qualityPct = Number(d?.avgQualityScore ?? 100);
  const failRate = Number(g?.failureRate ?? 0);
  const rejections = (q?.rejectionReasons as Array<{ reason: string; count: number }>) ?? [];

  const refresh = () => {
    void dashboard.refetch();
    void quality.refetch();
    void readiness.refetch();
    void google.refetch();
    void trips.refetch();
  };

  return (
    <div className="exec-hq mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Navigation} tone="cyan" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">ETA Intelligence</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Labels
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Google vs actual travel time — label collection only, no ML inference
            </p>
          </div>
        </div>
        <button type="button" onClick={refresh} className="biz-btn">
          <RefreshCw size={14} className={dashboard.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {dashboard.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading ETA intelligence…
        </div>
      ) : dashboard.isError ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-5 text-[var(--color-biz-danger)]">
          Failed to load ETA dashboard. Please try again.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Trips Collected"
              value={formatNumber(Number(d?.tripsCollected ?? 0))}
              sub={`${formatNumber(Number(d?.labelsToday ?? 0))} today`}
              icon={Database}
              tone="accent"
            />
            <StatTile
              label="Training Ready"
              value={formatNumber(Number(d?.trainingReady ?? 0))}
              sub={`${formatPercent(Number(r?.readinessPct ?? 0) / 100)} of min threshold`}
              icon={CheckCircle2}
              tone={Number(d?.trainingReady ?? 0) > 0 ? "success" : "default"}
            />
            <StatTile
              label="Label Quality"
              value={`${qualityPct.toFixed(1)}%`}
              sub={`${formatNumber(Number(d?.rejected ?? 0))} rejected`}
              icon={Target}
              tone={qualityPct >= 80 ? "success" : qualityPct >= 60 ? "accent" : "danger"}
            />
            <StatTile
              label="Google vs Actual"
              value={d?.avgGapMinutes != null ? `${Number(d.avgGapMinutes).toFixed(1)} min` : "—"}
              sub="Average prediction gap"
              icon={TrendingUp}
              tone={d?.avgGapMinutes != null && Math.abs(Number(d.avgGapMinutes)) > 5 ? "danger" : "success"}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Activity} tone="success" title="Training Readiness" meta={`${readinessPct.toFixed(0)}%`} />
              <MetricRow label="Training ready" value={formatNumber(Number(r?.trainingReady ?? 0))} heat="good" />
              <MetricRow label="Validated" value={formatNumber(Number(r?.validated ?? 0))} />
              <MetricRow label="Raw" value={formatNumber(Number(r?.raw ?? 0))} />
              <MetricRow label="Min for training" value={formatNumber(Number(r?.minLabelsForTraining ?? 50))} />
              <div className="biz-meter biz-meter--success mt-4">
                <span style={{ width: `${readinessPct}%` }} />
              </div>
            </div>

            <div className="biz-glass-panel p-6">
              <SectionHead icon={Navigation} tone="cyan" title="Google Maps Capture" />
              <MetricRow label="Snapshots" value={formatNumber(Number(g?.snapshotCount ?? 0))} />
              <MetricRow label="Avg latency" value={`${Number(g?.avgLatencyMs ?? 0)} ms`} />
              <MetricRow
                label="Failure rate"
                value={`${failRate.toFixed(1)}%`}
                heat={failRate > 5 ? "warn" : "good"}
              />
            </div>

            <div className="biz-glass-panel p-6">
              <SectionHead icon={Clock} tone="warning" title="Data Freshness" />
              <MetricRow
                label="Last label"
                value={d?.freshnessMinutes != null ? `${Number(d.freshnessMinutes)} min ago` : "—"}
              />
              <MetricRow
                label="Overall quality"
                value={`${Number(q?.overallScore ?? 100).toFixed(1)}%`}
                heat={Number(q?.overallScore ?? 100) >= 80 ? "good" : "warn"}
              />
            </div>
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead
              icon={MapPin}
              tone="success"
              title="Cities"
              subtitle="Every live city on the platform — trip labels collected vs coverage"
              meta={`${cities.length} cities`}
            />
            {cities.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cities.map((c) => (
                  <article key={c.city} className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold tracking-tight">{c.city}</h3>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-biz-muted)]">
                        {c.count ? "Active" : "No labels"}
                      </span>
                    </div>
                    <p data-stat-value className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
                      {formatNumber(c.count)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">trips collected</p>
                    <div className={cn("biz-meter mt-3", c.count ? "biz-meter--success" : "")}>
                      <span style={{ width: `${Math.max(c.count ? 8 : 0, c.share)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">No city coverage yet.</p>
            )}
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead icon={Database} tone="default" title="Recent Trips" meta="Latest 25 labels" />
            <DataTable
              flush
              headers={["Booking", "City", "Status", "Quality", "Actual", "Google", "Gap"]}
              rows={tripRows}
              isLoading={trips.isLoading}
              isError={trips.isError}
              emptyMessage="No ETA labels collected yet. Labels are created when bookings complete."
              onRetry={() => void trips.refetch()}
            />
          </section>

          {rejections.length > 0 ? (
            <section className="biz-glass-panel p-6">
              <SectionHead icon={XCircle} tone="warning" title="Quality Rejections" />
              <div className="flex flex-wrap gap-2">
                {rejections.map((item) => (
                  <span
                    key={item.reason}
                    className="rounded-full border border-[var(--color-biz-warning)]/25 bg-[var(--color-biz-warning)]/10 px-3 py-1.5 text-sm font-semibold text-[var(--color-biz-warning)]"
                  >
                    {item.reason.replace(/_/g, " ")} · {item.count}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
