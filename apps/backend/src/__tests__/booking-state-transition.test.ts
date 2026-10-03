/**
 * Canonical booking/job FSM — shared transition table used by conflict middleware
 * and booking.service mutations.
 */
import { describe, expect, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import {
  checkBookingStateTransition,
  isBookingTransitionAllowed,
} from "../middleware/conflict";

describe("booking state transition table", () => {
  test("happy path OFFERED-equivalent → execution → complete", () => {
    expect(
      isBookingTransitionAllowed(BookingStatus.PENDING, BookingStatus.ACCEPTED),
    ).toBe(true);
    expect(
      isBookingTransitionAllowed(BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE),
    ).toBe(true);
    expect(
      isBookingTransitionAllowed(BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS),
    ).toBe(true);
    expect(
      isBookingTransitionAllowed(BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED),
    ).toBe(true);
  });

  test("rejects illegal skips and terminal escapes", () => {
    expect(
      isBookingTransitionAllowed(BookingStatus.PENDING, BookingStatus.COMPLETED),
    ).toBe(false);
    expect(
      isBookingTransitionAllowed(BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS),
    ).toBe(false);
    expect(
      isBookingTransitionAllowed(BookingStatus.CANCELLED_BY_USER, BookingStatus.ACCEPTED),
    ).toBe(false);
  });

  test("checkBookingStateTransition throws ConflictError on illegal move", () => {
    expect(() =>
      checkBookingStateTransition(BookingStatus.PENDING, BookingStatus.COMPLETED),
    ).toThrow(/Cannot change status/);
  });

  test("accept may jump ASSIGNED → IN_PROGRESS (payment-gated start)", () => {
    expect(
      isBookingTransitionAllowed(BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS),
    ).toBe(true);
    expect(
      isBookingTransitionAllowed(BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS),
    ).toBe(true);
  });
});
