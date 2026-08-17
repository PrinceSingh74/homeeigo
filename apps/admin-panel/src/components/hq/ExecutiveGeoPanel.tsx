"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPinned } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { DataUnavailable } from "./primitives";
import { Icon3D } from "./Icon3D";
import { IsoBarChart } from "./IsoBarChart";

/** Revenue heatmap by zone — real geo-intel zone-scoring data. */
export function ExecutiveGeoPanel() {
  const zones = useQuery({
    queryKey: ["hq", "exec", "zone-scoring"],
    queryFn: () => adminApi.geoIntel.zoneScoring(),
    staleTime: 120_000,
  });

  const ranked = useMemo(() => {
    const list = zones.data?.data?.ranked ?? [];
    return [...list].sort((a, b) => b.revenue24h - a.revenue24h).slice(0, 12);
  }, [zones.data]);

  const maxRevenue = Math.max(1, ...ranked.map((z) => z.revenue24h));

  return (
    <GlassPanel className="p-6">
      <div className="exec-section-head">
        <div className="exec-section-head__title">
          <Icon3D icon={MapPinned} tone="warning" size="md" />
          <h2 className="text-sm font-semibold leading-none tracking-tight">Geographic Revenue</h2>
        </div>
        <span className="exec-section-head__meta">24h · top zones</span>
      </div>
      {zones.isLoading ? (
        <div className="biz-skeleton h-52 rounded-xl" />
      ) : ranked.length > 0 ? (
        <div className="space-y-5">
          <IsoBarChart
            data={ranked.map((z) => ({ label: z.name, value: z.revenue24h }))}
            format={(v) => inr(v, true)}
            accent="amber"
            height={230}
            layout="bar"
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ranked.slice(0, 4).map((z) => {
              const intensity = z.revenue24h / maxRevenue;
              return (
                <div
                  key={z.zoneId}
                  className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)]/40 p-3.5 backdrop-blur-sm"
                  style={{ boxShadow: `inset 0 0 0 1px rgba(245, 158, 11, ${(0.08 + intensity * 0.35).toFixed(3)})` }}
                >
                  <p className="truncate text-[11px] font-medium">{z.name}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--color-biz-muted)]">{z.city ?? "—"}</p>
                  <p className="mt-2 text-sm font-bold tabular-nums">{inr(z.revenue24h, true)}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <DataUnavailable title="No geographic data" reason="Zone-scoring returned no ranked zones." />
      )}
    </GlassPanel>
  );
}
