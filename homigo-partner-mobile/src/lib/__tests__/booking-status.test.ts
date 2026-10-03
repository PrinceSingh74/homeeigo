import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_WORK_STATUSES,
  BOOKING_LIST_FILTER,
  BOOKING_STATUS,
  bookingStatusLabel,
  bookingStatusRank,
  isActiveWorkStatus,
  normalizeBookingStatus,
} from "../booking-status.ts";

test("statuses mirror the backend enum exactly", () => {
  assert.deepEqual(Object.values(BOOKING_STATUS).sort(), [
    "ACCEPTED",
    "ASSIGNED",
    "CANCELLED_BY_PROVIDER",
    "CANCELLED_BY_USER",
    "COMPLETED",
    "EN_ROUTE",
    "IN_PROGRESS",
    "PENDING",
    "REJECTED",
  ]);
});

test("wire form (bookingStatusApi lowercases) normalizes to the enum", () => {
  assert.equal(normalizeBookingStatus("in_progress"), "IN_PROGRESS");
  assert.equal(normalizeBookingStatus("en-route"), "EN_ROUTE");
  assert.equal(normalizeBookingStatus("arrived"), null); // arrival is arrivedAt, not a status
  assert.equal(normalizeBookingStatus(undefined), null);
});

test("active work includes IN_PROGRESS (the Phase-10 defect)", () => {
  assert.equal(BOOKING_LIST_FILTER.ACTIVE_WORK, "active");
  assert.ok(ACTIVE_WORK_STATUSES.includes("IN_PROGRESS"));
  assert.equal(isActiveWorkStatus("in_progress"), true);
  assert.equal(isActiveWorkStatus("en_route"), true);
  assert.equal(isActiveWorkStatus("completed"), false);
  assert.equal(isActiveWorkStatus("pending"), false);
});

test("rank and labels", () => {
  assert.ok(bookingStatusRank("in_progress") > bookingStatusRank("en_route"));
  assert.ok(bookingStatusRank("en_route") > bookingStatusRank("accepted"));
  assert.equal(bookingStatusRank("bogus"), 0);
  assert.equal(bookingStatusLabel("en_route", "2026-09-19T10:00:00Z"), "Arrived");
  assert.equal(bookingStatusLabel("in_progress"), "In progress");
});
