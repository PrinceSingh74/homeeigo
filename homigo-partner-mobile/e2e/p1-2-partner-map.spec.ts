import { expect, test } from "@playwright/test";
import {
  buildMapJobs,
  classifyLocation,
  fitRegion,
  formatEta,
  STALE_LOCATION_MS,
} from "../src/lib/partner-map";
import { decodePolyline } from "../src/lib/polyline";
import type { PartnerBooking, RouteStop } from "../src/types/partner";

/**
 * P1-2 — partner in-app map.
 *
 * The map's decision logic (which jobs are drawable, live-vs-stale classification, region fitting,
 * route enrichment) lives in RN-free pure modules precisely so it can be tested here in plain Node
 * without a device or emulator. Server-side authorization is NOT re-tested here — it is enforced by
 * `requireProvider()` + a `providerId`-scoped query in `/api/providers/me/route/optimize` and
 * `/api/bookings` (verified during discovery), and is covered by the API-level suite below.
 */

function booking(over: Partial<PartnerBooking> & { id: string }): PartnerBooking {
  return {
    bookingNumber: `HG-${over.id}`,
    status: "accepted",
    scheduledDate: new Date().toISOString(),
    completedAt: null,
    enRouteAt: null,
    arrivedAt: null,
    startedAt: null,
    amount: 500,
    finalAmount: 500,
    paymentStatus: "SUCCESS",
    description: null,
    eta: null,
    customer: { firstName: "A", lastName: "B", profileImage: null },
    service: { id: "svc", name: "Bathroom Cleaning", icon: null, basePrice: 500 },
    address: { fullAddress: "1 Test Street, Noida", latitude: 28.62, longitude: 77.37 },
    ...over,
  } as PartnerBooking;
}

test.describe("P1-2 buildMapJobs — only drawable, authorized jobs become markers", () => {
  test("bookings with real coordinates become markers", () => {
    const jobs = buildMapJobs([booking({ id: "a" }), booking({ id: "b" })]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.coords).toEqual({ latitude: 28.62, longitude: 77.37 });
  });

  test("null-island (0,0) is excluded — it is the platform's 'no fix' sentinel, not a location", () => {
    const jobs = buildMapJobs([
      booking({ id: "real" }),
      booking({ id: "nullisland", address: { fullAddress: "x", latitude: 0, longitude: 0 } }),
    ]);
    expect(jobs.map((j) => j.bookingId)).toEqual(["real"]);
  });

  test("missing / null / non-finite coordinates are excluded rather than defaulted", () => {
    const jobs = buildMapJobs([
      booking({ id: "nullcoords", address: { fullAddress: "x", latitude: null, longitude: null } }),
      booking({ id: "nan", address: { fullAddress: "x", latitude: NaN, longitude: 10 } }),
      booking({ id: "outofrange", address: { fullAddress: "x", latitude: 999, longitude: 10 } }),
    ]);
    expect(jobs).toHaveLength(0);
  });

  test("route stops enrich matching jobs with order + cumulative ETA, and drive marker ordering", () => {
    const stops: RouteStop[] = [
      { bookingId: "b", order: 1, lat: 28.6, lng: 77.3, status: null, distanceFromPrevKm: 1, etaFromPrevMin: 5, cumulativeEtaMin: 5 },
      { bookingId: "a", order: 2, lat: 28.7, lng: 77.4, status: null, distanceFromPrevKm: 2, etaFromPrevMin: 9, cumulativeEtaMin: 14 },
    ];
    const jobs = buildMapJobs([booking({ id: "a" }), booking({ id: "b" })], stops);
    expect(jobs.map((j) => j.bookingId)).toEqual(["b", "a"]);
    expect(jobs[0]!.order).toBe(1);
    expect(jobs[1]!.cumulativeEtaMin).toBe(14);
  });

  test("jobs absent from the route still render, ordered after routed ones (route is enrichment, not a filter)", () => {
    const stops: RouteStop[] = [
      { bookingId: "a", order: 1, lat: 28.6, lng: 77.3, status: null, distanceFromPrevKm: 0, etaFromPrevMin: 0, cumulativeEtaMin: 3 },
    ];
    const jobs = buildMapJobs([booking({ id: "a" }), booking({ id: "z" })], stops);
    expect(jobs.map((j) => j.bookingId)).toEqual(["a", "z"]);
    expect(jobs[1]!.order).toBeUndefined();
  });

  test("no bookings, undefined bookings, and a failed route all yield an empty marker set without throwing", () => {
    expect(buildMapJobs([])).toEqual([]);
    expect(buildMapJobs(undefined)).toEqual([]);
    expect(buildMapJobs([booking({ id: "a" })], undefined)).toHaveLength(1);
  });
});

