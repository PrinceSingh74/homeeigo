/**
 * Phase 08 service time rules — one implementation, civil dates in the business timezone, stable reason
 * codes. Fixed clocks only: no test depends on when it runs.
 */
import { describe, expect, test } from "bun:test";
import { civilDate, evaluateServiceTimeRules, DEFAULT_MAX_ADVANCE_DAYS } from "../lib/service-availability";

// 2026-12-24 20:00 IST = 14:30 UTC
const NOW = new Date("2026-12-24T14:30:00.000Z");
const ist = (s: string) => new Date(`${s}+05:30`);
const reason = (r: ReturnType<typeof evaluateServiceTimeRules>) => (r.ok ? "OK" : r.reason);

describe("civil dates are the business timezone's, not the server's or UTC's", () => {
  test("00:30 IST on the 25th is the 25th (UTC says the 24th)", () => {
    const t = ist("2026-12-25T00:30:00");
    expect(t.toISOString().slice(0, 10)).toBe("2026-12-24");
    expect(civilDate(t)).toBe("2026-12-25");
  });
  test("23:59 IST stays on its own date; 00:00 IST is the next", () => {
    expect(civilDate(ist("2026-12-31T23:59:00"))).toBe("2026-12-31");
    expect(civilDate(ist("2027-01-01T00:00:00"))).toBe("2027-01-01");
  });
  test("another IANA zone is honoured when passed", () => {
    expect(civilDate(new Date("2026-12-25T02:00:00Z"), "America/New_York")).toBe("2026-12-24");
  });
});

describe("rules and reason codes", () => {
  test("invalid date / past", () => {
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date("nope"), now: NOW }))).toBe("INVALID_DATE");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() - 1), now: NOW }))).toBe("SLOT_IN_PAST");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: NOW, now: NOW }))).toBe("OK");
  });
  test("lead time is inclusive at the boundary", () => {
    const availability = { minimumLeadTimeMinutes: 120 };
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() + 119 * 60_000), now: NOW, availability }))).toBe("LEAD_TIME_NOT_MET");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() + 120 * 60_000), now: NOW, availability }))).toBe("OK");
  });
  test("advance window: the CONFIGURED value is honoured beyond 30 days (the old hard cap ignored it)", () => {
    const d45 = new Date(NOW.getTime() + 45 * 86_400_000);
    expect(reason(evaluateServiceTimeRules({ scheduledDate: d45, now: NOW, availability: { maximumAdvanceDays: 60 } }))).toBe("OK");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: d45, now: NOW }))).toBe("BEYOND_ADVANCE_WINDOW");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() + DEFAULT_MAX_ADVANCE_DAYS * 86_400_000), now: NOW }))).toBe("OK");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() + 8 * 86_400_000), now: NOW, availability: { maximumAdvanceDays: 7 } }))).toBe("BEYOND_ADVANCE_WINDOW");
  });
  test("same-day is judged on the IST calendar: 23:00 IST today is same-day, 00:30 IST tomorrow is not", () => {
    const availability = { sameDay: false };
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-24T23:00:00"), now: NOW, availability }))).toBe("SAME_DAY_UNAVAILABLE");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-25T00:30:00"), now: NOW, availability }))).toBe("OK");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-24T23:00:00"), now: NOW, sameDayAvailable: false }))).toBe("SAME_DAY_UNAVAILABLE");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-24T23:00:00"), now: NOW, availability: { sameDay: true }, sameDayAvailable: false }))).toBe("OK");
  });
  test("blackout on 25 Dec catches 00:30 IST on the 25th (UTC would have called it the 24th and let it through)", () => {
    const availability = { blackoutDates: ["2026-12-25"] };
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-25T00:30:00"), now: NOW, availability }))).toBe("BLACKOUT_DATE");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-25T23:59:00"), now: NOW, availability }))).toBe("BLACKOUT_DATE");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-24T23:59:00"), now: NOW, availability }))).toBe("OK");
    expect(reason(evaluateServiceTimeRules({ scheduledDate: ist("2026-12-26T00:00:00"), now: NOW, availability }))).toBe("OK");
  });
  test("every failure carries a customer-safe message", () => {
    const r = evaluateServiceTimeRules({ scheduledDate: new Date(NOW.getTime() + 30 * 60_000), now: NOW, availability: { minimumLeadTimeMinutes: 180 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("3 hours");
  });
});
