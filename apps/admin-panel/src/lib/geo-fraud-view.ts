import type { GeoFraudResponse } from "@/services/admin-api";
import { formatCount } from "@/lib/format";

/**
 * What Risk HQ's two GPS-fraud tiles may show, decided in one place.
 *
 * X-86: when the fraud-signal warehouse is down (`available: false`, or the request failed) there is
 * no anomaly count and no risk score. The tiles used to show "0" anomalies and a green risk tile —
 * a clean bill of health nobody measured. Unavailable is neutral, never "success".
 */
export type GeoFraudView = {
  state: "loading" | "unavailable" | "ready";
  riskScoreLabel: string;
  anomaliesLabel: string;
  tone: "default" | "danger" | "success";
  sub: string;
};

export function geoFraudView(res: GeoFraudResponse | undefined, isError: boolean): GeoFraudView {
  if (isError || res?.available === false) {
    return { state: "unavailable", riskScoreLabel: "—", anomaliesLabel: "—", tone: "default", sub: "GPS signals unavailable" };
  }
  if (!res || !res.data) {
    return { state: "loading", riskScoreLabel: "—", anomaliesLabel: "—", tone: "default", sub: "GPS anomaly index" };
  }
  const riskScore = Number(res.data.riskScore);
  return {
    state: "ready",
    riskScoreLabel: Number.isFinite(riskScore) ? riskScore.toFixed(0) : "—",
    anomaliesLabel: formatCount(res.data.suspiciousCount),
    tone: riskScore > 50 ? "danger" : "success",
    sub: "GPS anomaly index",
  };
}
