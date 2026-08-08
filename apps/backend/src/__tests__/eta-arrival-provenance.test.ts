import { describe, expect, test } from "bun:test";
import { validateEtaLabel } from "../../analytics/eta/validation";
import { buildPartnerArrivedEvent } from "../events/catalog/partner.events";

// Relative to now, so the fixture never drifts into the future and trips the
// future_timestamp rule (which is critical and would reject the label outright).
const ARRIVED = new Date(Date.now() - 60 * 60_000);
const DISPATCHED = new Date(ARRIVED.getTime() - 20 * 60_000);

const baseLabel = {
  bookingId: "bk_1",
  dispatchTimestamp: DISPATCHED,
  arrivalTimestamp: ARRIVED,
  actualTravelDurationSec: 1200,
  pickupLatitude: 28.6139,
  pickupLongitude: 77.209,
  partnerLatArrival: 28.6140,
  partnerLngArrival: 77.2091,
  travelDistanceMeters: 5000,
  googleEtaSeconds: 1080,
};

describe("arrival provenance on the event", () => {
  test("defaults to gps_geofence when the caller does not specify", () => {
    const ev = buildPartnerArrivedEvent({
      providerId: "p1", bookingId: "bk_1", arrivedAt: new Date(),
      dispatchedAt: new Date(), enRouteAt: new Date(), travelDurationMin: 20,
      city: "Delhi", serviceCategory: "cleaning", distanceKm: 5, googleEtaMin: 18,
    });
    expect(ev.data.arrivalSource).toBe("gps_geofence");
  });

  test("carries job_start when arrival was inferred at start", () => {
    const ev = buildPartnerArrivedEvent({
      providerId: "p1", bookingId: "bk_1", arrivedAt: new Date(),
      dispatchedAt: new Date(), enRouteAt: null, travelDurationMin: null,
      city: "Delhi", serviceCategory: "cleaning", distanceKm: 5, googleEtaMin: 18,
      arrivalSource: "job_start",
    });
    expect(ev.data.arrivalSource).toBe("job_start");
  });

  test("provenance survives PII sanitisation of the payload", () => {
    const ev = buildPartnerArrivedEvent({
      providerId: "p1", bookingId: "bk_1", arrivedAt: new Date(),
      dispatchedAt: null, enRouteAt: null, travelDurationMin: null,
      city: null, serviceCategory: null, distanceKm: null, googleEtaMin: null,
      arrivalSource: "job_start",
    });
    expect(JSON.parse(JSON.stringify(ev)).data.arrivalSource).toBe("job_start");
  });
});

describe("validation scores arrival precision honestly", () => {
  test("a GPS-geofenced arrival is unpenalised", () => {
    const r = validateEtaLabel({ ...baseLabel, arrivalSource: "gps_geofence" });
    expect(r.qualityScore).toBe(100);
    expect(r.rejectionReasons).not.toContain("arrival_inferred_from_job_start");
    expect(r.status).toBe("TRAINING_READY");
  });

  test("omitting provenance behaves like the precise path (back-compat)", () => {
    const r = validateEtaLabel(baseLabel);
    expect(r.qualityScore).toBe(100);
  });

  test("a job_start arrival is penalised but still usable", () => {
    const r = validateEtaLabel({ ...baseLabel, arrivalSource: "job_start" });
    expect(r.qualityScore).toBe(85);
    expect(r.rejectionReasons).toContain("arrival_inferred_from_job_start");
    // Still above the 70 threshold — a real trip, just less precise.
    expect(r.status).toBe("TRAINING_READY");
    expect(r.passed).toBe(true);
  });

  test("inferred arrival scores strictly below a geofenced one", () => {
    const precise = validateEtaLabel({ ...baseLabel, arrivalSource: "gps_geofence" });
    const inferred = validateEtaLabel({ ...baseLabel, arrivalSource: "job_start" });
    expect(inferred.qualityScore).toBeLessThan(precise.qualityScore);
  });

  test("the penalty is not enough to mask a genuinely corrupt label", () => {
    // Negative duration is critical regardless of how arrival was captured.
    const r = validateEtaLabel({
      ...baseLabel, arrivalSource: "job_start", actualTravelDurationSec: -5,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.passed).toBe(false);
  });

  test("inferred arrival stacking with a soft defect drops out of TRAINING_READY", () => {
    // job_start (-15) + duration_outlier (-20) = 65 -> VALIDATED, not TRAINING_READY.
    const r = validateEtaLabel({
      ...baseLabel, arrivalSource: "job_start", actualTravelDurationSec: 5 * 3600,
    });
    expect(r.qualityScore).toBe(65);
    expect(r.status).toBe("VALIDATED");
  });
});
