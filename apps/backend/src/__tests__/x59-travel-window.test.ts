/**
 * X-59 — owner decision 2026-09-29: a GPS ping may move an ACCEPTED / ASSIGNED job to "on the way" only
 * from 60 minutes before the scheduled start (and any time after the start while the job is live). An
 * unset or invalid setting fails CLOSED: GPS then never changes travel state.
 */
import { describe, expect, test } from "bun:test";
import { GPS_TRAVEL_WINDOW_MINUTES, gpsTravelWindowMinutes, gpsTravelWindowOpen } from "../lib/travel-window";

const start = new Date("2026-10-01T10:00:00.000Z");
const at = (minutesBefore: number) => new Date(start.getTime() - minutesBefore * 60_000);

describe("X-59 travel window policy", () => {
  test("the canonical window is 60 minutes (owner decision)", () => {
    expect(GPS_TRAVEL_WINDOW_MINUTES).toBe(60);
    expect(gpsTravelWindowMinutes({})).toBe(60);
  });
  test("2 days and 2 hours early: closed", () => {
    expect(gpsTravelWindowOpen(start, at(2 * 24 * 60), 60)).toBe(false);
    expect(gpsTravelWindowOpen(start, at(120), 60)).toBe(false);
    expect(gpsTravelWindowOpen(start, at(61), 60)).toBe(false);
  });
  test("60 and 59 minutes early, exact start and after the start: open", () => {
    expect(gpsTravelWindowOpen(start, at(60), 60)).toBe(true);
    expect(gpsTravelWindowOpen(start, at(59), 60)).toBe(true);
    expect(gpsTravelWindowOpen(start, at(0), 60)).toBe(true);
    expect(gpsTravelWindowOpen(start, at(-45), 60)).toBe(true);
  });
  test("unset / invalid configuration fails closed", () => {
    expect(gpsTravelWindowOpen(start, at(0), null)).toBe(false);
    for (const raw of ["", " ", "off", "abc", "-5", "0", "NaN"]) expect(gpsTravelWindowMinutes({ GPS_TRAVEL_WINDOW_MINUTES: raw })).toBeNull();
    expect(gpsTravelWindowMinutes({ GPS_TRAVEL_WINDOW_MINUTES: "90" })).toBe(90);
  });
  test("an unknown start time fails closed", () => {
    expect(gpsTravelWindowOpen(new Date(Number.NaN), at(0), 60)).toBe(false);
  });
});
