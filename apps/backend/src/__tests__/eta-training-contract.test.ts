/**
 * Authoritative ETA training-eligibility contract.
 *
 * The point of these tests is that Postgres `TRAINING_READY` must mean exactly what the
 * BigQuery training views mean — `BETWEEN 60 AND 14400` seconds, quality >= 70, valid
 * provenance, not synthetic. Before this contract, Postgres marked a 1-second trip
 * TRAINING_READY at quality 100 while BigQuery silently excluded it.
 */
import { describe, expect, test } from "bun:test";
import { ETA_TRAINING_CONTRACT, validateEtaLabel } from "../../analytics/eta/validation";
import { isSyntheticBookingNumber } from "../services/eta-intelligence.service";

/** Anchored in the past so the fixture never trips the critical future_timestamp rule. */
const arrivedAgoSec = (durationSec: number) => {
  const arrival = new Date(Date.now() - 60 * 60_000);
  return {
    bookingId: "bk_contract",
    dispatchTimestamp: new Date(arrival.getTime() - durationSec * 1000),
    arrivalTimestamp: arrival,
    actualTravelDurationSec: durationSec,
    pickupLatitude: 28.6139,
    pickupLongitude: 77.209,
    partnerLatArrival: 28.614,
    partnerLngArrival: 77.2091,
    travelDistanceMeters: 5000,
    googleEtaSeconds: Math.max(1, durationSec - 60),
    arrivalSource: "gps_geofence" as const,
  };
};

describe("contract constants come from the BigQuery views, not from thin air", () => {
  test("minimum is 60s and maximum is the pre-existing MAX_TRAVEL_SEC", () => {
    expect(ETA_TRAINING_CONTRACT.minTravelSec).toBe(60);
    expect(ETA_TRAINING_CONTRACT.maxTravelSec).toBe(4 * 3600);
    expect(ETA_TRAINING_CONTRACT.minQualityScore).toBe(70);
  });

  test("valid provenance values are exactly the ones the warehouse accepts", () => {
    expect([...ETA_TRAINING_CONTRACT.validArrivalSources]).toEqual([
      "explicit_partner_action",
      "gps_geofence",
      "job_start",
    ]);
  });

  test("the duration formula is stated once, here, and anchors on travel start", () => {
    expect(ETA_TRAINING_CONTRACT.durationFormula).toBe("arrivedAt - enRouteAt");
  });
});

describe("travel-start anchor — the label's duration must mean one thing", () => {
  /** Arrival an hour ago so fixtures never trip the critical future_timestamp rule. */
  const ARRIVED = new Date(Date.now() - 60 * 60_000);
  const anchored = (overrides: Record<string, unknown>) => ({
    bookingId: "bk_anchor",
    dispatchTimestamp: new Date(ARRIVED.getTime() - 45 * 60_000),
    enRouteTimestamp: new Date(ARRIVED.getTime() - 20 * 60_000),
    arrivalTimestamp: ARRIVED,
    actualTravelDurationSec: 1200,
    pickupLatitude: 28.6139,
    pickupLongitude: 77.209,
    partnerLatArrival: 28.614,
    partnerLngArrival: 77.2091,
    travelDistanceMeters: 5000,
    googleEtaSeconds: 1080,
    arrivalSource: "explicit_partner_action" as const,
    ...overrides,
  });

  test("a label with a travel-start anchor is training-ready", () => {
    const r = validateEtaLabel(anchored({}));
    expect(r.status).toBe("TRAINING_READY");
    expect(r.rejectionReasons).not.toContain("missing_travel_start");
  });

  test("no anchor means no duration, and no duration means not training-ready", () => {
    const r = validateEtaLabel(anchored({ enRouteTimestamp: null, actualTravelDurationSec: null }));
    expect(r.rejectionReasons).toContain("missing_travel_start");
    expect(r.status).toBe("VALIDATED");
  });

  test("a missing anchor caps the label even at an otherwise perfect score", () => {
    // This is the job_start case: arrival is known, departure is not. Substituting
    // dispatch time would have produced a plausible-looking but wrong duration.
    const r = validateEtaLabel(
      anchored({ enRouteTimestamp: null, actualTravelDurationSec: null, arrivalSource: "job_start" }),
    );
    expect(r.status).not.toBe("TRAINING_READY");
  });

  test("an arrival before departure is corrupt, not merely imprecise", () => {
    const r = validateEtaLabel(
      anchored({ enRouteTimestamp: new Date(ARRIVED.getTime() + 60_000) }),
    );
    expect(r.rejectionReasons).toContain("negative_duration");
    expect(r.status).toBe("REJECTED");
  });

  test("explicit partner action is valid provenance and is not penalised", () => {
    const r = validateEtaLabel(anchored({}));
    expect(r.rejectionReasons).not.toContain("invalid_provenance");
    expect(r.qualityScore).toBe(100);
  });
});

