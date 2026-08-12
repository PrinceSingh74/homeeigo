"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useQuery } from "@tanstack/react-query";
import { Layers, Users, Flame, IndianRupee, Zap, ShieldAlert, Hexagon, Car, CloudRain } from "lucide-react";
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
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import { MapDOMIsolationBoundary } from "@/components/perf/MapDOMIsolationBoundary";
import { DeferAfterPaint } from "@/components/perf/DeferAfterPaint";

const CommandMap = dynamic(
  () => import("@/components/command/CommandMap").then((m) => m.CommandMap),
  { ssr: false, loading: () => <div className="h-full w-full rounded-2xl bg-white/5" aria-hidden /> },
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
  const geoReady = kpisQ.isSuccess;
  const surgeQ = useQuery({ queryKey: ["ci-surge"], queryFn: () => adminApi.geoIntel.surge(), ...poll, enabled: geoReady, refetchInterval: COMMAND_GEO_POLL_MS });
  const densityQ = useQuery({ queryKey: ["ci-density"], queryFn: () => adminApi.geoIntel.density(), ...poll, enabled: geoReady, refetchInterval: COMMAND_GEO_POLL_MS });
  const zonesQ = useQuery({ queryKey: ["ci-zones"], queryFn: () => adminApi.geoIntel.zoneScoring(), ...poll, enabled: geoReady, refetchInterval: COMMAND_GEO_POLL_MS });
  const fraudQ = useQuery({ queryKey: ["ci-fraud"], queryFn: () => adminApi.geoIntel.fraud(50), ...poll, enabled: geoReady, refetchInterval: COMMAND_GEO_POLL_MS });
  const revQ = useQuery({ queryKey: ["ci-rev"], queryFn: () => adminApi.geoIntel.revenueForecast(), ...poll, enabled: geoReady, refetchInterval: COMMAND_REVENUE_POLL_MS });
  const demandQ = useQuery({ queryKey: ["ci-demand"], queryFn: () => adminApi.geoIntel.demandForecast(24), ...poll, enabled: geoReady, refetchInterval: COMMAND_DEMAND_POLL_MS });

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
    <div className="flex h-[calc(100dvh-1rem)] flex-col gap-3 p-1">
      {/* TOP — Executive KPI ribbon */}
      <ExecutiveKpiRibbon kpis={kpisQ.data?.data ?? null} freshness={kpisQ.data?.freshness} confidence={kpisQ.data?.confidence} />

      {/* MIDDLE — map (center) + AI panel (right) */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10">
          <MapPerformanceBoundary label="CommandMap" className="h-full w-full" deferAfterPaint rootMargin="0px">
            <MapDOMIsolationBoundary label="CommandMap" className="h-full w-full">
              <CommandMap zones={zones} fraud={fraudPins} layers={layers} className="h-full w-full" />
            </MapDOMIsolationBoundary>
          </MapPerformanceBoundary>

          {/* Layer toggle bar */}
          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 rounded-xl border border-white/10 bg-slate-900/85 p-1.5 backdrop-blur">
            <span className="flex items-center gap-1 px-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Layers size={12} />Layers</span>
            {LAYERS.map((l) => {
              const Icon = l.icon;
              return (
              <button
                key={l.key}
                onClick={() => toggle(l.key)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${layers.has(l.key) ? "bg-sky-500 text-white shadow-lg shadow-sky-500/25" : "text-slate-400 hover:bg-slate-800"}`}
              >
                <Icon size={13} />{l.label}
              </button>
            );
            })}
          </div>

          {/* Zone count chip */}
          <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-white/10 bg-slate-900/85 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur">
            {zones.length} zones · {zones.reduce((s, z) => s + z.providers, 0)} providers live · {fraudPins.length} fraud pins
          </div>
        </div>

        {/* RIGHT — AI intelligence panel (deferred after first paint) */}
        <DeferAfterPaint
          label="AiIntelligencePanel"
          fallback={<div className="w-[20rem] shrink-0 rounded-2xl border border-white/10 bg-slate-900/40" aria-hidden />}
        >
          <div className="w-[20rem] shrink-0">
            <AiIntelligencePanel
              surge={surgeQ.data?.data}
              demand={demandQ.data?.data}
              fraud={fraudQ.data?.data}
              revenue={revQ.data?.data}
              zones={zonesQ.data?.data}
            />
          </div>
        </DeferAfterPaint>
      </div>

      {/* BOTTOM — operational timeline (deferred) */}
      <DeferAfterPaint label="OperationalTimeline" fallback={<div className="h-12 shrink-0" aria-hidden />}>
        <div className="h-12 shrink-0">
          <OperationalTimeline fraud={fraudQ.data?.data} surge={surgeQ.data?.data} />
        </div>
      </DeferAfterPaint>
    </div>
  );
}
