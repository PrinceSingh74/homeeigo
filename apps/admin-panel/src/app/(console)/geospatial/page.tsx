"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Radio, Users, MapPinned, IndianRupee } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import { DataTable } from "@/components/ui/DataTable";

const GeospatialMap = dynamic(
  () => import("@/components/geo/GeospatialMap").then((m) => m.GeospatialMap),
  { ssr: false, loading: () => <div className="h-[460px] w-full rounded-2xl bg-zinc-900/40" aria-hidden /> },
);

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-1.5 text-xs text-zinc-400">{icon}{label}</p>
      <p className="mt-1 text-2xl font-bold text-zinc-100">{value}</p>
    </div>
  );
}

export default function GeospatialPage() {
  const qc = useQueryClient();
  const zonesQ = useQuery({ queryKey: ["geo-zones"], queryFn: () => adminApi.geofences.list({}) });
  const analyticsQ = useQuery({ queryKey: ["geo-zone-analytics"], queryFn: () => adminApi.zoneAnalytics(), refetchInterval: 60_000 });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.geofences.create>[0]) => adminApi.geofences.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geo-zones"] });
      qc.invalidateQueries({ queryKey: ["geo-zone-analytics"] });
    },
  });

  const zones = zonesQ.data ?? [];
  const analytics = analyticsQ.data;

  const onDraw = (d: Parameters<typeof onDrawImpl>[0]) => onDrawImpl(d);
  function onDrawImpl(d: { shape: "CIRCLE" | "POLYGON"; centerLat: number; centerLng: number; radiusMeters: number; polygon?: Array<{ lat: number; lng: number }> }) {
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
  }

  const zoneRows = useMemo(
    () =>
      (analytics?.zones ?? []).map((z) => [
        <span key={`n-${z.id}`} className="font-medium">{z.name}<span className="ml-1 text-xs text-zinc-500">{z.city ?? ""}</span></span>,
        <span key={`s-${z.id}`} className={`rounded px-1.5 py-0.5 text-xs ${z.shape === "POLYGON" ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"}`}>{z.shape}</span>,
        `×${z.surgeMultiplier}`,
        String(z.supply),
        String(z.demand),
        String(z.utilization),
        `₹${z.revenue.toLocaleString("en-IN")}`,
      ]),
    [analytics?.zones],
  );

  return (
    <div className="space-y-6 p-1">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Geospatial Command Center</h1>
        <p className="text-sm text-zinc-400">NCR-focused · live providers, bookings, service zones · draw circle/polygon geofences directly on the map</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Radio size={13} />} label="Active providers" value={analytics?.totals.supply ?? "—"} />
        <Kpi icon={<Users size={13} />} label="Live demand (24h)" value={analytics?.totals.demand ?? "—"} />
        <Kpi icon={<MapPinned size={13} />} label="Service zones" value={analytics?.totals.zones ?? zones.length} />
        <Kpi icon={<IndianRupee size={13} />} label="Zone revenue (24h)" value={analytics ? `₹${analytics.totals.revenue.toLocaleString("en-IN")}` : "—"} />
      </div>

      <MapPerformanceBoundary label="GeospatialMap" className="h-[460px] w-full" deferAfterPaint rootMargin="80px">
        <GeospatialMap zones={zones} onDraw={onDraw} />
      </MapPerformanceBoundary>
      {create.isPending && <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="animate-spin" size={13} /> Creating zone…</p>}

      <DataTable
        headers={["Zone", "Shape", "Surge", "Supply", "Demand", "Util.", "Revenue 24h"]}
        rows={zoneRows}
        isLoading={analyticsQ.isLoading}
        emptyMessage="No zone analytics yet."
      />
    </div>
  );
}
