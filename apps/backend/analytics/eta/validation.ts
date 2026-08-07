/**
 * Phase 2 — ETA label validation rules.
 * Rejects corrupt, incomplete, or anomalous training labels before warehouse load.
 */
import type { EtaLabelStatus } from "@prisma/client";

export type LabelValidationInput = {
  bookingId: string;
  dispatchTimestamp: Date | null;
  arrivalTimestamp: Date | null;
  actualTravelDurationSec: number | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  partnerLatArrival: number | null;
  partnerLngArrival: number | null;
  travelDistanceMeters: number | null;
  googleEtaSeconds: number | null;
};

export type LabelValidationResult = {
  passed: boolean;
  status: EtaLabelStatus;
  qualityScore: number;
  rejectionReasons: string[];
};

const MAX_TRAVEL_SEC = 4 * 3600; // 4 hours
const MAX_GPS_JUMP_M = 50_000; // 50 km between dispatch and arrival coords

export function validateEtaLabel(input: LabelValidationInput): LabelValidationResult {
  const reasons: string[] = [];
  let score = 100;

  if (!input.dispatchTimestamp || !input.arrivalTimestamp) {
    reasons.push("missing_timestamps");
    score -= 40;
  }

  if (input.actualTravelDurationSec != null && input.actualTravelDurationSec < 0) {
    reasons.push("negative_duration");
    score -= 50;
  }

  if (input.actualTravelDurationSec != null && input.actualTravelDurationSec > MAX_TRAVEL_SEC) {
    reasons.push("duration_outlier");
    score -= 20;
  }

  if (input.arrivalTimestamp && input.arrivalTimestamp.getTime() > Date.now() + 60_000) {
    reasons.push("future_timestamp");
    score -= 30;
  }

  if (input.pickupLatitude != null && (input.pickupLatitude < -90 || input.pickupLatitude > 90)) {
    reasons.push("invalid_coordinates");
    score -= 30;
  }
  if (input.pickupLongitude != null && (input.pickupLongitude < -180 || input.pickupLongitude > 180)) {
    reasons.push("invalid_coordinates");
    score -= 30;
  }

  if (input.pickupLatitude === 0 && input.pickupLongitude === 0) {
    reasons.push("null_island_coordinates");
    score -= 25;
  }

  if (
    input.partnerLatArrival != null &&
    input.partnerLngArrival != null &&
    input.pickupLatitude != null &&
    input.pickupLongitude != null
  ) {
    const jumpM = haversineM(
      input.partnerLatArrival,
      input.partnerLngArrival,
      input.pickupLatitude,
      input.pickupLongitude,
    );
    if (jumpM > MAX_GPS_JUMP_M && input.travelDistanceMeters != null && input.travelDistanceMeters < 1000) {
      reasons.push("gps_jump");
      score -= 25;
    }
  }

  if (input.travelDistanceMeters != null && input.travelDistanceMeters < 0) {
    reasons.push("invalid_distance");
    score -= 30;
  }

  if (input.googleEtaSeconds != null && input.googleEtaSeconds <= 0) {
    reasons.push("invalid_google_eta");
    score -= 10;
  }

  const critical = reasons.some((r) =>
    ["missing_timestamps", "negative_duration", "future_timestamp", "invalid_coordinates"].includes(r),
  );

  const status: EtaLabelStatus = critical ? "REJECTED" : score >= 70 ? "TRAINING_READY" : score >= 50 ? "VALIDATED" : "REJECTED";

  return {
    passed: !critical && score >= 50,
    status,
    qualityScore: Math.max(0, Math.min(100, score)),
    rejectionReasons: reasons,
  };
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