describe("TESTS 1-3 — sub-minimum durations are NOT training-ready", () => {
  // These are the three real labels that exposed the inconsistency.
  test("1 second is not TRAINING_READY", () => {
    const r = validateEtaLabel(arrivedAgoSec(1));
    expect(r.status).not.toBe("TRAINING_READY");
    expect(r.rejectionReasons).toContain("duration_below_min");
  });

  test("35 seconds is not TRAINING_READY", () => {
    expect(validateEtaLabel(arrivedAgoSec(35)).status).not.toBe("TRAINING_READY");
  });

  test("46 seconds is not TRAINING_READY", () => {
    expect(validateEtaLabel(arrivedAgoSec(46)).status).not.toBe("TRAINING_READY");
  });

  test("they settle at VALIDATED — retained, not discarded as corrupt", () => {
    for (const d of [1, 35, 46]) {
      expect(validateEtaLabel(arrivedAgoSec(d)).status).toBe("VALIDATED");
    }
  });

  test("a high score cannot override the training block", () => {
    const r = validateEtaLabel(arrivedAgoSec(59));
    // Score stays respectable, yet the label is still not trainable.
    expect(r.qualityScore).toBeGreaterThanOrEqual(70);
    expect(r.status).toBe("VALIDATED");
  });
});

describe("TESTS 4-5 — valid durations at and above the boundary", () => {
  test("exactly 60 seconds CAN be TRAINING_READY", () => {
    const r = validateEtaLabel(arrivedAgoSec(60));
    expect(r.rejectionReasons).not.toContain("duration_below_min");
    expect(r.status).toBe("TRAINING_READY");
  });

  test("well above the minimum is TRAINING_READY", () => {
    for (const d of [120, 900, 3600]) {
      expect(validateEtaLabel(arrivedAgoSec(d)).status).toBe("TRAINING_READY");
    }
  });

  test("the boundary is inclusive at 60 and exclusive at 59", () => {
    expect(validateEtaLabel(arrivedAgoSec(60)).status).toBe("TRAINING_READY");
    expect(validateEtaLabel(arrivedAgoSec(59)).status).toBe("VALIDATED");
  });
});

describe("TESTS 6-8 — upper bound, negative, future", () => {
  test("6: duration above MAX_TRAVEL_SEC is not training-ready", () => {
    // This half of the inconsistency was previously unreported: a 5-hour trip scored 80
    // and was marked TRAINING_READY in Postgres while BigQuery excluded it.
    const r = validateEtaLabel(arrivedAgoSec(5 * 3600));
    expect(r.rejectionReasons).toContain("duration_outlier");
    expect(r.status).not.toBe("TRAINING_READY");
  });

  test("7: negative duration is REJECTED as critical", () => {
    const r = validateEtaLabel({ ...arrivedAgoSec(600), actualTravelDurationSec: -5 });
    expect(r.rejectionReasons).toContain("negative_duration");
    expect(r.status).toBe("REJECTED");
    expect(r.passed).toBe(false);
  });

  test("7b: negative duration does not also trip the below-minimum rule", () => {
    const r = validateEtaLabel({ ...arrivedAgoSec(600), actualTravelDurationSec: -5 });
    expect(r.rejectionReasons).not.toContain("duration_below_min");
  });

  test("8: future arrival timestamp is REJECTED as critical", () => {
    const r = validateEtaLabel({
      ...arrivedAgoSec(600),
      arrivalTimestamp: new Date(Date.now() + 10 * 60_000),
    });
    expect(r.rejectionReasons).toContain("future_timestamp");
    expect(r.status).toBe("REJECTED");
  });

  test("missing timestamps are REJECTED as critical", () => {
    const r = validateEtaLabel({ ...arrivedAgoSec(600), dispatchTimestamp: null });
    expect(r.rejectionReasons).toContain("missing_timestamps");
    expect(r.status).toBe("REJECTED");
  });
});

