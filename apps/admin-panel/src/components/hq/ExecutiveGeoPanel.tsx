"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPinned } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { DataUnavailable, SectionHeading } from "./primitives";

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
    <GlassPanel className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <MapPinned className="h-4 w-4 text-[var(--color-biz-accent)]" />
        <SectionHeading title="Geographic Revenue Heatmap" hint="24h · top zones" />
      </div>
      {zones.isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="biz-skeleton h-16 rounded-lg" />
          ))}
        </div>
      ) : ranked.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {ranked.map((z) => {
            const intensity = z.revenue24h / maxRevenue;
            return (
              <div
                key={z.zoneId}
                className="rounded-lg border border-[var(--color-biz-line)] p-2.5"
                style={{
                  background: `rgba(245, 158, 11, ${(0.05 + intensity * 0.28).toFixed(3)})`,
                }}
              >
                <p className="truncate text-[11px] font-medium">{z.name}</p>
                <p className="text-[9px] text-[var(--color-biz-muted)]">{z.city ?? "—"}</p>
                <p className="mt-1 text-sm font-bold tabular-nums">{inr(z.revenue24h, true)}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <DataUnavailable title="No geographic data" reason="Zone-scoring returned no ranked zones." />
      )}
    </GlassPanel>
  );
}
