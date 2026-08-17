"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Flame,
  Globe2,
  Hexagon,
  IndianRupee,
  Loader2,
  MapPinned,
  Radio,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { DataTable } from "@/components/ui/DataTable";
import { MapDOMIsolationBoundary } from "@/components/perf/MapDOMIsolationBoundary";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import { adminApi, type ZoneAnalyticsRow } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

const GeospatialMap = dynamic(
  () => import("@/components/geo/GeospatialMap").then((m) => m.GeospatialMap),
  {
    ssr: false,
    loading: () => (
      <div className="cmd-card cmd-map-frame geo-map-frame grid place-items-center text-sm" style={{ color: "var(--cmd-muted)" }}>
        Loading geo map…
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

function utilHeat(u: number): "good" | "warn" | "bad" {
  if (u >= 70) return "good";
  if (u >= 40) return "warn";
  return "bad";
}

export default function GeospatialPage() {
  const qc = useQueryClient();
  const zonesQ = useQuery({
    queryKey: ["geo-zones"],
    queryFn: () => adminApi.geofences.list({}),
    staleTime: 60_000,
  });
  const analyticsQ = useQuery({
    queryKey: ["geo-zone-analytics"],
    queryFn: () => adminApi.zoneAnalytics(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.geofences.create>[0]) => adminApi.geofences.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["geo-zones"] });
      void qc.invalidateQueries({ queryKey: ["geo-zone-analytics"] });
    },
  });

  const zones = zonesQ.data ?? [];
  const analytics = analyticsQ.data;
  const zoneRows = analytics?.zones ?? [];

  const onDraw = useCallback(
    (d: {
      shape: "CIRCLE" | "POLYGON";
      centerLat: number;
      centerLng: number;
      radiusMeters: number;
      polygon?: Array<{ lat: number; lng: number }>;
    }) => {
      const name = window.prompt(`Name this ${d.shape.toLowerCase()} zone:`);
      if (!name?.trim()) return;
      create.mutate({
        name: name.trim(),
        zoneType: "SERVICE_ZONE",
        shape: d.shape,
        centerLat: d.centerLat,
        centerLng: d.centerLng,
        radiusMeters: d.radiusMeters,
        ...(d.shape === "POLYGON" ? { polygon: d.polygon } : {}),
      });
    },
    [create],
  );

  const revenueSeries = useMemo(
    () =>
      [...zoneRows]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
        .map((z) => ({ label: tidyZone(z.name).slice(0, 12), value: z.revenue })),
    [zoneRows],
  );
  const demandSeries = useMemo(
    () =>
      [...zoneRows]
        .sort((a, b) => b.demand - a.demand)
        .slice(0, 8)
        .map((z) => ({ label: tidyZone(z.name).slice(0, 12), value: z.demand })),
    [zoneRows],
  );

  const topZones = useMemo(() => {
    const maxRev = Math.max(1, ...zoneRows.map((z) => z.revenue));
    return [...zoneRows]
      .sort((a, b) => b.revenue - a.revenue || b.demand - a.demand)
      .slice(0, 6)
      .map((z) => ({ ...z, share: Math.round((z.revenue / maxRev) * 100) }));
  }, [zoneRows]);

  const tableRows = useMemo(
    () =>
      zoneRows.map((z: ZoneAnalyticsRow) => [
        <span key={`n-${z.id}`} className="font-medium">
          {tidyZone(z.name)}
          {z.city ? <span className="ml-1 text-xs text-[var(--color-biz-muted)]">{z.city}</span> : null}
        </span>,
        <span
          key={`s-${z.id}`}
          className={cn(
            "ops-alert-pill",
            z.shape === "POLYGON" ? "is-warm" : "is-good",
          )}
        >
          {z.shape}
        </span>,
        `×${z.surgeMultiplier.toFixed(2)}`,
        formatNumber(z.supply),
        formatNumber(z.demand),
        <span
          key={`u-${z.id}`}
          className={cn(
            "font-semibold tabular-nums",
            utilHeat(z.utilization) === "good" && "text-[var(--color-biz-success)]",
            utilHeat(z.utilization) === "warn" && "text-[var(--color-biz-warning)]",
            utilHeat(z.utilization) === "bad" && "text-[var(--color-biz-danger)]",
          )}
        >
          {z.utilization}%
        </span>,
        inr(z.revenue, true),
      ]),
    [zoneRows],
  );

  const refresh = () => {
    void zonesQ.refetch();
    void analyticsQ.refetch();
  };

  const totals = analytics?.totals;
  const avgUtil =
    zoneRows.length > 0 ? Math.round(zoneRows.reduce((s, z) => s + z.utilization, 0) / zoneRows.length) : 0;

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Globe2} tone="cyan" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Geo Command</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              NCR-focused geospatial command — live zones, supply, demand · draw circle or polygon geofences on the map
            </p>
          </div>
        </div>
        <button type="button" onClick={refresh} className="biz-btn">
          <RefreshCw size={14} className={analyticsQ.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {zonesQ.isLoading && analyticsQ.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading geospatial command…
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Active providers"
              value={totals ? formatNumber(totals.supply) : "—"}
              sub="Supply across all zones"
              icon={Radio}
              tone="success"
            />
            <StatTile
              label="Live demand"
              value={totals ? formatNumber(totals.demand) : "—"}
              sub="24h booking signals"
              icon={Users}
              tone={totals && totals.demand > 0 ? "accent" : "default"}
            />
            <StatTile
              label="Service zones"
              value={formatNumber(totals?.zones ?? zones.length)}
              sub={`${avgUtil}% avg utilization`}
              icon={MapPinned}
              tone="accent"
            />
            <StatTile
              label="Zone revenue"
              value={totals ? inr(totals.revenue, true) : "—"}
              sub="Last 24 hours"
              icon={IndianRupee}
              tone={totals && totals.revenue > 0 ? "success" : "default"}
            />
          </section>

          <section className="geo-live-stage">
            <MapPerformanceBoundary label="GeospatialMap" className="h-full min-h-0 w-full" deferAfterPaint rootMargin="80px">
              <MapDOMIsolationBoundary label="GeospatialMap" className="flex h-full min-h-0 w-full">
                <GeospatialMap zones={zones} onDraw={onDraw} className="h-full w-full" />
              </MapDOMIsolationBoundary>
            </MapPerformanceBoundary>
            {create.isPending ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-[var(--color-biz-muted)]">
                <Loader2 className="animate-spin" size={13} /> Creating zone…
              </p>
            ) : null}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel p-6">
              <SectionHead
                icon={IndianRupee}
                tone="success"
                title="Revenue by zone"
                subtitle="Top earning service zones in the last 24 hours"
                meta="24h"
              />
              {revenueSeries.length ? (
                <IsoBarChart data={revenueSeries} format={(v) => inr(v, true)} accent="emerald" layout="column" height={260} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No zone revenue yet.</p>
              )}
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead
                icon={Flame}
                tone="warning"
                title="Demand by zone"
                subtitle="Live booking demand across mapped geofences"
                meta="24h"
              />
              {demandSeries.length ? (
                <IsoBarChart data={demandSeries} format={formatNumber} accent="amber" layout="area" height={260} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No demand signals yet.</p>
              )}
            </div>
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead
              icon={TrendingUp}
              tone="cyan"
              title="Zone performance"
              subtitle="Supply, demand, and utilization at a glance"
              meta={`${zoneRows.length} zones`}
            />
            {topZones.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topZones.map((zone) => (
                  <article key={zone.id} className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold tracking-tight">{tidyZone(zone.name)}</h3>
                        <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">{zone.city ?? "Unassigned"}</p>
                      </div>
                      <span className={cn("ops-alert-pill", zone.shape === "POLYGON" ? "is-warm" : "is-good")}>
                        {zone.shape === "POLYGON" ? <Hexagon size={10} className="inline" /> : null}
                        {zone.shape}
                      </span>
                    </div>
                    <p data-stat-value className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
                      {inr(zone.revenue, true)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                      {formatNumber(zone.supply)} supply · {formatNumber(zone.demand)} demand · {zone.utilization}% util
                    </p>
                    <div className={cn("biz-meter mt-3", utilHeat(zone.utilization) === "good" ? "biz-meter--success" : utilHeat(zone.utilization) === "warn" ? "biz-meter--warning" : "biz-meter--danger")}>
                      <span style={{ width: `${Math.max(zone.revenue ? 8 : 0, zone.share)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">Draw a zone on the map to begin tracking performance.</p>
            )}
          </section>

          <section className="biz-glass-panel p-6">
            <SectionHead icon={MapPinned} tone="success" title="Zone registry" meta={`${zoneRows.length} active`} />
            <DataTable
              flush
              headers={["Zone", "Shape", "Surge", "Supply", "Demand", "Util.", "Revenue 24h"]}
              rows={tableRows}
              isLoading={analyticsQ.isLoading}
              isError={analyticsQ.isError}
              emptyMessage="No zone analytics yet. Create a geofence on the map above."
              onRetry={() => void analyticsQ.refetch()}
            />
          </section>
        </>
      )}
    </div>
  );
}
