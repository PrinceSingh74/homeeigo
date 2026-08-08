/**
 * Phase 2 — ETA label validation rules.
 * Rejects corrupt, incomplete, or anomalous training labels before warehouse load.
 */
import type { EtaLabelStatus } from "@prisma/client";

/** How the arrival timestamp was established — mirrors the partner.arrived event. */
export type ArrivalProvenance = "gps_geofence" | "job_start";

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
  /** Defaults to gps_geofence for labels created before provenance was tracked. */
  arrivalSource?: ArrivalProvenance;
};

export type LabelValidationResult = {
  passed: boolean;
  status: EtaLabelStatus;
  qualityScore: number;
  rejectionReasons: string[];
};

/**
 * Authoritative ETA training-duration window.
 *
 * Both bounds mirror the BigQuery training views (`vw_eta_training_eligible`,
 * `fs_eta_features_v2`, `vw_train_eta_v2`), which have gated on
 * `BETWEEN 60 AND 14400` seconds since the original Phase 2 commit 7ff5683.
 * Neither number is invented here — this makes Postgres agree with the warehouse
 * instead of silently disagreeing with it.
 */
const MIN_TRAVEL_SEC = 60; // below one minute a dispatch->arrival gap is not a real trip
const MAX_TRAVEL_SEC = 4 * 3600; // 4 hours
const MAX_GPS_JUMP_M = 50_000; // 50 km between dispatch and arrival coords

/**
 * Reasons that make a label unusable for training even when its quality score is high.
 *
 * Distinct from `CRITICAL_REASONS`: the data is not corrupt, it simply falls outside the
 * training contract. Such a label settles at VALIDATED — retained and queryable, never
 * TRAINING_READY. A score penalty alone would not do: BigQuery hard-excludes these rows in
 * a WHERE clause, so Postgres must hard-exclude them too or the two contracts drift again.
 */
const TRAINING_BLOCKING_REASONS = [
  "duration_below_min",
  "duration_outlier",
  "invalid_provenance",
] as const;

const CRITICAL_REASONS = [
  "missing_timestamps",
  "negative_duration",
  "future_timestamp",
  "invalid_coordinates",
] as const;

const VALID_ARRIVAL_SOURCES = ["gps_geofence", "job_start"] as const;

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

  // Lower bound of the training window. A sub-minute dispatch->arrival gap is not a
  // physically real trip, so it cannot supervise an ETA model.
  if (
    input.actualTravelDurationSec != null &&
    input.actualTravelDurationSec >= 0 &&
    input.actualTravelDurationSec < MIN_TRAVEL_SEC
  ) {
    reasons.push("duration_below_min");
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

  // An arrival inferred at job start is later than the true arrival by however long the
  // partner idled before beginning work. The label is still usable — it is a real trip —
  // but it must not be weighted as equal to a GPS-geofenced arrival.
  if (input.arrivalSource === "job_start") {
    reasons.push("arrival_inferred_from_job_start");
    score -= 15;
  }

  // Provenance must be resolvable for a trainer to weight arrival precision. An absent
  // value is tolerated for labels captured before provenance tracking existed; an
  // explicitly wrong one is not.
  if (input.arrivalSource != null && !VALID_ARRIVAL_SOURCES.includes(input.arrivalSource)) {
    reasons.push("invalid_provenance");
    score -= 20;
  }

  const critical = reasons.some((r) => (CRITICAL_REASONS as readonly string[]).includes(r));

  // A training-blocking reason caps the label at VALIDATED no matter how high the score
  // is. This is what keeps Postgres TRAINING_READY and BigQuery training-eligibility
  // meaning the same thing.
  const trainingBlocked = reasons.some((r) => (TRAINING_BLOCKING_REASONS as readonly string[]).includes(r));

  const status: EtaLabelStatus = critical
    ? "REJECTED"
    : score < 50
      ? "REJECTED"
      : trainingBlocked
        ? "VALIDATED"
        : score >= 70
          ? "TRAINING_READY"
          : "VALIDATED";

  return {
    passed: !critical && score >= 50,
    status,
    qualityScore: Math.max(0, Math.min(100, score)),
    rejectionReasons: reasons,
  };
}

/** The authoritative training window, exported so callers and docs cannot drift from it. */
export const ETA_TRAINING_CONTRACT = {
  minTravelSec: MIN_TRAVEL_SEC,
  maxTravelSec: MAX_TRAVEL_SEC,
  minQualityScore: 70,
  validArrivalSources: VALID_ARRIVAL_SOURCES,
  trainingBlockingReasons: TRAINING_BLOCKING_REASONS,
  criticalReasons: CRITICAL_REASONS,
} as const;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
