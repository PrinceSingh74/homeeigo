"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Compass, MapPinned } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { NetworkCitiesSection } from "@/components/hq/NetworkCitiesSection";
import { partnerApi } from "@/services/partner-api";

export default function TerritoryHqPage() {
  const surge = useQuery({
    queryKey: ["partner", "territory-surge"],
    queryFn: () => partnerApi.geoIntel.surge(),
    staleTime: 120_000,
  });
  const density = useQuery({
    queryKey: ["partner", "territory-density"],
    queryFn: () => partnerApi.geoIntel.density(),
    staleTime: 120_000,
  });
  const scoring = useQuery({
    queryKey: ["partner", "territory-scoring"],
    queryFn: () => partnerApi.geoIntel.zoneScoring(),
    staleTime: 120_000,
  });

  const surgeZones = surge.data?.data ?? [];
  const densityZones = density.data?.data ?? [];
  const ranked = scoring.data?.data.ranked ?? [];
  const preferredZones = scoring.data?.data.bestEarning?.length ?? 0;
  const demandIndex =
    ranked.length > 0
      ? Math.round(ranked.reduce((s, z) => s + z.demandScore, 0) / ranked.length)
      : 0;
  const hotSurge = surgeZones.filter((z) => z.predictedSurge >= 1.3).length;

  return (
    <HqPageShell
      title="Territory HQ"
      description="Demand heatmap, coverage, preferred earning zones, and surge analytics — all from geo-intel APIs."
      icon={MapPinned}
      stats={[
        { label: "Surge zones", value: surgeZones.length },
        { label: "Coverage zones", value: densityZones.length },
        { label: "Preferred zones", value: preferredZones, hint: "Top earning" },
        { label: "Demand index", value: demandIndex, hint: "Avg demand score" },
      ]}
    >
      {hotSurge > 0 ? (
        <p className="text-sm text-partner-muted">
          <Compass className="mr-1 inline h-4 w-4 text-orange-500" />
          {hotSurge} zone{hotSurge === 1 ? "" : "s"} currently above 1.3× surge.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/territory-hq/heatmap" className="partner-card partner-card-hover p-5">
          <p className="font-semibold">Demand Heatmap</p>
          <p className="mt-1 text-sm text-partner-muted">Interactive map with live surge overlay</p>
        </Link>
        <Link href="/territory-hq/coverage-areas" className="partner-card partner-card-hover p-5">
          <p className="font-semibold">Coverage Areas</p>
          <p className="mt-1 text-sm text-partner-muted">Provider density by geofence zone</p>
        </Link>
        <Link href="/navigation" className="partner-card partner-card-hover p-5">
          <p className="font-semibold">Navigation</p>
          <p className="mt-1 text-sm text-partner-muted">Turn-by-turn to active jobs</p>
        </Link>
        <Link href="/ai-hq/demand-forecast" className="partner-card partner-card-hover p-5">
          <p className="font-semibold">Demand Forecast</p>
          <p className="mt-1 text-sm text-partner-muted">24h zone-level demand prediction</p>
        </Link>
      </div>
      <NetworkCitiesSection />

      {ranked.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-partner-muted">
            Top territories by composite score
          </h2>
          {ranked.slice(0, 5).map((zone) => (
            <article key={zone.zoneId} className="partner-card flex items-center justify-between p-4">
              <div>
                <p className="font-semibold">{zone.name}</p>
                <p className="text-xs text-partner-muted">{zone.city ?? "—"}</p>
              </div>
              <p className="text-sm font-bold text-partner-primary">{zone.compositeScore}/100</p>
            </article>
          ))}
        </section>
      ) : null}
    </HqPageShell>
  );
}
