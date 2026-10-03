import type { PartnerRiskLevel, PartnerRiskSignalType } from "@prisma/client";

export const RISK_SIGNAL_WEIGHTS: Record<PartnerRiskSignalType, number> = {
  GPS_SPOOF: 12,
  IMPOSSIBLE_TRAVEL: 15,
  FAKE_ARRIVAL: 10,
  FAKE_COMPLETION: 14,
  MULTIPLE_ACCOUNTS: 18,
  DEVICE_ANOMALY: 8,
  CANCELLATION_ABUSE: 10,
  EARNINGS_ABUSE: 12,
  REFERRAL_ABUSE: 10,
};

export const IMPOSSIBLE_TRAVEL_KMH = 400;
export const GPS_SPOOF_KMH = 220;
export const ARRIVAL_MISMATCH_METERS = 1500;
export const CANCELLATION_ABUSE_RATE = 0.45;
export const CANCELLATION_ABUSE_MIN_JOBS = 8;

export type SignalForScore = {
  type: PartnerRiskSignalType;
  severity: number;
  confidence?: number | null;
};

export type RiskScoreResult = {
  score: number;
  level: PartnerRiskLevel;
  explanation: {
    why: string;
    signals: Array<{ type: PartnerRiskSignalType; count: number; contribution: number }>;
  };
};

export function scoreFromSignals(signals: SignalForScore[]): RiskScoreResult {
  const byType = new Map<PartnerRiskSignalType, { count: number; contribution: number }>();
  let raw = 0;
  for (const s of signals) {
    const conf = s.confidence == null ? 1 : Math.max(0, Math.min(1, s.confidence));
    const contrib = Math.round(RISK_SIGNAL_WEIGHTS[s.type] * (s.severity / 100) * conf);
    raw += contrib;
    const prev = byType.get(s.type) ?? { count: 0, contribution: 0 };
    prev.count += 1;
    prev.contribution += contrib;
    byType.set(s.type, prev);
  }
  const score = Math.max(0, Math.min(100, raw));
  const level: PartnerRiskLevel = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  const parts = [...byType.entries()].sort((a, b) => b[1].contribution - a[1].contribution);
  const why =
    parts.length === 0
      ? "No active risk signals."
      : `${level} because of ${parts.map(([t, v]) => `${v.count} ${t.replace(/_/g, " ").toLowerCase()}`).join(", ")}.`;
  return {
    score,
    level,
    explanation: {
      why,
      signals: parts.map(([type, v]) => ({ type, count: v.count, contribution: v.contribution })),
    },
  };
}

export function impliedSpeedKmh(distanceKm: number, elapsedMs: number): number | null {
  if (elapsedMs <= 0 || distanceKm < 0) return null;
  const hours = elapsedMs / 3_600_000;
  if (hours < 1 / 60) return null;
  return distanceKm / hours;
}
