/**
 * Phase 2 — ETA label validation unit tests (no DB required).
 */
import { describe, expect, test } from "bun:test";
import { validateEtaLabel } from "../../analytics/eta/validation";
import { engineerEtaFeatures } from "../../analytics/eta/feature-engineering";

describe("ETA label validation", () => {
  test("accepts valid label", () => {
    const result = validateEtaLabel({
      bookingId: "b1",
      dispatchTimestamp: new Date(Date.now() - 600_000),
      arrivalTimestamp: new Date(),
      actualTravelDurationSec: 600,
      pickupLatitude: 28.6,
      pickupLongitude: 77.2,
      partnerLatArrival: 28.61,
      partnerLngArrival: 77.21,
      travelDistanceMeters: 1500,
      googleEtaSeconds: 540,
      // Both a travel-start anchor and resolvable provenance are now required for
      // TRAINING_READY; a label lacking either is retained but not trainable.
      enRouteTimestamp: new Date(Date.now() - 600_000),
      arrivalSource: "gps_geofence",
    });
    expect(result.passed).toBe(true);
    expect(result.status).toBe("TRAINING_READY");
    expect(result.qualityScore).toBeGreaterThanOrEqual(70);
  });

  test("rejects negative duration", () => {
    const result = validateEtaLabel({
      bookingId: "b2",
      dispatchTimestamp: new Date(),
      arrivalTimestamp: new Date(Date.now() - 1000),
      actualTravelDurationSec: -60,
      pickupLatitude: 28.6,
      pickupLongitude: 77.2,
      partnerLatArrival: 28.6,
      partnerLngArrival: 77.2,
      travelDistanceMeters: 100,
      googleEtaSeconds: 120,
    });
    expect(result.passed).toBe(false);
    expect(result.rejectionReasons).toContain("negative_duration");
  });

  test("rejects missing timestamps", () => {
    const result = validateEtaLabel({
      bookingId: "b3",
      dispatchTimestamp: null,
      arrivalTimestamp: null,
      actualTravelDurationSec: null,
      pickupLatitude: 28.6,
      pickupLongitude: 77.2,
      partnerLatArrival: null,
      partnerLngArrival: null,
      travelDistanceMeters: null,
      googleEtaSeconds: null,
    });
    expect(result.passed).toBe(false);
    expect(result.rejectionReasons).toContain("missing_timestamps");
  });
});

describe("ETA feature engineering", () => {
  test("computes bearing and buckets", () => {
    const features = engineerEtaFeatures({
      dispatchTimestamp: new Date(Date.now() - 900_000),
      arrivalTimestamp: new Date(),
      partnerLatDispatch: 28.55,
      partnerLngDispatch: 77.15,
      partnerLatArrival: 28.61,
      partnerLngArrival: 77.21,
      pickupLatitude: 28.61,
      pickupLongitude: 77.21,
      travelDistanceMeters: 3200,
      actualTravelDurationSec: 900,
      googleEtaSeconds: 840,
      rain: 0,
      temperature: 32,
      historicalRouteCount: 25,
      historicalAvgDuration: 14,
    });
    expect(features.bearing).not.toBeNull();
    expect(features.distanceBucket).toBe("medium");
    expect(features.averageSpeed).toBeGreaterThan(0);
    expect(features.partnerFamiliarity).toBe(0.5);
  });
});
