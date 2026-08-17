"use client";

import dynamic from "next/dynamic";
import { memo, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Loader2,
  MapPinned,
  Radio,
  RefreshCw,
  ShoppingBag,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { useAdminOpsMapQuery } from "@/hooks/use-admin-data";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { OPS_MAP_POLL_MS } from "@/lib/query-polling";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MapDOMIsolationBoundary } from "@/components/perf/MapDOMIsolationBoundary";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import type { OpsMapAlert, OpsMapData } from "@/services/admin-api";

const OpsLiveMap = dynamic(
  () => import("@/components/operations/OpsLiveMap").then((m) => m.OpsLiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="cmd-card cmd-map-frame ops-live-map grid place-items-center text-sm" style={{ color: "var(--cmd-muted)" }}>
        Loading live map…
      </div>
    ),
  },
);

function tidyZone(name: string) {
  return name
    .replace(/\b(polygon|geofence|smoke zone|ncr|zone)\b/gi, " ")
    .replace(/[—–_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || name;
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

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

const ALERT_META: Record<string, { label: string; icon: typeof WifiOff }> = {
  PROVIDER_OFFLINE: { label: "Provider offline", icon: WifiOff },
  BOOKING_DELAYED: { label: "Booking delayed", icon: Clock },
  ETA_BREACH: { label: "ETA breach", icon: AlertTriangle },
};

function AlertFeed({ alerts }: { alerts: OpsMapAlert[] }) {
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const sorted = [...alerts].sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));

  return (
    <aside className="biz-glass-panel ops-alert-board flex flex-col overflow-hidden p-5">
      <SectionHead
        icon={AlertTriangle}
        tone={critical ? "danger" : "warning"}
        title="Live Alerts"
        subtitle="Offline partners, delayed starts, ETA breaches"
        meta={`${alerts.length}`}
      />
      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {sorted.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-[var(--color-biz-line)] px-4 py-8 text-center text-sm text-[var(--color-biz-muted)]">
            No active operational alerts.
          </p>
        ) : (
          sorted.slice(0, 60).map((alert, i) => {
            const meta = ALERT_META[alert.type] ?? { label: alert.type.replace(/_/g, " "), icon: AlertTriangle };
            const Icon = meta.icon;
            return (
              <article
                key={`${alert.type}-${alert.bookingId ?? alert.providerId ?? i}`}
                className={cn("ops-alert", alert.severity === "critical" ? "ops-alert--critical" : "ops-alert--warning")}
              >
                <Icon3D icon={Icon} size="sm" tone={alert.severity === "critical" ? "danger" : "warning"} />
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{meta.label}</p>
                    <span className={cn("ops-alert-pill", alert.severity === "critical" ? "is-hot" : "is-warm")}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-[var(--color-biz-text)]">{alert.message}</p>
                  {alert.bookingId ? (
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-biz-muted)]">#{alert.bookingId.slice(-8)}</p>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

function OperationsPageInner() {
  useRenderProbe("OperationsPage");
  useMountProbe("OperationsPage");
  const q = useAdminOpsMapQuery(OPS_MAP_POLL_MS);
  const data = q.data as OpsMapData | undefined;

  const fleet = useMemo(() => {
    const providers = data?.providers ?? [];
    const online = providers.filter((p) => p.status === "ONLINE").length;
    const busy = providers.filter((p) => p.status === "BUSY").length;
    const offline = providers.filter((p) => p.status === "OFFLINE").length;
    const live = online + busy;
    return {
      online,
      busy,
      offline,
      live,
      total: providers.length,
      utilization: live ? busy / live : 0,
    };
  }, [data?.providers]);

  const bookingMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const booking of data?.bookings ?? []) {
      const key = (booking.status || "UNKNOWN").replace(/_/g, " ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count, share: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [data?.bookings]);

  const zones = useMemo(() => {
    const providers = data?.providers ?? [];
    const bookings = data?.bookings ?? [];
    const rows = (data?.geofences ?? []).map((zone) => {
      const center = { lat: zone.centerLat, lng: zone.centerLng };
      const radius = Math.max(zone.radiusMeters || 0, 1500);
      const inZone = (pt: { lat: number; lng: number }) => haversineM(center, pt) <= radius;
      const supply = providers.filter((p) => inZone(p)).length;
      const jobs = bookings.filter((b) => inZone(b)).length;
      return {
        id: zone.id,
        name: tidyZone(zone.name),
        supply,
        jobs,
        heat: jobs >= 8 || (jobs > 0 && supply === 0) ? "hot" : jobs >= 3 ? "warm" : "good",
      };
    });
    const maxJobs = Math.max(1, ...rows.map((z) => z.jobs));
    return rows
      .map((z) => ({ ...z, share: Math.round((z.jobs / maxJobs) * 100) }))
      .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));
  }, [data?.geofences, data?.providers, data?.bookings]);

  const etaTone =
    (data?.metrics.averageEtaMin ?? 0) >= 45 ? "danger" : (data?.metrics.averageEtaMin ?? 0) >= 25 ? "accent" : "success";

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Radio} tone="success" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Live Operations</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Real-time city command — partners, bookings, and service gaps · auto-refresh 60s
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void q.refetch()} className="biz-btn">
          <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading live operations…
        </div>
      ) : q.isError || !data ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-5 text-[var(--color-biz-danger)]">
          Could not load the operations map. Please try again.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label="Online providers"
              value={formatNumber(data.metrics.onlineProviders)}
              sub={`${formatNumber(fleet.online)} idle · ${formatNumber(fleet.total)} located`}
              icon={Wifi}
              tone="success"
            />
            <StatTile
              label="Busy"
              value={formatNumber(data.metrics.busyProviders)}
              sub={`${formatPercent(fleet.utilization)} of live fleet`}
              icon={Activity}
              tone={fleet.utilization > 0.85 ? "danger" : "accent"}
            />
            <StatTile
              label="Active bookings"
              value={formatNumber(data.metrics.activeBookings)}
              sub={`${formatNumber(data.alerts.length)} alerts in queue`}
              icon={ShoppingBag}
              tone="accent"
            />
            <StatTile
              label="Avg ETA"
              value={`${data.metrics.averageEtaMin}m`}
              sub="Across live jobs"
              icon={Clock}
              tone={etaTone}
            />
            <StatTile
              label="Service gaps"
              value={formatNumber(data.metrics.serviceGaps)}
              sub="Demand cells without supply"
              icon={AlertTriangle}
              tone={data.metrics.serviceGaps > 0 ? "danger" : "success"}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <MapPerformanceBoundary label="OpsLiveMap" className="ops-live-stage" deferAfterPaint rootMargin="0px">
              <MapDOMIsolationBoundary label="OpsLiveMap" className="flex h-full min-h-0 w-full">
                <OpsLiveMap data={data} />
              </MapDOMIsolationBoundary>
            </MapPerformanceBoundary>
            <AlertFeed alerts={data.alerts} />
          </section>

          <section className="grid items-stretch gap-4 lg:grid-cols-3">
            <div className="biz-glass-panel flex flex-col p-6">
              <SectionHead icon={Users} tone="success" title="Fleet mix" meta={`${formatNumber(fleet.total)} located`} />
              <div className="space-y-4">
                {[
                  { label: "Idle online", value: fleet.online, tone: "biz-meter--success" },
                  { label: "On job", value: fleet.busy, tone: "biz-meter--warning" },
                  { label: "Offline", value: fleet.offline, tone: "" },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-[var(--color-biz-muted)]">{row.label}</span>
                      <span data-stat-value className="font-bold tabular-nums">
                        {formatNumber(row.value)}
                      </span>
                    </div>
                    <div className={cn("biz-meter", row.tone)}>
                      <span style={{ width: `${Math.max(row.value ? 8 : 0, Math.round((row.value / Math.max(fleet.total, 1)) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="biz-glass-panel flex flex-col p-6">
              <SectionHead icon={ShoppingBag} tone="cyan" title="Job pipeline" meta={`${formatNumber(data.metrics.activeBookings)} live`} />
              {bookingMix.length ? (
                <div className="space-y-3">
                  {bookingMix.map((row) => (
                    <div key={row.status}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate capitalize text-[var(--color-biz-muted)]">{row.status.toLowerCase()}</span>
                        <span data-stat-value className="font-bold tabular-nums">
                          {formatNumber(row.count)}
                        </span>
                      </div>
                      <div className="biz-meter biz-meter--success">
                        <span style={{ width: `${Math.max(8, row.share)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No active jobs on the board.</p>
              )}
            </div>

            <div className="biz-glass-panel flex flex-col p-6">
              <SectionHead
                icon={AlertTriangle}
                tone={data.metrics.serviceGaps > 0 ? "danger" : "success"}
                title="Service health"
                meta={`${formatPercent(fleet.utilization)} busy`}
              />
              <MetricRow
                label="Fleet utilization"
                value={formatPercent(fleet.utilization)}
                heat={fleet.utilization > 0.85 ? "bad" : fleet.utilization > 0.6 ? "warn" : "good"}
              />
              <MetricRow
                label="Critical alerts"
                value={formatNumber(data.alerts.filter((a) => a.severity === "critical").length)}
                heat={data.alerts.some((a) => a.severity === "critical") ? "bad" : "good"}
              />
              <MetricRow
                label="Service gaps"
                value={formatNumber(data.metrics.serviceGaps)}
                heat={data.metrics.serviceGaps > 0 ? "bad" : "good"}
              />
              <MetricRow label="Average ETA" value={`${data.metrics.averageEtaMin} min`} heat={data.metrics.averageEtaMin >= 45 ? "bad" : data.metrics.averageEtaMin >= 25 ? "warn" : "good"} />
              <div className={cn("biz-meter mt-4", fleet.utilization > 0.85 ? "biz-meter--danger" : "biz-meter--success")}>
                <span style={{ width: `${Math.max(8, Math.round(fleet.utilization * 100))}%` }} />
              </div>
            </div>
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead
              icon={MapPinned}
              tone="success"
              title="Coverage"
              subtitle="Every live zone — partners on the ground vs jobs in flight"
              meta={`${zones.length} zones`}
            />
            {zones.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {zones.map((zone) => (
                  <article key={zone.id} className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold tracking-tight">{zone.name}</h3>
                      <span className={cn("ops-alert-pill", zone.heat === "hot" ? "is-hot" : zone.heat === "warm" ? "is-warm" : "is-good")}>
                        {zone.heat === "hot" ? "Pressure" : zone.heat === "warm" ? "Busy" : "Stable"}
                      </span>
                    </div>
                    <p data-stat-value className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
                      {formatNumber(zone.jobs)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                      {formatNumber(zone.supply)} partners in zone
                    </p>
                    <div className={cn("biz-meter mt-3", zone.heat === "hot" ? "biz-meter--danger" : zone.heat === "warm" ? "biz-meter--warning" : "biz-meter--success")}>
                      <span style={{ width: `${Math.max(zone.jobs ? 8 : 0, zone.share)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">No active geofences yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default memo(OperationsPageInner);
