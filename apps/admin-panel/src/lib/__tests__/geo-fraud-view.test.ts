/**
 * X-86 — what Risk HQ's GPS-fraud tiles show when the fraud-signal warehouse is down.
 *
 * `GET /api/geo-intel/fraud` used to 500 on a warehouse outage; the dashboard then rendered
 * "GPS Anomalies 0" (`formatNumber(num(undefined))`) and a green, "healthy" risk tile — a clean bill
 * of health nobody measured. The route now answers `available: false` /
 * `FRAUD_SIGNALS_SOURCE_UNAVAILABLE` with `data: null`, and the tiles must say unavailable.
 */
import { describe, expect, test } from "bun:test";
import { geoFraudView } from "../geo-fraud-view";
import type { GeoFraudResponse } from "@/services/admin-api";

const unavailable: GeoFraudResponse = {
  success: true,
  available: false,
  reasonCode: "FRAUD_SIGNALS_SOURCE_UNAVAILABLE",
  cause: "CREDENTIALS",
  reason: "The GPS fraud-signal warehouse did not return usable signals.",
  data: null,
  confidence: null,
  freshness: null,
  source: "unavailable",
  cached: false,
  generatedAt: "2026-09-30T05:00:00.000Z",
};

const healthy = (riskScore: number, suspiciousCount: number): GeoFraudResponse => ({
  success: true,
  available: true,
  data: { suspiciousCount, riskScore, events: [] },
  confidence: 0.95,
  freshness: "2026-09-30T05:00:00.000Z",
  source: "bigquery:vw_fake_gps_signals",
  cached: false,
  generatedAt: "2026-09-30T05:00:00.000Z",
});

describe("geoFraudView", () => {
  test("source unavailable → no score, no count, neutral tone", () => {
    const v = geoFraudView(unavailable, false);
    expect(v.state).toBe("unavailable");
    expect(v.riskScoreLabel).toBe("—");
    expect(v.anomaliesLabel).toBe("—");
    expect(v.tone).toBe("default");
    expect(v.sub).toBe("GPS signals unavailable");
  });

  test("request failed → unavailable, not 0 anomalies and not green", () => {
    const v = geoFraudView(undefined, true);
    expect(v.state).toBe("unavailable");
    expect(v.anomaliesLabel).toBe("—");
    expect(v.tone).toBe("default");
  });

  test("still loading → no figures", () => {
    const v = geoFraudView(undefined, false);
    expect(v.state).toBe("loading");
    expect(v.riskScoreLabel).toBe("—");
    expect(v.anomaliesLabel).toBe("—");
  });

  test("healthy signals render as before (danger above 50)", () => {
    const hi = geoFraudView(healthy(72.4, 3), false);
    expect(hi.state).toBe("ready");
    expect(hi.riskScoreLabel).toBe("72");
    expect(hi.anomaliesLabel).toBe("3");
    expect(hi.tone).toBe("danger");
    expect(hi.sub).toBe("GPS anomaly index");
    const lo = geoFraudView(healthy(12, 0), false);
    expect(lo.tone).toBe("success");
    expect(lo.anomaliesLabel).toBe("0");
  });
});
