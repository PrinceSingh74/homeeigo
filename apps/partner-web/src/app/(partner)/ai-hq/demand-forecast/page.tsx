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
  const zones = useQuery({
    queryKey: ["partner", "zone-scoring-demand"],
    queryFn: () => partnerApi.geoIntel.zoneScoring(),
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
  const ranked = zones.data?.data.ranked ?? [];
  const maxAbsGap = Math.max(1, ...ranked.map((z) => Math.abs(z.gap ?? z.demand24h - z.supply)));

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
      description="24-hour warehouse forecast plus live supply–demand gaps. Heuristic zone gaps are labelled as such."
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
        {ranked.length === 0 ? (
          <p className="mt-2 text-sm text-partner-muted">Not enough verified zone data yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ranked.slice(0, 8).map((z) => {
              const gap = z.gap ?? z.demand24h - z.supply;
              const width = Math.round((Math.abs(gap) / maxAbsGap) * 100);
              return (
                <li key={z.zoneId} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{z.name}</span>
                    <span className="text-partner-muted">
                      {z.demand24h} demand · {z.supply} supply · gap {gap}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-partner-line" aria-hidden>
                    <div
                      className={`h-full ${gap >= 0 ? "bg-partner-primary" : "bg-partner-muted"}`}
                      style={{ width: `${Math.max(width, 4)}%` }}
                    />
                  </div>
                  {z.recommendation ? (
                    <p className="text-xs text-partner-muted">{z.recommendation}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="partner-card max-h-80 overflow-y-auto p-4">
        <h2 className="font-semibold">Hourly predicted volume</h2>
        {unavailable ? (
          <div className="mt-2 space-y-1 text-sm" role="status">
            <p className="font-medium text-partner-warning">The demand forecast is unavailable right now.</p>
            <p className="text-partner-muted">
              The forecast source did not respond, so nothing has been charted. Live supply-demand gaps
              above are unaffected.
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
              24 hours until it is retrained. Live supply-demand gaps above are unaffected.
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
