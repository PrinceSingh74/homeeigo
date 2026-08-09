"use client";

import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";

export default function CoverageAreasPage() {
  const density = useQuery({ queryKey: ["partner", "coverage-density"], queryFn: () => partnerApi.geoIntel.density() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Coverage Areas</h1>
        <p className="text-sm text-partner-muted">Partner density and area coverage from geo-intel provider-density feed.</p>
      </div>
      <div className="space-y-2">
        {(density.data?.data ?? []).slice(0, 10).map((zone) => (
          <article key={zone.zoneId} className="partner-card flex items-center justify-between p-4">
            <p className="font-medium">{zone.name}</p>
            <p className="text-sm text-partner-muted">{zone.densityPerKm2.toFixed(2)} partners / km²</p>
          </article>
        ))}
      </div>
    </div>
  );
}
