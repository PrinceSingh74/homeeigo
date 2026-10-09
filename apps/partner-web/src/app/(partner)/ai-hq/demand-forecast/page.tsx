"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { demandForecastView } from "@/lib/demand-forecast-view";
import { Sparkles } from "lucide-react";

export default function DemandForecastPage() {
  const forecast = useQuery({
    queryKey: ["partner", "ai-demand-forecast"],
    queryFn: () => partnerApi.geoIntel.demandForecast(24),
  });
  /**
   * An expired window is not a forecast, so its points are not charted.
   *
   * The warehouse model projects forward from the end of its training data. When that window has
   * closed, these points describe hours that have already happened — and the chart below labels them
   * by hour-of-day only, so a partner would read June's overnight hours as tonight's. The backend
   * reports `stale`; this page acts on it rather than drawing the bars anyway.
   */
  const view = demandForecastView(forecast.data, forecast.isError);
  const stale = view.state === "stale";
  const unavailable = view.state === "unavailable";
  const points = view.points;
  const staleData = stale ? forecast.data?.data : undefined;
  const window = staleData?.forecastWindow;
  const hourly = useMemo(() => {
    const byHour = new Map<string, number>();
    for (const p of points) {
      const hour = new Date(p.hour).toLocaleTimeString("en-IN", { hour: "2-digit" });
      byHour.set(hour, (byHour.get(hour) ?? 0) + Math.max(0, p.predicted));
    }
    return [...byHour.entries()].slice(0, 12);
  }, [points]);
  const maxHour = Math.max(1, ...hourly.map(([, v]) => v));

  return (
    <HqPageShell
      title="Demand Forecast"
      description="24-hour warehouse forecast. Platform zone scores are not part of the partner view."
      icon={Sparkles}
      stats={[
        { label: "Horizon", value: `${view.horizonHours}h` },
        // Withheld (expired window, unavailable source) rather than shown as a number nobody predicted.
        { label: "Total predicted", value: view.totalLabel },
        { label: "Confidence", value: view.confidenceLabel },
        { label: "Source", value: view.sourceLabel },
      ]}
    >
      <section className="partner-card p-4">
        <h2 className="font-semibold">Supply–demand gap</h2>
        <p className="mt-2 text-sm text-partner-muted">
          Platform zone scores are admin-only, so this page does not show a demand or gap figure from them.
          The hourly forecast below is the warehouse series a partner is allowed to read.
        </p>
      </section>
      <section className="partner-card max-h-80 overflow-y-auto p-4">
        <h2 className="font-semibold">Hourly predicted volume</h2>
        {unavailable ? (
          <div className="mt-2 space-y-1 text-sm" role="status">
            <p className="font-medium text-partner-warning">The demand forecast is unavailable right now.</p>
            <p className="text-partner-muted">
              The forecast source did not respond, so nothing has been charted.
            </p>
          </div>
        ) : stale ? (
          <div className="mt-2 space-y-1 text-sm" role="status">
            <p className="font-medium text-partner-warning">
              The warehouse forecast is out of date and has not been charted.
            </p>
            <p className="text-partner-muted">
              The model can only forecast up to{" "}
              {window?.to ?? "an unknown time"}
              {staleData?.expiredByHours
                ? `, which was ${Math.round(staleData.expiredByHours / 24)} day(s) ago`
                : ""}
              . It projects forward from the end of its training data, so it cannot describe the next
              24 hours until it is retrained.
            </p>
          </div>
        ) : hourly.length === 0 ? (
          <p className="mt-2 text-sm text-partner-muted">No forecast points returned.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {hourly.map(([hour, value]) => (
              <li key={hour} className="flex items-center gap-3 text-sm">
                <span className="w-16 text-partner-muted">{hour}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-partner-line" aria-hidden>
                  <div className="h-full bg-partner-primary/70" style={{ width: `${Math.round((value / maxHour) * 100)}%` }} />
                </div>
                <span className="w-12 text-right font-semibold">{value.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </HqPageShell>
  );
}
