"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useQuery } from "@tanstack/react-query";
import { Layers, Users, Flame, IndianRupee, Zap, ShieldAlert, Hexagon, Car, CloudRain, Gauge } from "lucide-react";
import { Icon3D } from "@/components/hq/Icon3D";
import { adminApi } from "@/services/admin-api";
import {
  COMMAND_DEMAND_POLL_MS,
  COMMAND_GEO_POLL_MS,
  COMMAND_KPI_POLL_MS,
  COMMAND_REVENUE_POLL_MS,
} from "@/lib/query-polling";
import type { CmdZone, LayerKey, FraudPin } from "@/components/command/CommandMap";
import { ExecutiveKpiRibbon } from "@/components/command/ExecutiveKpiRibbon";
import { AiIntelligencePanel } from "@/components/command/AiIntelligencePanel";
import { OperationalTimeline } from "@/components/command/OperationalTimeline";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";
import { PartnerCommandOverview } from "@/components/command/PartnerCommandOverview";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import { MapDOMIsolationBoundary } from "@/components/perf/MapDOMIsolationBoundary";
import { DeferAfterPaint } from "@/components/perf/DeferAfterPaint";

const CommandMap = dynamic(
  () => import("@/components/command/CommandMap").then((m) => m.CommandMap),
  { ssr: false, loading: () => <div className="h-full w-full rounded-2xl" style={{ background: "var(--cmd-card)" }} aria-hidden /> },
);

const LAYERS: { key: LayerKey; label: string; icon: typeof Users }[] = [
  { key: "density", label: "Density", icon: Users },
  { key: "demand", label: "Demand", icon: Flame },
  { key: "revenue", label: "Revenue", icon: IndianRupee },
  { key: "surge", label: "Surge", icon: Zap },
  { key: "fraud", label: "Fraud", icon: ShieldAlert },
  { key: "geofence", label: "Geofence", icon: Hexagon },
  { key: "traffic", label: "Traffic", icon: Car },
  { key: "weather", label: "Weather", icon: CloudRain },
];

