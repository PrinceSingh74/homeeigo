import { describe, expect, test } from "bun:test";
import {
  assertPartnerAction,
  canPartnerAction,
  deriveOperationalStatus,
  isDispatchEligibleStatus,
  toCanonicalAvailability,
  OPERATIONAL_STATES,
} from "../lib/partner-availability-fsm";
import { computeCapacity } from "../lib/partner-capacity";
import {
  assertStartBeforeEnd,
  isInBreakWindow,
  isWithinWorkingWindow,
  matchesWorkingDay,
  normalizeWorkingDays,
  parseBreakWindows,
  parseHmToMinutes,
  zonedDayBounds,
} from "../lib/partner-ops-clock";
import { AVAILABILITY_STATES } from "../lib/partner-four-axis";

describe("partner availability FSM", () => {
  test("banned / inactive never become an availability value", () => {
    expect(
      deriveOperationalStatus({
        isBanned: true,
        isActive: true,
        isOnline: true,
        pausedAt: null,
        hasInProgress: false,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
      }),
    ).toBe("available");
    expect(OPERATIONAL_STATES).not.toContain("suspended");
    expect(toCanonicalAvailability("suspended")).toBe("OFFLINE");
  });

  test("PAUSED beats job phase", () => {
    expect(
      deriveOperationalStatus({
        isBanned: false,
        isActive: true,
        isOnline: true,
        pausedAt: new Date(),
        hasInProgress: true,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
      }),
    ).toBe("paused");
  });

  test("compliance restriction does not overwrite availability", () => {
    expect(
      deriveOperationalStatus({
        isBanned: false,
        isActive: true,
        isOnline: true,
        pausedAt: null,
        hasInProgress: false,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
        complianceRestricted: true,
      }),
    ).toBe("available");
  });

  test("compliance restriction does not overwrite in-progress job projection", () => {
    expect(
      deriveOperationalStatus({
        isBanned: false,
        isActive: true,
        isOnline: true,
        pausedAt: null,
        hasInProgress: true,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
        complianceRestricted: true,
      }),
    ).toBe("on_job");
  });

  test("OFFLINE even with an active job (job continues on the job axis)", () => {
    expect(
      deriveOperationalStatus({
        isBanned: false,
        isActive: true,
        isOnline: false,
        pausedAt: null,
        hasInProgress: true,
        hasEnRoute: false,
        hasAccepted: false,
        hasOpenOffer: false,
      }),
    ).toBe("offline");
  });

  test("job phase order: on_job > en_route > accepting > offered > available", () => {
    const base = {
      isBanned: false,
      isActive: true,
      isOnline: true,
      pausedAt: null,
      hasInProgress: false,
      hasEnRoute: false,
      hasAccepted: false,
      hasOpenOffer: false,
    };
    expect(deriveOperationalStatus({ ...base, hasInProgress: true, hasOpenOffer: true })).toBe("on_job");
    expect(deriveOperationalStatus({ ...base, hasEnRoute: true })).toBe("en_route");
    expect(deriveOperationalStatus({ ...base, hasAccepted: true })).toBe("accepting");
    expect(deriveOperationalStatus({ ...base, hasOpenOffer: true })).toBe("offered");
    expect(deriveOperationalStatus(base)).toBe("available");
  });

  test("rejects ON_JOB → go_online; pause only from live availability", () => {
    expect(canPartnerAction("go_online", "on_job")).toBe(false);
    expect(canPartnerAction("go_online", "offline")).toBe(true);
    expect(canPartnerAction("pause", "available")).toBe(true);
    expect(canPartnerAction("pause", "offline")).toBe(false);
    expect(canPartnerAction("resume", "paused")).toBe(true);
    expect(() => assertPartnerAction("go_online", "on_job")).toThrow(/INVALID_TRANSITION/);
  });

  test("dispatch-eligible statuses exclude paused/offline", () => {
    expect(isDispatchEligibleStatus("available")).toBe(true);
    expect(isDispatchEligibleStatus("on_job")).toBe(true);
    expect(isDispatchEligibleStatus("paused")).toBe(false);
    expect(isDispatchEligibleStatus("offline")).toBe(false);
    expect(isDispatchEligibleStatus("accepting_job")).toBe(true);
  });

  test("canonical availability vocab matches the lock", () => {
    expect([...AVAILABILITY_STATES]).toEqual([
      "OFFLINE",
      "AVAILABLE",
      "OFFERED",
      "ACCEPTING",
      "EN_ROUTE",
      "ON_JOB",
      "PAUSED",
    ]);
    expect(toCanonicalAvailability("accepting_job")).toBe("ACCEPTING");
    expect(toCanonicalAvailability("accepting")).toBe("ACCEPTING");
  });
});

