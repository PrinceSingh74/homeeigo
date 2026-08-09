"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, MapPinned, TrendingUp } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { TerritoryHeatmapMap, type HeatmapZone } from "@/components/map/TerritoryHeatmapMap";
import { cn } from "@/lib/cn";
import { partnerApi } from "@/services/partner-api";

export default function HeatmapPage() {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const surge = useQuery({
    queryKey: ["partner", "heatmap-surge"],
    queryFn: () => partnerApi.geoIntel.surge(),
    refetchInterval: 120_000,
  });
  const density = useQuery({
    queryKey: ["partner", "heatmap-density"],
    queryFn: () => partnerApi.geoIntel.density(),
    refetchInterval: 120_000,
  });

  const zones = useMemo((): HeatmapZone[] => {
    const densityById = new Map((density.data?.data ?? []).map((d) => [d.zoneId, d]));
    const merged: HeatmapZone[] = [];
    for (const s of surge.data?.data ?? []) {
      const d = densityById.get(s.zoneId);
      if (d) merged.push({ ...s, ...d });
    }
    return merged.sort((a, b) => b.predictedSurge - a.predictedSurge);
  }, [surge.data?.data, density.data?.data]);

  const topSurge = zones[0]?.predictedSurge ?? 1;
  const avgSurge =
    zones.length > 0 ? zones.reduce((s, z) => s + z.predictedSurge, 0) / zones.length : 1;
  const hotZones = zones.filter((z) => z.predictedSurge >= 1.3).length;

  return (
    <HqPageShell
      title="Demand Heatmap"
      description="Interactive surge overlay on live geofence zones — tap a zone on the map or list to inspect demand pressure, supply, and density."
      icon={Flame}
      stats={[
        { label: "Zones tracked", value: zones.length },
        { label: "Peak surge", value: `${topSurge.toFixed(2)}×` },
        { label: "Avg surge", value: `${avgSurge.toFixed(2)}×` },
        { label: "Hot zones", value: hotZones, hint: "≥ 1.3×" },
      ]}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <TerritoryHeatmapMap
          zones={zones}
          selectedZoneId={selectedZoneId}
          onZoneSelect={setSelectedZoneId}
        />

        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-partner-muted">
              Zone leaderboard
            </h2>
            {(surge.isFetching || density.isFetching) && (
              <span className="text-[11px] text-partner-muted">Refreshing…</span>
            )}
          </div>
          <div className="max-h-[min(68vh,560px)] space-y-2 overflow-y-auto pr-1">
            {zones.length === 0 ? (
              <div className="partner-card p-6 text-center text-sm text-partner-muted">
                {surge.isLoading || density.isLoading
                  ? "Loading geo-intel zones…"
                  : "No mapped zones yet. Geofences with coordinates power this view."}
              </div>
            ) : (
              zones.map((zone, idx) => {
                const active = selectedZoneId === zone.zoneId;
                const hot = zone.predictedSurge >= 1.5;
                return (
                  <button
                    key={zone.zoneId}
                    type="button"
                    onClick={() => setSelectedZoneId(zone.zoneId)}
                    className={cn(
                      "partner-card w-full p-4 text-left transition",
                      active && "ring-2 ring-partner-primary/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold text-partner-text">
                          <span className="text-[11px] font-bold text-partner-muted">#{idx + 1}</span>
                          {zone.name}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-partner-muted">
                          <MapPinned className="h-3 w-3" />
                          {zone.city ?? "—"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                          hot
                            ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                            : "bg-partner-primary/10 text-partner-primary",
                        )}
                      >
                        {zone.predictedSurge.toFixed(2)}×
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-partner-muted">
                      <span>Supply {zone.supply}</span>
                      <span>Active {zone.activeBookings}</span>
                      <span className="flex items-center gap-0.5">
                        <TrendingUp className="h-3 w-3" />
                        {zone.densityPerKm2.toFixed(1)}/km²
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </HqPageShell>
  );
}
