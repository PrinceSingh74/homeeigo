/**
 * Wave 4 — the customer slot grid (owner policy 2026-09-23).
 *
 *   timezone Asia/Kolkata · window 07:00–22:00 · step 30 min · 24×7 only when configured ·
 *   midnight crossing supported · D1 buffer [start − 30m, end + 30m) untouched.
 *
 * Pure and clock-free: every expectation below is the same on any machine at any hour.
 */
import { describe, expect, test } from "bun:test";
import { buildSlotGrid, instantAt, OPERATING_WINDOW, SLOT_GRID_MINUTES, slotDay } from "../lib/slot-grid";

const asIst = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

describe("the grid is the owner's policy, expressed once", () => {
  test("defaults are 07:00–22:00 on a 30-minute step", () => {
    expect(OPERATING_WINDOW).toEqual({ start: "07:00", end: "22:00" });
    expect(SLOT_GRID_MINUTES).toBe(30);
  });

  test("a day of 30-minute starts runs 07:00 … 21:30 — 30 slots", () => {
    const grid = buildSlotGrid({ date: "2026-12-24" });
    expect(grid.length).toBe(30);
    expect(asIst(grid[0]!)).toBe("07:00");
    expect(asIst(grid[1]!)).toBe("07:30");
    expect(asIst(grid.at(-1)!)).toBe("21:30");
  });

  test("every slot lands on the requested civil day in the business timezone", () => {
    for (const s of buildSlotGrid({ date: "2026-12-24" })) expect(slotDay(s)).toBe("2026-12-24");
  });

  test("an instant is exact: 07:00 IST is 01:30 UTC", () => {
    expect(instantAt("2026-12-24", 7 * 60).toISOString()).toBe("2026-12-24T01:30:00.000Z");
    expect(instantAt("2026-12-24", 0).toISOString()).toBe("2026-12-23T18:30:00.000Z");
  });
});

describe("an appointment must finish inside the window", () => {
  test("a 3-hour job is not offered a 20:00 start under a 22:00 close", () => {
    const grid = buildSlotGrid({ date: "2026-12-24", durationMinutes: 180 });
    expect(asIst(grid.at(-1)!)).toBe("19:00"); // 19:00 + 3h = 22:00 exactly
    expect(grid.map(asIst)).not.toContain("20:00");
  });

  test("a zero-occupancy service (FIXED turnaround) keeps the whole window", () => {
    expect(buildSlotGrid({ date: "2026-12-24", durationMinutes: 0 }).length).toBe(30);
  });

  test("a job longer than the window yields no slots rather than an impossible one", () => {
    expect(buildSlotGrid({ date: "2026-12-24", durationMinutes: 20 * 60 })).toEqual([]);
  });
});

describe("24×7 and midnight crossing", () => {
  test("24×7 is off unless asked for", () => {
    expect(buildSlotGrid({ date: "2026-12-24" }).length).toBe(30);
    expect(buildSlotGrid({ date: "2026-12-24", allDay: true }).length).toBe(48);
  });

  test("with 24×7 the grid starts at midnight IST and a late job may cross it", () => {
    const grid = buildSlotGrid({ date: "2026-12-24", allDay: true, durationMinutes: 180 });
    expect(asIst(grid[0]!)).toBe("00:00");
    // 23:30 + 3h runs into the 25th: offered, because the service is open around the clock.
    expect(grid.map(asIst)).toContain("23:30");
    expect(slotDay(new Date(grid.at(-1)!.getTime() + 180 * 60_000))).toBe("2026-12-25");
  });

  test("an ordinary 07:00–22:00 service never crosses midnight, even if asked", () => {
    const grid = buildSlotGrid({ date: "2026-12-24", durationMinutes: 180, allowMidnightCrossing: true });
    expect(asIst(grid.at(-1)!)).toBe("19:00");
  });

  test("crossing can be switched off for a 24×7 service", () => {
    const grid = buildSlotGrid({ date: "2026-12-24", allDay: true, durationMinutes: 180, allowMidnightCrossing: false });
    expect(asIst(grid.at(-1)!)).toBe("21:00"); // 21:00 + 3h = 24:00
  });
});

describe("a configured window replaces the default", () => {
  test("a narrower window yields fewer slots and different edges", () => {
    const grid = buildSlotGrid({ date: "2026-12-24", window: { start: "09:00", end: "13:00" } });
    expect(grid.length).toBe(8);
    expect(asIst(grid[0]!)).toBe("09:00");
    expect(asIst(grid.at(-1)!)).toBe("12:30");
  });

  test("a nonsense window is refused rather than silently producing nothing", () => {
    expect(() => buildSlotGrid({ date: "2026-12-24", window: { start: "22:00", end: "07:00" } })).toThrow();
    expect(() => buildSlotGrid({ date: "2026-12-24", window: { start: "7am", end: "22:00" } })).toThrow();
  });

  test("a different step is honoured", () => {
    expect(buildSlotGrid({ date: "2026-12-24", stepMinutes: 60 }).length).toBe(15);
    expect(buildSlotGrid({ date: "2026-12-24", stepMinutes: 15 }).length).toBe(60);
  });
});