test.describe("P1-2 classifyLocation — a stale fix is never presented as live", () => {
  const coords = { latitude: 28.62, longitude: 77.37 };
  const now = 1_800_000_000_000;

  test("a fresh fix is live", () => {
    expect(classifyLocation(coords, now - 5_000, now).kind).toBe("live");
  });

  test("a fix older than the stale window is stale, and keeps its original timestamp", () => {
    const state = classifyLocation(coords, now - (STALE_LOCATION_MS + 1_000), now);
    expect(state.kind).toBe("stale");
    if (state.kind === "stale") expect(state.at).toBe(now - (STALE_LOCATION_MS + 1_000));
  });

  test("exactly at the boundary is still live; one ms past is stale", () => {
    expect(classifyLocation(coords, now - STALE_LOCATION_MS, now).kind).toBe("live");
    expect(classifyLocation(coords, now - STALE_LOCATION_MS - 1, now).kind).toBe("stale");
  });

  test("missing coords, missing timestamp, or null-island are all 'unavailable' — never a fake position", () => {
    expect(classifyLocation(null, now, now).kind).toBe("unavailable");
    expect(classifyLocation(coords, null, now).kind).toBe("unavailable");
    expect(classifyLocation({ latitude: 0, longitude: 0 }, now, now).kind).toBe("unavailable");
  });
});

test.describe("P1-2 fitRegion — sensible viewport, never a world view", () => {
  test("covers partner and all jobs", () => {
    const jobs = buildMapJobs([
      booking({ id: "a", address: { fullAddress: "x", latitude: 28.5, longitude: 77.2 } }),
      booking({ id: "b", address: { fullAddress: "x", latitude: 28.7, longitude: 77.5 } }),
    ]);
    const region = fitRegion({ latitude: 28.6, longitude: 77.35 }, jobs)!;
    expect(region.latitude).toBeGreaterThan(28.4);
    expect(region.latitude).toBeLessThan(28.8);
    expect(region.latitudeDelta).toBeGreaterThan(0);
  });

  test("a single point gets a neighbourhood zoom, not a zero/invalid delta", () => {
    const region = fitRegion({ latitude: 28.62, longitude: 77.37 }, [])!;
    expect(region.latitudeDelta).toBeGreaterThanOrEqual(0.02);
    expect(region.longitudeDelta).toBeGreaterThanOrEqual(0.02);
  });

  test("no partner location and no jobs yields null so the caller shows the empty state", () => {
    expect(fitRegion(null, [])).toBeNull();
  });

  test("jobs without a partner fix still produce a region", () => {
    const jobs = buildMapJobs([booking({ id: "a" })]);
    expect(fitRegion(null, jobs)).not.toBeNull();
  });
});

test.describe("P1-2 polyline + ETA formatting", () => {
  test("decodes a known Google-encoded polyline", () => {
    // Canonical example from Google's encoded-polyline documentation.
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0]!.latitude).toBeCloseTo(38.5, 4);
    expect(points[0]!.longitude).toBeCloseTo(-120.2, 4);
    expect(points[2]!.latitude).toBeCloseTo(43.252, 3);
  });

  test("null / undefined / empty polyline decodes to an empty path (route line simply not drawn)", () => {
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
    expect(decodePolyline("")).toEqual([]);
  });

  test("ETA formatting handles minutes, hours, and invalid input", () => {
    expect(formatEta(0)).toBe("0 min");
    expect(formatEta(45)).toBe("45 min");
    expect(formatEta(60)).toBe("1 hr");
    expect(formatEta(95)).toBe("1 hr 35 min");
    expect(formatEta(null)).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(-5)).toBeNull();
    expect(formatEta(NaN)).toBeNull();
  });
});
