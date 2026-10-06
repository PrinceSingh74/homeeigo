/**
 * Arrival and start are confirmed against the position the server holds for the partner (pure rule).
 * Re-audit, 2026-10-06: the routes judged only the coordinates in the request, and the job's exact
 * coordinates are in the payload the partner already has.
 */
import { describe, expect, test } from "bun:test";
import { confirmPositionAgainstServerFix } from "../lib/arrival-position";

const now = new Date("2026-10-07T06:00:00Z");
const job = { jobLatitude: 28.62, jobLongitude: 77.37 };
const rule = { now, maxAgeSec: 120, futureToleranceSec: 30, radiusM: 100, ...job };
const fixAt = (latitude: number, longitude: number, secondsAgo: number) => ({ latitude, longitude, capturedAt: new Date(now.getTime() - secondsAgo * 1000) });

describe("the server-held fix decides", () => {
  test("a recent fix at the job confirms the position", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.6201, 77.3701, 20) })).toMatchObject({ ok: true, fixAgeSec: 20 });
  });

  test("no fix, an unknown (0,0) fix, or one too old leaves the position unconfirmed", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix: null })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(0, 0, 5) })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.62, 77.37, 121) })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec: 121 });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.62, 77.37, 120) }).ok).toBe(true);
  });

  test("a fix dated in the future beyond the clock tolerance is not a reading of the present", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.62, 77.37, -31) })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.62, 77.37, -10) })).toMatchObject({ ok: true, fixAgeSec: 0 });
  });

  test("a recent fix away from the job is a mismatch, with the distance", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.70, 77.37, 15) });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_MISMATCH" });
    if (!r.ok) expect(r.fixDistanceM).toBeGreaterThan(8000);
  });

  test("a job address with no known coordinates is not measured against, but still needs a live fix", () => {
    const unknownJob = { ...rule, jobLatitude: 0, jobLongitude: 0 };
    expect(confirmPositionAgainstServerFix({ ...unknownJob, fix: fixAt(19.07, 72.87, 10) })).toEqual({ ok: true, fixAgeSec: 10, fixDistanceM: null });
    expect(confirmPositionAgainstServerFix({ ...unknownJob, fix: null }).ok).toBe(false);
  });
});
