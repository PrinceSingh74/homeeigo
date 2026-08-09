import { describe, expect, test } from "bun:test";
import { validateEtaLabel } from "../../analytics/eta/validation";
import {
  buildPartnerArrivedEvent,
  buildPartnerEnRouteEvent,
} from "../events/catalog/partner.events";

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

describe("travel-start provenance on the en_route event", () => {
  const base = {
    providerId: "p1",
    bookingId: "bk_1",
    enRouteAt: new Date(),
    distanceKm: 5,
    googleEtaMin: 18,
  };

  test("defaults to gps_geofence — the only pre-existing producer", () => {
    expect(buildPartnerEnRouteEvent(base).data.enRouteSource).toBe("gps_geofence");
  });

  test("carries explicit_partner_action when the partner declared departure", () => {
    const ev = buildPartnerEnRouteEvent({ ...base, enRouteSource: "explicit_partner_action" });
    expect(ev.data.enRouteSource).toBe("explicit_partner_action");
  });

  test("provenance survives PII sanitisation of the payload", () => {
    const ev = buildPartnerEnRouteEvent({ ...base, enRouteSource: "explicit_partner_action" });
    expect(JSON.parse(JSON.stringify(ev)).data.enRouteSource).toBe("explicit_partner_action");
  });

  test("the event stays on the canonical homigo namespace", () => {
    // Legacy `eta.*` records are permanently FAILED in the outbox because the namespace
    // validator rejects them. No current producer may reintroduce that prefix.
    expect(buildPartnerEnRouteEvent(base).type.startsWith("homigo.")).toBe(true);
  });
});

describe("an explicit arrival is the most precise provenance", () => {
  test("the arrived event carries explicit_partner_action", () => {
    const ev = buildPartnerArrivedEvent({
      providerId: "p1", bookingId: "bk_1", arrivedAt: new Date(),
      dispatchedAt: new Date(), enRouteAt: new Date(), travelDurationMin: 20,
      city: "Delhi", serviceCategory: "cleaning", distanceKm: 5, googleEtaMin: 18,
      arrivalSource: "explicit_partner_action",
    });
    expect(ev.data.arrivalSource).toBe("explicit_partner_action");
  });

  test("it is unpenalised — unlike job_start, nothing about it is inferred", () => {
    const r = validateEtaLabel({
      ...baseLabel,
      enRouteTimestamp: new Date(ARRIVED.getTime() - 20 * 60_000),
      arrivalSource: "explicit_partner_action",
    });
    expect(r.qualityScore).toBe(100);
    expect(r.rejectionReasons).not.toContain("arrival_inferred_from_job_start");
    expect(r.status).toBe("TRAINING_READY");
  });
});

describe("validation scores arrival precision honestly", () => {
  test("a GPS-geofenced arrival is unpenalised", () => {
    const r = validateEtaLabel({ ...baseLabel, arrivalSource: "gps_geofence" });
    expect(r.qualityScore).toBe(100);
    expect(r.rejectionReasons).not.toContain("arrival_inferred_from_job_start");
    expect(r.status).toBe("TRAINING_READY");
  });

  test("unresolvable provenance is NOT treated as the precise path", () => {
    // Previously an omitted value scored 100, silently promoting an arrival nobody could
    // attribute to full training weight. Unknown must never read as GPS-precise.
    const r = validateEtaLabel(baseLabel);
    expect(r.rejectionReasons).toContain("historical_provenance_unknown");
    expect(r.qualityScore).toBeLessThan(100);
    expect(r.status).not.toBe("TRAINING_READY");
  });

  test("unknown provenance is retained, not discarded as corrupt", () => {
    expect(validateEtaLabel(baseLabel).status).toBe("VALIDATED");
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
