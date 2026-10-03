import { eventPlatformConfig } from "../events/core/config";
import { distanceKm } from "../lib/geo";

export type ProximityError =
  | "LOCATION_INVALID"
  | "LOCATION_REQUIRED"
  | "OUTSIDE_SERVICE_AREA";

export type ProximityOk = {
  ok: true;
  distanceM: number | null;
  radiusM: number;
};

export type ProximityFail = {
  ok: false;
  error: ProximityError;
  distanceM: number | null;
  radiusM: number;
};

/**
 * Explicit Arrive/Start presence check — same radius as GPS geofence (`arrivalRadiusM`).
 * Does not invent a second geo engine.
 */
export function assertJobProximity(input: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  jobLatitude: number | null | undefined;
  jobLongitude: number | null | undefined;
  /** When false, only validate coordinate shape (used by en-route). Default true. */
  enforceRadius?: boolean;
  /** Test override — defaults to eventPlatformConfig.arrivalRadiusM */
  radiusM?: number;
}): ProximityOk | ProximityFail {
  const radiusM = input.radiusM ?? eventPlatformConfig.arrivalRadiusM;
  const lat = input.latitude;
  const lng = input.longitude;

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "LOCATION_REQUIRED", distanceM: null, radiusM };
  }

  // Null island / soft GPS fallback must not satisfy presence.
  if (lat === 0 && lng === 0) {
    return { ok: false, error: "LOCATION_INVALID", distanceM: null, radiusM };
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: "LOCATION_INVALID", distanceM: null, radiusM };
  }

  const enforce = input.enforceRadius !== false;
  const jobLat = input.jobLatitude;
  const jobLng = input.jobLongitude;

  if (!enforce || jobLat == null || jobLng == null || !Number.isFinite(jobLat) || !Number.isFinite(jobLng)) {
    return { ok: true, distanceM: null, radiusM };
  }

  const distM = distanceKm(lat, lng, jobLat, jobLng) * 1000;
  if (distM > radiusM) {
    return { ok: false, error: "OUTSIDE_SERVICE_AREA", distanceM: Math.round(distM), radiusM };
  }

  return { ok: true, distanceM: Math.round(distM), radiusM };
}
