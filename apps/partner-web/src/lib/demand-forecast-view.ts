import type { DemandForecastResponse, DemandPoint } from "@/services/partner-api";

/**
 * What the Demand Forecast page may show, decided in one place.
 *
 * Three states carry no forecast numbers: still loading, an expired window (`stale` — the model
 * describes hours that have passed), and an unavailable source (X-84: the warehouse did not answer,
 * `available: false`, or the request itself failed). The last one used to render as
 * "Total predicted 0 · Confidence 0%" because the page read missing data as zero.
 */
export type DemandForecastView = {
  state: "loading" | "unavailable" | "stale" | "ready";
  points: DemandPoint[];
  horizonHours: number;
  totalLabel: number | string;
  confidenceLabel: string;
  sourceLabel: string;
};

export function demandForecastView(
  res: DemandForecastResponse | undefined,
  isError: boolean,
  requestedHorizon = 24,
): DemandForecastView {
  const none = { points: [] as DemandPoint[], horizonHours: requestedHorizon, confidenceLabel: "—", sourceLabel: "—" };
  if (isError || res?.available === false) return { ...none, state: "unavailable", totalLabel: "Unavailable" };
  if (!res || !res.data) return { ...none, state: "loading", totalLabel: "—" };

  const horizonHours = res.data.horizonHours ?? requestedHorizon;
  if (res.data.stale === true) {
    // Withheld rather than shown as a number nobody predicted for the coming day.
    return { ...none, horizonHours, sourceLabel: res.source ?? "—", state: "stale", totalLabel: "Unavailable" };
  }
  return {
    state: "ready",
    points: res.data.points ?? [],
    horizonHours,
    totalLabel: Math.round(res.data.totalPredicted ?? 0),
    confidenceLabel: `${Math.round((res.confidence ?? 0) * 100)}%`,
    sourceLabel: res.source ?? "—",
  };
}