describe("capacity engine", () => {
  test("availableSlots = maxConcurrent - current - reserved, gated by daily quota", () => {
    const cap = computeCapacity({
      currentJobs: 2,
      reservedOffers: 0,
      jobsToday: 2,
      maxConcurrentJobs: 3,
      maxJobsPerDay: 5,
    });
    expect(cap.availableSlots).toBe(1);
    expect(cap.utilization).toBe(67);
    expect(cap.capacityFull).toBe(false);
  });

  test("daily quota can zero slots while concurrent remains", () => {
    const cap = computeCapacity({
      currentJobs: 0,
      reservedOffers: 0,
      jobsToday: 5,
      maxConcurrentJobs: 3,
      maxJobsPerDay: 5,
    });
    expect(cap.availableSlots).toBe(0);
    expect(cap.capacityFull).toBe(true);
  });

  test("never returns negative slots", () => {
    const cap = computeCapacity({
      currentJobs: 9,
      reservedOffers: 2,
      jobsToday: 20,
      maxConcurrentJobs: 2,
      maxJobsPerDay: 5,
    });
    expect(cap.availableSlots).toBe(0);
    expect(cap.currentJobs).toBe(9);
  });

  test("null daily quota is unlimited", () => {
    const cap = computeCapacity({
      currentJobs: 1,
      reservedOffers: 0,
      jobsToday: 99,
      maxConcurrentJobs: 2,
      maxJobsPerDay: null,
    });
    expect(cap.availableSlots).toBe(1);
  });
});

describe("working days / hours / breaks", () => {
  test("normalizes mixed day labels without duplicates", () => {
    expect(normalizeWorkingDays(["monday", "Mon", "Tue", "tuesday"])).toEqual(["Mon", "Tue"]);
  });

  test("rejects start >= end", () => {
    expect(assertStartBeforeEnd("18:00", "09:00")).toMatch(/start must be before end/);
    expect(assertStartBeforeEnd("09:00", "18:00")).toBeNull();
    expect(parseHmToMinutes("09:30")).toBe(570);
  });

  test("parses valid break windows and drops invalid", () => {
    expect(parseBreakWindows([{ start: "13:00", end: "14:00" }, { start: "19:00", end: "18:00" }])).toEqual([
      { start: "13:00", end: "14:00" },
    ]);
  });

  test("working window uses partner timezone", () => {
    const schedule = {
      workingDays: ["Mon"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      timezone: "Asia/Kolkata",
    };
    const mondayIst = new Date("2026-08-24T04:30:00.000Z");
    expect(isWithinWorkingWindow(schedule, mondayIst)).toBe(true);
    const sundayIst = new Date("2026-08-23T04:30:00.000Z");
    expect(isWithinWorkingWindow(schedule, sundayIst)).toBe(false);
    expect(matchesWorkingDay(["Mon"], 1)).toBe(true);
  });

  test("break window is exclusive of end", () => {
    const schedule = {
      workingDays: ["Sat"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      breakWindows: [{ start: "13:00", end: "14:00" }],
      timezone: "Asia/Kolkata",
    };
    const inBreak = new Date("2026-08-22T07:40:00.000Z");
    expect(isInBreakWindow(schedule, inBreak)).toBe(true);
    const afterBreak = new Date("2026-08-22T08:30:00.000Z");
    expect(isInBreakWindow(schedule, afterBreak)).toBe(false);
  });

  test("zoned day bounds are midnight IST, not UTC", () => {
    const noonIst = new Date("2026-08-22T06:30:00.000Z");
    const { start, end } = zonedDayBounds("Asia/Kolkata", noonIst);
    expect(start.toISOString()).toBe("2026-08-21T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-08-22T18:30:00.000Z");
  });
});
