/**
 * Arrival and start are confirmed against the position the server holds for the partner (pure rule).
 * Re-audit, 2026-10-06: the routes judged only the coordinates in the request, and the job's exact
 * coordinates are in the payload the partner already has.
 * 2026-10-07: the fix's age is measured on the SERVER's clock (when it was received), and a second
 * stream the server holds for the same partner (the tracking position) must not contradict it.
 */
import { describe, expect, test } from "bun:test";
import { confirmPositionAgainstServerFix } from "../lib/arrival-position";

const now = new Date("2026-10-07T06:00:00Z");
const job = { jobLatitude: 28.62, jobLongitude: 77.37 };
const rule = { now, maxAgeSec: 120, futureToleranceSec: 30, radiusM: 100, ...job };
const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);
/** A fix the device captured and the server received `secondsAgo` ago. */
const fixAt = (latitude: number, longitude: number, secondsAgo: number) => ({ latitude, longitude, capturedAt: at(secondsAgo), receivedAt: at(secondsAgo) });

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

  test("a recent fix away from the job is a mismatch, with the distance", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: fixAt(28.70, 77.37, 15) });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_MISMATCH" });
    if (!r.ok) expect(r.fixDistanceM).toBeGreaterThan(8000);
  });

  test("a job address with no known coordinates is not measured against, but still needs a live fix", () => {
    const unknownJob = { ...rule, jobLatitude: 0, jobLongitude: 0 };
    expect(confirmPositionAgainstServerFix({ ...unknownJob, fix: fixAt(19.07, 72.87, 10) })).toMatchObject({ ok: true, fixAgeSec: 10, fixDistanceM: null });
    expect(confirmPositionAgainstServerFix({ ...unknownJob, fix: null }).ok).toBe(false);
  });
});

describe("the age of a fix is what the server's clock says", () => {
  test("a fix the server received long ago is old, whatever time the device wrote on it", () => {
    // The device may date a fix up to 30 s ahead; that must not buy it extra freshness.
    const forwardDated = { latitude: 28.62, longitude: 77.37, capturedAt: at(-25), receivedAt: at(200) };
    expect(confirmPositionAgainstServerFix({ ...rule, fix: forwardDated })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec: 200 });
  });

  test("a fix with no receive time on record cannot confirm anything", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix: { latitude: 28.62, longitude: 77.37, capturedAt: at(5), receivedAt: null } })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
  });

  test("a fix captured long before it was received was already old when it arrived", () => {
    const stale = { latitude: 28.62, longitude: 77.37, capturedAt: at(400), receivedAt: at(5) };
    expect(confirmPositionAgainstServerFix({ ...rule, fix: stale })).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
  });
});

describe("the tracking position must not contradict the presence fix", () => {
  const fix = fixAt(28.6201, 77.3701, 10);

  test("a recent tracking position elsewhere is a mismatch, even though the presence fix is at the job", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix, tracking: { latitude: 28.7, longitude: 77.37, receivedAt: at(8) } });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_MISMATCH" });
  });

  test("a recent tracking position at the job agrees; an old one says nothing about now", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix, tracking: { latitude: 28.62, longitude: 77.37, receivedAt: at(8) } }).ok).toBe(true);
    expect(confirmPositionAgainstServerFix({ ...rule, fix, tracking: { latitude: 28.7, longitude: 77.37, receivedAt: at(900) } }).ok).toBe(true);
    expect(confirmPositionAgainstServerFix({ ...rule, fix, tracking: null }).ok).toBe(true);
  });
});

/**
 * 2026-10-08: the mock-location signal. Android marks every fix a mock-location app produced
 * (`mocked: true`); iOS has no such flag and older clients send nothing (absent = unknown).
 * A fix the device itself says is mocked is not a position the server holds.
 */
describe("a fix the device flags as mocked is not a position the server holds", () => {
  const honest = { latitude: 28.6201, longitude: 77.3701, capturedAt: at(10), receivedAt: at(10) };

  test("a mocked fix at the job leaves the position unconfirmed, and says the fix was mocked", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: true } });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED", locationMocked: true });
  });

  test("a fix the OS says is not mocked, and one that says nothing, confirm exactly as before", () => {
    expect(confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: false } })).toMatchObject({ ok: true, fixAgeSec: 10, locationMocked: false });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: null } })).toMatchObject({ ok: true, fixAgeSec: 10, locationMocked: null });
    expect(confirmPositionAgainstServerFix({ ...rule, fix: honest })).toMatchObject({ ok: true, fixAgeSec: 10, locationMocked: null });
  });

  test("an honest tracking point at the job does not rescue a mocked presence fix", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: true }, tracking: { latitude: 28.62, longitude: 77.37, receivedAt: at(8), mocked: false } });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED", locationMocked: true });
  });

  test("a mocked tracking point at the job is no evidence for the partner: the honest fix decides, and the mock is on record", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: false }, tracking: { latitude: 28.62, longitude: 77.37, receivedAt: at(8), mocked: true } });
    expect(r).toMatchObject({ ok: true, fixAgeSec: 10, locationMocked: true });
  });

  test("a mocked tracking point elsewhere still counts against the partner: the two streams disagree", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: false }, tracking: { latitude: 28.7, longitude: 77.37, receivedAt: at(8), mocked: true } });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_MISMATCH", locationMocked: true });
  });

  test("an old mocked tracking point says nothing about now, as an old honest one does not", () => {
    const r = confirmPositionAgainstServerFix({ ...rule, fix: { ...honest, mocked: false }, tracking: { latitude: 28.7, longitude: 77.37, receivedAt: at(900), mocked: true } });
    expect(r).toMatchObject({ ok: true, locationMocked: false });
  });
});
