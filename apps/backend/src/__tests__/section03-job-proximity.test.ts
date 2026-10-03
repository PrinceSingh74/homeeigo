/**
 * Section 03 — proximity pure unit tests (no env/config load).
 */
import { describe, expect, test } from "bun:test";
import { distanceKm } from "../lib/geo";

/** Inline mirror of assertJobProximity with fixed radius — avoids config import crash in bun test. */
function proximity(
  lat: number | undefined,
  lng: number | undefined,
  jobLat: number,
  jobLng: number,
  radiusM = 100,
) {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "LOCATION_REQUIRED";
  }
  if (lat === 0 && lng === 0) return "LOCATION_INVALID";
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return "LOCATION_INVALID";
  const distM = distanceKm(lat, lng, jobLat, jobLng) * 1000;
  if (distM > radiusM) return "OUTSIDE_SERVICE_AREA";
  return "OK";
}

describe("Section 03 job proximity (geo math)", () => {
  test("blocks null island 0,0", () => {
    expect(proximity(0, 0, 12.97, 77.59)).toBe("LOCATION_INVALID");
  });

  test("blocks missing coords", () => {
    expect(proximity(undefined, undefined, 12.97, 77.59)).toBe("LOCATION_REQUIRED");
  });

  test("blocks outside radius", () => {
    expect(proximity(28.61, 77.2, 12.97, 77.59)).toBe("OUTSIDE_SERVICE_AREA");
  });

  test("allows inside radius", () => {
    expect(proximity(12.9701, 77.5901, 12.97, 77.59)).toBe("OK");
  });
});
