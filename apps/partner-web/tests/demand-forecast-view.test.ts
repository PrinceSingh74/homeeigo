/**
 * X-84 — what the Demand Forecast page shows when the forecast source is down.
 *
 * The backend used to answer a warehouse outage with a 500; the page then had no data and rendered
 * "Total predicted 0" and "Confidence 0%" — numbers nobody predicted. The route now answers
 * `available: false` / `FORECAST_SOURCE_UNAVAILABLE` with `data: null`, and the page must show that
 * as unavailable (the same presentation it already uses for an expired window), never as zero.
 */
import { describe, expect, test } from "bun:test";
import { demandForecastView } from "@/lib/demand-forecast-view";
import type { DemandForecastResponse } from "@/services/partner-api";

const unavailable: DemandForecastResponse = {
  success: true,
  available: false,
  reasonCode: "FORECAST_SOURCE_UNAVAILABLE",
  cause: "CREDENTIALS",
  reason: "The demand-forecast warehouse did not return a usable forecast.",
  data: null,
  confidence: null,
  freshness: null,
  source: "unavailable",
  cached: false,
  generatedAt: "2026-09-30T05:00:00.000Z",
};

const healthy: DemandForecastResponse = {
  success: true,
  available: true,
  data: {
    horizonHours: 24,
    points: [{ zone_id: "z-1", hour: "2026-09-30 06:00", predicted: 3.4, lo: 1, hi: 5 }],
    totalPredicted: 3.4,
    stale: false,
  },
  confidence: 0.81,
  freshness: "2026-09-30T05:00:00.000Z",
  source: "bigquery:arima_plus",
  cached: false,
  generatedAt: "2026-09-30T05:00:00.000Z",
};

describe("demandForecastView", () => {
  test("source unavailable → no forecast numbers anywhere", () => {
    const v = demandForecastView(unavailable, false);
    expect(v.state).toBe("unavailable");
    expect(v.points).toEqual([]);
    expect(v.totalLabel).toBe("Unavailable");
    expect(v.confidenceLabel).toBe("—");
    expect(v.sourceLabel).toBe("—");
  });

  test("request failed (older backend 500 / network) → unavailable, not zero", () => {
    const v = demandForecastView(undefined, true);
    expect(v.state).toBe("unavailable");
    expect(v.totalLabel).toBe("Unavailable");
    expect(v.confidenceLabel).toBe("—");
  });

  test("still loading → no numbers yet, not zero", () => {
    const v = demandForecastView(undefined, false);
    expect(v.state).toBe("loading");
    expect(v.totalLabel).toBe("—");
    expect(v.confidenceLabel).toBe("—");
  });

  test("healthy forecast renders exactly as before", () => {
    const v = demandForecastView(healthy, false);
    expect(v.state).toBe("ready");
    expect(v.points).toHaveLength(1);
    expect(v.totalLabel).toBe(3);
    expect(v.confidenceLabel).toBe("81%");
    expect(v.sourceLabel).toBe("bigquery:arima_plus");
    expect(v.horizonHours).toBe(24);
  });

  test("expired window keeps its existing presentation", () => {
    const stale = { ...healthy, data: { ...healthy.data!, stale: true } } as DemandForecastResponse;
    const v = demandForecastView(stale, false);
    expect(v.state).toBe("stale");
    expect(v.points).toEqual([]);
    expect(v.totalLabel).toBe("Unavailable");
    expect(v.confidenceLabel).toBe("—");
  });
});
