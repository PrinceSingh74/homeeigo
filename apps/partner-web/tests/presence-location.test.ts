import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_HEARTBEAT_INTERVAL_SEC, fixNeedsRefresh, LOCATION_FRESH_SEC, PRESENCE_CADENCE } from "../src/lib/presence-cadence";

/**
 * Browser journey, 2026-10-06: a partner who was online and available was rejected by dispatch as
 * PRESENCE_STALE about one time in five. The server treats a GPS fix as fresh for 60 seconds (by the
 * time the device captured it); an available partner attached a fix to every third heartbeat, 75
 * seconds apart, and the fix itself was whatever the position watcher last reported — which on a
 * device that is not moving can be minutes old.
 */
describe("an available partner stays locatable between heartbeats", () => {
  test("every state that sends a location sends it inside the server's freshness window, even from a background tab", () => {
    // A background tab beats at twice the interval.
    const worstGapSec = (nth: number) => nth * DEFAULT_HEARTBEAT_INTERVAL_SEC * 2;
    for (const [state, plan] of Object.entries(PRESENCE_CADENCE)) {
      if (plan.locationEveryNthBeat == null) continue;
      expect({ state, gap: worstGapSec(plan.locationEveryNthBeat), withinWindow: worstGapSec(plan.locationEveryNthBeat) < LOCATION_FRESH_SEC }).toEqual({ state, gap: worstGapSec(plan.locationEveryNthBeat), withinWindow: true });
    }
    expect(PRESENCE_CADENCE.AVAILABLE.locationEveryNthBeat).not.toBeNull();
  });

  test("offline and paused partners send no location", () => {
    expect(PRESENCE_CADENCE.OFFLINE.locationEveryNthBeat).toBeNull();
    expect(PRESENCE_CADENCE.PAUSED.locationEveryNthBeat).toBeNull();
  });
});

describe("the fix that is sent was read recently", () => {
  const now = 1_000_000;
  test("no fix, or one older than half the freshness window, is read again from the device before it is sent", () => {
    expect(fixNeedsRefresh(null, now)).toBe(true);
    expect(fixNeedsRefresh(now - (LOCATION_FRESH_SEC * 1000) / 2 - 1, now)).toBe(true);
    expect(fixNeedsRefresh(now - 5_000, now)).toBe(false);
    expect(fixNeedsRefresh(Number.NaN, now)).toBe(true);
  });

  test("the heartbeat refreshes a stale fix before building the location it sends", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "hooks", "use-partner-presence-heartbeat.ts"), "utf8");
    const refresh = src.indexOf("await refreshFixIfStale(");
    const build = src.indexOf("location: locationPayload(");
    expect(refresh).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(build);
    // One table, not a second copy in the hook.
    expect(src).not.toMatch(/export const PRESENCE_CADENCE/);
  });
});