export default function CommandCenterPage() {
  useRenderProbe("CommandCenterPage");
  useMountProbe("CommandCenterPage");
  const [layers, setLayers] = useState<Set<LayerKey>>(new Set<LayerKey>(["density", "surge", "geofence"]));
  const toggle = (k: LayerKey) => setLayers((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Live data — WS invalidates on ops events; polls are slow safety nets.
  const poll = { staleTime: 60_000, refetchIntervalInBackground: false } as const;
  const kpisQ = useQuery({ queryKey: ["ci-kpis"], queryFn: () => adminApi.geoIntel.execKpis(), ...poll, refetchInterval: COMMAND_KPI_POLL_MS });
  const surgeQ = useQuery({ queryKey: ["ci-surge"], queryFn: () => adminApi.geoIntel.surge(), ...poll, refetchInterval: COMMAND_GEO_POLL_MS });
  const densityQ = useQuery({ queryKey: ["ci-density"], queryFn: () => adminApi.geoIntel.density(), ...poll, refetchInterval: COMMAND_GEO_POLL_MS });
  const zonesQ = useQuery({ queryKey: ["ci-zones"], queryFn: () => adminApi.geoIntel.zoneScoring(), ...poll, refetchInterval: COMMAND_GEO_POLL_MS });
  const fraudQ = useQuery({ queryKey: ["ci-fraud"], queryFn: () => adminApi.geoIntel.fraud(50), ...poll, refetchInterval: COMMAND_GEO_POLL_MS });
  const revQ = useQuery({ queryKey: ["ci-rev"], queryFn: () => adminApi.geoIntel.revenueForecast(), ...poll, refetchInterval: COMMAND_REVENUE_POLL_MS });
  const demandQ = useQuery({ queryKey: ["ci-demand"], queryFn: () => adminApi.geoIntel.demandForecast(24), ...poll, refetchInterval: COMMAND_DEMAND_POLL_MS });

  // Merge density (positions) + zone-scoring + surge into the map's per-zone records.
  const zones: CmdZone[] = useMemo(() => {
    const density = densityQ.data?.data ?? [];
    const score = new Map((zonesQ.data?.data.ranked ?? []).map((z) => [z.zoneId, z]));
    const surge = new Map((surgeQ.data?.data ?? []).map((z) => [z.zoneId, z]));
    return density.map((d) => {
      const s = score.get(d.zoneId);
      const su = surge.get(d.zoneId);
      return {
        zoneId: d.zoneId, name: d.name, city: d.city,
        centerLat: d.centerLat, centerLng: d.centerLng,
        radiusM: Math.sqrt(Math.max(d.areaKm2, 0.01) / Math.PI) * 1000,
        providers: d.providers, densityPerKm2: d.densityPerKm2,
        demand24h: s?.demand24h ?? 0, demandScore: s?.demandScore ?? 0, revenue24h: s?.revenue24h ?? 0, riskScore: s?.riskScore ?? 0,
        predictedSurge: su?.predictedSurge ?? 1, weatherSurge: su?.weatherSurge ?? 1,
      };
    });
  }, [densityQ.data, zonesQ.data, surgeQ.data]);

  const fraudPins: FraudPin[] = useMemo(
    () => (fraudQ.data?.data.events ?? []).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng)).map((e) => ({ lat: e.lat, lng: e.lng, implied_kmh: e.implied_kmh })),
    [fraudQ.data],
  );

  return (
    <div className="cmd-center flex h-[calc(100dvh-2.5rem)] flex-col gap-4 biz-page-enter">
      <header className="cmd-page-head">
        <Icon3D icon={Gauge} tone="success" size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="biz-display text-[1.45rem] font-bold leading-none tracking-tight">Command Center</h1>
            <span className="cmd-live-pill">
              <span className="cmd-live-dot" aria-hidden />
              Live
            </span>
          </div>
          <p className="mt-1.5 text-sm" style={{ color: "var(--cmd-muted)" }}>
            Live operations — density, surge, geofence, and fraud on one map
          </p>
        </div>
      </header>

      <CommandCenterRail />
      <DeferAfterPaint label="PartnerCommandOverview" fallback={<div className="h-28 rounded-2xl" aria-hidden />}>
        <PartnerCommandOverview />
      </DeferAfterPaint>

      <ExecutiveKpiRibbon kpis={kpisQ.data?.data ?? null} freshness={kpisQ.data?.freshness} confidence={kpisQ.data?.confidence} />

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="cmd-card cmd-map-frame">
          <MapPerformanceBoundary label="CommandMap" className="h-full w-full" deferAfterPaint rootMargin="0px">
            <MapDOMIsolationBoundary label="CommandMap" className="h-full w-full">
              <CommandMap zones={zones} fraud={fraudPins} layers={layers} className="h-full w-full" />
            </MapDOMIsolationBoundary>
          </MapPerformanceBoundary>

          <div className="cmd-layer-bar absolute left-3 top-3 z-10">
            <span className="cmd-layer-kicker">
              <Layers size={12} /> Layers
            </span>
            {LAYERS.map((l) => {
              const Icon = l.icon;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggle(l.key)}
                  className={`cmd-layer-btn${layers.has(l.key) ? " is-on" : ""}`}
                >
                  <Icon size={13} />
                  {l.label}
                </button>
              );
            })}
          </div>

          <div className="cmd-map-chip absolute bottom-3 left-3 z-10">
            {zones.length} zones · {zones.reduce((s, z) => s + z.providers, 0)} providers live · {fraudPins.length} fraud pins
          </div>
        </div>

        <DeferAfterPaint
          label="AiIntelligencePanel"
          fallback={<div className="cmd-card cmd-intel-board" aria-hidden />}
        >
          <AiIntelligencePanel
            surge={surgeQ.data?.data}
            demand={demandQ.data?.data}
            fraud={fraudQ.data?.data}
            revenue={revQ.data?.data}
            zones={zonesQ.data?.data}
          />
        </DeferAfterPaint>
      </div>

      <DeferAfterPaint label="OperationalTimeline" fallback={<div className="cmd-card cmd-timeline shrink-0" aria-hidden />}>
        <OperationalTimeline fraud={fraudQ.data?.data} surge={surgeQ.data?.data} />
      </DeferAfterPaint>
    </div>
  );
}
