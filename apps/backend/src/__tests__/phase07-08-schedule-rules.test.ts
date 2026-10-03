/**
 * Phase 07/08 — the schedule rules the booking pipeline enforces, at the unit level.
 *
 * The integration side (create/reschedule over HTTP) is covered by
 * phase07-08-schedule-rules.integration.test.ts; this file pins the pure primitives so a regression
 * in them is attributed precisely instead of surfacing as a confusing 400 somewhere downstream.
 */
import { describe, expect, test } from "bun:test";
import { isAppointmentWithinWorkingWindow, isWithinWorkingWindow } from "../lib/partner-ops-clock";
import { isReschedulableBookingStatus } from "../lib/booking-state-machine";
import { BookingStatus } from "@prisma/client";

const ist = (s: string) => new Date(`${s}+05:30`);
const SCHEDULE = {
  workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  workingHoursStart: "09:00",
  workingHoursEnd: "18:00",
  timezone: "Asia/Kolkata",
};

describe("the whole appointment must fit the partner's window, not just its first minute", () => {
  // 2026-12-22 is a Tuesday.
  test("a 3-hour job starting 17:30 is refused although 17:30 is inside 09:00–18:00", () => {
    const start = ist("2026-12-22T17:30:00");
    expect(isWithinWorkingWindow(SCHEDULE, start)).toBe(true); // the old check passed it
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, start, 180)).toBe(false);
  });

  test("the same job earlier in the day fits, and ending exactly at close is allowed", () => {
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T10:00:00"), 180)).toBe(true);
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T15:00:00"), 180)).toBe(true);
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T15:01:00"), 180)).toBe(false);
  });

  test("zero duration (FIXED-policy turnaround services) keeps the start-only behaviour", () => {
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T17:30:00"), 0)).toBe(true);
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T17:30:00"))).toBe(true);
  });

  test("a non-working day and a pre-open start are still refused at any duration", () => {
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-20T10:00:00"), 60)).toBe(false); // Sunday
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T08:00:00"), 60)).toBe(false);
  });

  test("with no closing time configured the duration cannot be judged, so the start check stands", () => {
    const open = { ...SCHEDULE, workingHoursStart: null, workingHoursEnd: null };
    expect(isAppointmentWithinWorkingWindow(open, ist("2026-12-22T23:00:00"), 600)).toBe(true);
  });

  // Each endpoint is judged against the window on its OWN day. An all-day partner really can take a
  // job that runs past midnight; requiring the end to precede the start day's close would refuse it.
  test("an all-day partner may cross midnight; the same job is refused once a real close exists", () => {
    const allDay = { ...SCHEDULE, workingHoursStart: "00:00", workingHoursEnd: "23:59", workingDays: [...SCHEDULE.workingDays, "Sun"] };
    expect(isAppointmentWithinWorkingWindow(allDay, ist("2026-12-22T23:00:00"), 240)).toBe(true);
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T23:00:00"), 240)).toBe(false);
  });

  test("an appointment longer than the window itself fits no day, however its endpoints land", () => {
    const allDay = { ...SCHEDULE, workingHoursStart: "00:00", workingHoursEnd: "23:59" };
    expect(isAppointmentWithinWorkingWindow(allDay, ist("2026-12-22T10:00:00"), 25 * 60)).toBe(false);
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, ist("2026-12-22T09:00:00"), 10 * 60)).toBe(false);
  });

  test("crossing into a NON-working day is refused even for an otherwise all-hours partner", () => {
    // Works every day except Sunday, around the clock: a Saturday 23:00 job running into Sunday is out.
    const notSunday = { ...SCHEDULE, workingHoursStart: "00:00", workingHoursEnd: "23:59" };
    expect(isAppointmentWithinWorkingWindow(notSunday, ist("2026-12-26T23:00:00"), 180)).toBe(false); // Sat → Sun
    expect(isAppointmentWithinWorkingWindow(notSunday, ist("2026-12-22T23:00:00"), 180)).toBe(true); // Tue → Wed
  });

  test("the window is the partner's timezone: the same instant fits one partner and not another", () => {
    const delhi = ist("2026-12-22T09:30:00"); // 04:00 UTC
    expect(isAppointmentWithinWorkingWindow(SCHEDULE, delhi, 60)).toBe(true);
    expect(isAppointmentWithinWorkingWindow({ ...SCHEDULE, timezone: "Europe/London" }, delhi, 60)).toBe(false);
  });
});

describe("reschedulable statuses are an allow-list", () => {
  test("live bookings can move", () => {
    for (const s of [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE]) {
      expect(isReschedulableBookingStatus(s)).toBe(true);
    }
  });

  test("started, finished, cancelled — and REJECTED, which the old deny-list omitted — cannot", () => {
    for (const s of [
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED_BY_USER,
      BookingStatus.CANCELLED_BY_PROVIDER,
      BookingStatus.REJECTED,
    ]) {
      expect(isReschedulableBookingStatus(s)).toBe(false);
    }
  });

  test("every BookingStatus is decided — a new status cannot default into being reschedulable", () => {
    const decided = Object.values(BookingStatus).filter((s) => typeof isReschedulableBookingStatus(s) === "boolean");
    expect(decided.length).toBe(Object.values(BookingStatus).length);
  });
});
