import { distanceKm } from "./geo";
import {
  LOCATION_DUPLICATE_WINDOW_SEC,
  LOCATION_MAX_SPEED_KMH,
  TIMESTAMP_FUTURE_TOLERANCE_SEC,
  TIMESTAMP_MAX_AGE_SEC,
} from "./partner-presence.config";

export type LocationValidationError =
  | "INVALID_LATITUDE"
  | "INVALID_LONGITUDE"
  | "INVALID_ACCURACY"
  | "TIMESTAMP_FUTURE"
  | "TIMESTAMP_TOO_OLD"
  | "SEQUENCE_REGRESSION"
  | "DUPLICATE_LOCATION"
  | "IMPOSSIBLE_JUMP";

export type LocationPoint = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt: Date;
  sequence?: number | null;
};

export type PriorLocation = {
  latitude: number;
  longitude: number;
  capturedAt: Date;
  sequence?: number | null;
};

export type LocationValidationResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; code: LocationValidationError; message: string };

function isNullIsland(lat: number, lng: number): boolean {
  return Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001;
}

/** Phase 1 basic validation — not anti-spoofing. */
export function validatePresenceLocation(
  point: LocationPoint,
  prior: PriorLocation | null,
  now: Date = new Date(),
): LocationValidationResult {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) {
    return { ok: false, code: "INVALID_LATITUDE", message: "Latitude must be between -90 and 90" };
  }
  if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    return { ok: false, code: "INVALID_LONGITUDE", message: "Longitude must be between -180 and 180" };
  }
  if (isNullIsland(point.latitude, point.longitude)) {
    return { ok: false, code: "INVALID_LATITUDE", message: "Null-island coordinates rejected" };
  }
  if (point.accuracy != null) {
    if (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 50_000) {
      return { ok: false, code: "INVALID_ACCURACY", message: "Accuracy must be between 0 and 50000 meters" };
    }
  }

  const capturedMs = point.capturedAt.getTime();
  const nowMs = now.getTime();
  const futureSkewSec = (capturedMs - nowMs) / 1000;
  if (futureSkewSec > TIMESTAMP_FUTURE_TOLERANCE_SEC) {
    return { ok: false, code: "TIMESTAMP_FUTURE", message: "Location timestamp is in the future" };
  }
  const ageSec = (nowMs - capturedMs) / 1000;
  if (ageSec > TIMESTAMP_MAX_AGE_SEC) {
    return { ok: false, code: "TIMESTAMP_TOO_OLD", message: "Location timestamp is too old" };
  }

  if (prior) {
    if (
      point.sequence != null &&
      prior.sequence != null &&
      point.sequence <= prior.sequence
    ) {
      return { ok: false, code: "SEQUENCE_REGRESSION", message: "Location sequence must increase" };
    }

    const elapsedSec = Math.max(0.001, (capturedMs - prior.capturedAt.getTime()) / 1000);
    const movedKm = distanceKm(prior.latitude, prior.longitude, point.latitude, point.longitude);
    const speedKmh = (movedKm / elapsedSec) * 3600;

    if (speedKmh > LOCATION_MAX_SPEED_KMH) {
      return {
        ok: false,
        code: "IMPOSSIBLE_JUMP",
        message: `Location jump implies ${Math.round(speedKmh)} km/h which exceeds threshold`,
      };
    }

    const sameCoords =
      Math.abs(point.latitude - prior.latitude) < 1e-6 &&
      Math.abs(point.longitude - prior.longitude) < 1e-6;
    if (sameCoords && elapsedSec <= LOCATION_DUPLICATE_WINDOW_SEC) {
      return { ok: true, duplicate: true };
    }
  }

  return { ok: true };
}

export function validateClientTimestamp(
  clientTimestamp: Date,
  now: Date = new Date(),
): LocationValidationResult {
  const nowMs = now.getTime();
  const tsMs = clientTimestamp.getTime();
  const futureSkewSec = (tsMs - nowMs) / 1000;
  if (futureSkewSec > TIMESTAMP_FUTURE_TOLERANCE_SEC) {
    return { ok: false, code: "TIMESTAMP_FUTURE", message: "Client timestamp is in the future" };
  }
  const ageSec = (nowMs - tsMs) / 1000;
  if (ageSec > TIMESTAMP_MAX_AGE_SEC) {
    return { ok: false, code: "TIMESTAMP_TOO_OLD", message: "Client timestamp is too old" };
  }
  return { ok: true };
}
