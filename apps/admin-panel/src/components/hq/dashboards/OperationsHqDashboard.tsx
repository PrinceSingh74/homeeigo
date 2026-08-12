"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Minimize2, Radio, AlertTriangle, Clock, Users, Activity, IndianRupee } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading } from "../primitives";
import { COMMAND_KPI_POLL_MS, OPS_MAP_POLL_MS } from "@/lib/query-polling";
import { cn } from "@/lib/cn";

export function OperationsHqDashboard() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const kpis = useQuery({
    queryKey: ["hq", "ops", "exec-kpis"],
    queryFn: () => adminApi.geoIntel.execKpis(),
    staleTime: 30_000,
    refetchInterval: COMMAND_KPI_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const opsMap = useQuery({
    queryKey: ["hq", "ops", "ops-map"],
    queryFn: () => adminApi.opsMap(),
    staleTime: 30_000,
    refetchInterval: OPS_MAP_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const k = kpis.data?.data;
  const metrics = opsMap.data?.metrics;
  const alerts = useMemo(() => opsMap.data?.alerts ?? [], [opsMap.data]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen((v) => !v);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      data-fullscreen={isFullscreen ? "true" : undefined}
      className={cn(
        "space-y-6",
        isFullscreen && "biz-wallscreen overflow-y-auto bg-[var(--color-biz-bg)] p-8",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-biz-muted)]">
            Mission Control — Live
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-biz-muted)] transition hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]"
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {isFullscreen ? "Exit wall-screen" : "Wall-screen mode"}
        </button>
      </div>

      <section
        className={cn(
          "grid gap-3",
          isFullscreen ? "grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        <StatTile label="GMV Today" value={k ? inr(k.gmv, true) : "—"} icon={IndianRupee} loading={kpis.isLoading} tone="accent" />
        <StatTile label="Bookings Today" value={k ? formatNumber(k.bookingsToday) : "—"} icon={Activity} loading={kpis.isLoading} />
        <StatTile label="Completion" value={k ? `${(k.completionRate * (k.completionRate <= 1 ? 100 : 1)).toFixed(0)}%` : "—"} loading={kpis.isLoading} tone="success" />
        <StatTile label="Online Partners" value={k ? formatNumber(k.onlineProviders) : "—"} sub={k ? `${formatNumber(k.activeCustomers)} active customers` : undefined} icon={Users} loading={kpis.isLoading} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active Bookings" value={metrics ? formatNumber(metrics.activeBookings) : "—"} icon={Radio} loading={opsMap.isLoading} />
        <StatTile label="Busy Partners" value={metrics ? formatNumber(metrics.busyProviders) : "—"} loading={opsMap.isLoading} />
        <StatTile label="Avg ETA" value={metrics ? `${Math.round(metrics.averageEtaMin)}m` : "—"} icon={Clock} loading={opsMap.isLoading} />
        <StatTile label="Service Gaps" value={metrics ? formatNumber(metrics.serviceGaps) : "—"} icon={AlertTriangle} tone={(metrics?.serviceGaps ?? 0) > 0 ? "danger" : "success"} loading={opsMap.isLoading} />
      </section>

      <GlassPanel glow="red" className="p-5">
        <SectionHeading title="Live Alert Feed" hint={`${alerts.length} active`} />
        {opsMap.isLoading ? (
          <div className="biz-skeleton h-24 w-full rounded" />
        ) : alerts.length > 0 ? (
          <div className="space-y-1.5">
            {alerts.slice(0, isFullscreen ? 20 : 8).map((a, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-xs",
                  a.severity === "critical"
                    ? "border-red-500 bg-red-500/5"
                    : "border-amber-500 bg-amber-500/5",
                )}
              >
                <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", a.severity === "critical" ? "text-red-400" : "text-amber-400")} />
                <span className="font-medium uppercase tracking-wide text-[10px] text-[var(--color-biz-muted)]">{a.type}</span>
                <span className="min-w-0 flex-1 truncate">{a.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[var(--color-biz-success)]">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            All clear — no active operational alerts.
          </div>
        )}
      </GlassPanel>

      {!k && !kpis.isLoading ? (
        <DataUnavailable title="KPIs unavailable" reason="Geo-intel exec KPIs returned no data." />
      ) : null}
    </div>
  );
}