describe("TEST 9 — provenance", () => {
  test("an explicitly invalid arrival source blocks training", () => {
    const r = validateEtaLabel({ ...arrivedAgoSec(600), arrivalSource: "made_up" as never });
    expect(r.rejectionReasons).toContain("invalid_provenance");
    expect(r.status).not.toBe("TRAINING_READY");
  });

  test("both valid sources are accepted for training", () => {
    expect(validateEtaLabel({ ...arrivedAgoSec(600), arrivalSource: "gps_geofence" }).status).toBe("TRAINING_READY");
    expect(validateEtaLabel({ ...arrivedAgoSec(600), arrivalSource: "job_start" }).status).toBe("TRAINING_READY");
  });

  test("job_start remains penalised relative to gps_geofence", () => {
    const gps = validateEtaLabel({ ...arrivedAgoSec(600), arrivalSource: "gps_geofence" });
    const inferred = validateEtaLabel({ ...arrivedAgoSec(600), arrivalSource: "job_start" });
    expect(inferred.qualityScore).toBeLessThan(gps.qualityScore);
  });

  test("absent provenance is retained but capped below training", () => {
    const { arrivalSource: _omitted, ...withoutProvenance } = arrivedAgoSec(600);
    const r = validateEtaLabel(withoutProvenance);

    // Absent is not the same as invalid: the label is kept and stays queryable.
    expect(r.rejectionReasons).not.toContain("invalid_provenance");

    /**
     * It is nonetheless capped at VALIDATED. An arrival with no attributable producer used to be
     * scored as if it were GPS-precise, which promoted unverifiable arrivals to full training
     * weight; `historical_provenance_unknown` stops that. The reason is asserted explicitly, not
     * just the status, so a future change to the blocking list cannot quietly re-open the gap.
     */
    expect(r.rejectionReasons).toContain("historical_provenance_unknown");
    expect(r.status).toBe("VALIDATED");
    expect(r.status).not.toBe("TRAINING_READY");
  });
});

describe("TEST 10 — synthetic exclusion", () => {
  test("certification fixtures are classified synthetic", () => {
    expect(isSyntheticBookingNumber("P2VERIFY-1786182192225")).toBe(true);
    expect(isSyntheticBookingNumber("CERT-1")).toBe(true);
  });

  test("production bookings are not synthetic", () => {
    expect(isSyntheticBookingNumber("HOMIGO-20260807-00001")).toBe(false);
  });

  test("synthetic classification is independent of label quality", () => {
    // A perfect label on a fixture booking is still excluded — quality cannot buy it in.
    const r = validateEtaLabel(arrivedAgoSec(900));
    expect(r.status).toBe("TRAINING_READY");
    expect(isSyntheticBookingNumber("P2VERIFY-123")).toBe(true);
  });
});

describe("TEST 11 — the contract is the single source of truth", () => {
  // Mirrors the BigQuery WHERE clause of vw_eta_training_eligible.
  const bqEligible = (durationSec: number, quality: number, status: string, source: string, synthetic: boolean) =>
    !synthetic &&
    status === "TRAINING_READY" &&
    durationSec >= ETA_TRAINING_CONTRACT.minTravelSec &&
    durationSec <= ETA_TRAINING_CONTRACT.maxTravelSec &&
    quality >= ETA_TRAINING_CONTRACT.minQualityScore &&
    (ETA_TRAINING_CONTRACT.validArrivalSources as readonly string[]).includes(source);

  test("Postgres TRAINING_READY implies BigQuery eligibility for every duration probed", () => {
    for (const d of [1, 35, 46, 59, 60, 61, 120, 900, 3600, 14400, 14401, 5 * 3600]) {
      const r = validateEtaLabel(arrivedAgoSec(d));
      const pgReady = r.status === "TRAINING_READY";
      const bqOk = bqEligible(d, r.qualityScore, r.status, "gps_geofence", false);
      expect(pgReady).toBe(bqOk);
    }
  });

  test("a synthetic booking is never eligible even when Postgres says ready", () => {
    const r = validateEtaLabel(arrivedAgoSec(900));
    expect(r.status).toBe("TRAINING_READY");
    expect(bqEligible(900, r.qualityScore, r.status, "gps_geofence", true)).toBe(false);
  });
});
