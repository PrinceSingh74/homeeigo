import { describe, expect, test } from "bun:test";
import {
  applyTrackingFrame,
  INITIAL_TRACKING_STATE,
  unwrapTrackingMessage,
  type LiveTrackingState,
  type TrackingFrame,
} from "./tracking-frames";

const T0 = Date.parse("2026-09-19T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function fix(ms: number, lat: number, lng: number, extra: Partial<TrackingFrame> = {}): TrackingFrame {
  return {
    eventId: `e-${ms}-${lat}-${lng}`,
    type: "tracking.location_update",
    providerLatitude: lat,
    providerLongitude: lng,
    locationUpdatedAt: iso(ms),
    timestamp: iso(ms),
    ...extra,
  };
}

function run(frames: TrackingFrame[], now = T0 + 60_000, source: "ws" | "rest" = "ws") {
  let s: LiveTrackingState = INITIAL_TRACKING_STATE;
  const reasons: string[] = [];
  for (const f of frames) {
    const r = applyTrackingFrame(s, f, now, source);
    s = r.state;
    reasons.push(r.applied ? "applied" : r.reason);
  }
  return { s, reasons };
}

describe("tracking frame integrity", () => {
  test("unwraps the server envelope", () => {
    const f = unwrapTrackingMessage({ type: "tracking.location_update", data: { eventId: "x", eta: 4 } });
    expect(f?.eventId).toBe("x");
    expect(f?.type).toBe("tracking.location_update");
    expect(unwrapTrackingMessage({ eta: 3 })?.eta).toBe(3);
    expect(unwrapTrackingMessage(null)).toBeNull();
  });

  test("dedupes a re-delivered event id", () => {
    const f = fix(T0, 28.5, 77.0);
    const { reasons } = run([f, f]);
    expect(reasons).toEqual(["applied", "duplicate"]);
  });

  test("drops an out-of-order (older) position", () => {
    const { s, reasons } = run([fix(T0 + 10_000, 28.5001, 77.0), fix(T0, 28.5, 77.0)]);
    expect(reasons).toEqual(["applied", "out_of_order"]);
    expect(s.lat).toBe(28.5001);
  });

  test("drops a lower sequence number", () => {
    const { reasons } = run([
      { eventId: "a", status: "on_the_way", sequence: 5 },
      { eventId: "b", status: "assigned", sequence: 4 },
    ]);
    expect(reasons).toEqual(["applied", "out_of_order"]);
  });

  test("drops a stale live position", () => {
    const { reasons } = run([fix(T0 - 10 * 60_000, 28.5, 77.0)], T0);
    expect(reasons).toEqual(["stale"]);
  });

  test("a REST snapshot is not dropped for staleness", () => {
    const { reasons, s } = run([{ status: "on_the_way", providerLatitude: 28.5, providerLongitude: 77, locationUpdatedAt: iso(T0 - 10 * 60_000) }], T0, "rest");
    expect(reasons).toEqual(["applied"]);
    expect(s.lat).toBe(28.5);
  });

  test("drops a physically impossible jump but accepts a persistent new track", () => {
    // 28.5 → 29.5 is ~111 km in 10 s.
    const { s, reasons } = run([
      fix(T0, 28.5, 77.0),
      fix(T0 + 10_000, 29.5, 77.0),
      fix(T0 + 20_000, 29.5001, 77.0),
      fix(T0 + 30_000, 29.5002, 77.0),
    ]);
    expect(reasons).toEqual(["applied", "impossible_jump", "impossible_jump", "applied"]);
    expect(s.lat).toBe(29.5002);
  });

  test("a plausible move is applied", () => {
    // ~111 m in 10 s ≈ 40 km/h.
    const { reasons } = run([fix(T0, 28.5, 77.0), fix(T0 + 10_000, 28.501, 77.0)]);
    expect(reasons).toEqual(["applied", "applied"]);
  });

  test("a status frame riding on a stale fix still updates status", () => {
    const { s, reasons } = run([fix(T0 - 10 * 60_000, 28.5, 77.0, { status: "arrived" })], T0);
    expect(reasons).toEqual(["applied"]);
    expect(s.status).toBe("arrived");
    expect(s.lat).toBeUndefined();
  });

  test("ignores frames with nothing to apply", () => {
    expect(run([{ type: "connected" }]).reasons).toEqual(["empty"]);
  });

  test("REST refetch after reconnect never moves the marker back", () => {
    let s = run([fix(T0 + 20_000, 28.502, 77.0)]).s;
    const r = applyTrackingFrame(s, { status: "arrived", providerLatitude: 28.5, providerLongitude: 77, locationUpdatedAt: iso(T0) }, T0 + 30_000, "rest");
    expect(r.applied).toBe(true);
    s = r.state;
    expect(s.lat).toBe(28.502);
    expect(s.status).toBe("arrived");
  });
});
