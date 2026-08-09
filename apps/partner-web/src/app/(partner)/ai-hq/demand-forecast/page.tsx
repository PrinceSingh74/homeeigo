"use client";

import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { Sparkles } from "lucide-react";

export default function DemandForecastPage() {
  const forecast = useQuery({
    queryKey: ["partner", "ai-demand-forecast"],
    queryFn: () => partnerApi.geoIntel.demandForecast(24),
  });

  const points = forecast.data?.data.points ?? [];

  return (
    <HqPageShell
      title="AI Demand Forecast"
      description="24-hour demand projection from /api/geo-intel/demand-forecast."
      icon={Sparkles}
      stats={[
        { label: "Horizon", value: `${forecast.data?.data.horizonHours ?? 24}h` },
        { label: "Total predicted", value: Math.round(forecast.data?.data.totalPredicted ?? 0) },
        { label: "Confidence", value: `${Math.round((forecast.data?.confidence ?? 0) * 100)}%` },
        { label: "Source", value: forecast.data?.source ?? "—" },
      ]}
    >
      <section className="partner-card max-h-96 overflow-y-auto p-4">
        <h2 className="font-semibold">Zone-hour forecast</h2>
        <div className="mt-3 space-y-1 text-sm">
          {points.length === 0 ? (
            <p className="text-partner-muted">No forecast points returned.</p>
          ) : (
            points.slice(0, 40).map((p) => (
              <div key={`${p.zone_id}-${p.hour}`} className="flex justify-between border-b border-partner-line py-2">
                <span>{p.zone_id}</span>
                <span className="text-partner-muted">{new Date(p.hour).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-semibold">{p.predicted.toFixed(1)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </HqPageShell>
  );
}
