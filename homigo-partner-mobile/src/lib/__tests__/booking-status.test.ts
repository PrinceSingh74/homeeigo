import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_WORK_STATUSES,
  BOOKING_LIST_FILTER,
  BOOKING_STATUS,
  bookingStatusLabel,
  bookingStatusRank,
  isActiveWorkStatus,
  isCancelledStatus,
  isClosedWithoutWorkStatus,
  isTerminalStatus,
  normalizeBookingStatus,
} from "../booking-status.ts";

test("statuses mirror the backend enum exactly (read from prisma/schema.prisma)", () => {
  const schema = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");
  const start = schema.indexOf("enum BookingStatus {");
  assert.ok(start >= 0, "enum BookingStatus not found");
  const block = schema.slice(start, schema.indexOf("\n}", start));
  const theirs = [...block.matchAll(/^\s{2}([A-Z_]+)\s*$/gm)].map((m) => m[1]!).sort();
  assert.equal(theirs.length, 12);
  assert.deepEqual(Object.values(BOOKING_STATUS).sort(), theirs);
});

test("wire form (bookingStatusApi lowercases) normalizes to the enum", () => {
  assert.equal(normalizeBookingStatus("in_progress"), "IN_PROGRESS");
  assert.equal(normalizeBookingStatus("en-route"), "EN_ROUTE");
  assert.equal(normalizeBookingStatus("customer_no_show"), "CUSTOMER_NO_SHOW");
  assert.equal(normalizeBookingStatus("arrived"), null); // arrival is arrivedAt, not a status
  assert.equal(normalizeBookingStatus("cancelled"), null); // a list FILTER, never a status the server sends
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

test("EXPIRED, CUSTOMER_NO_SHOW and PROVIDER_NO_SHOW are terminal — and none of them is live work", () => {
  for (const s of ["expired", "customer_no_show", "provider_no_show"]) {
    assert.equal(isTerminalStatus(s), true, s);
    assert.equal(isClosedWithoutWorkStatus(s), true, s);
    assert.equal(isActiveWorkStatus(s), false, s);
    assert.equal(isCancelledStatus(s), false, s);
  }
});

test("every cancelled status is terminal and reads as cancelled", () => {
  for (const s of ["cancelled_by_user", "cancelled_by_provider", "rejected"]) {
    assert.equal(isCancelledStatus(s), true, s);
    assert.equal(isTerminalStatus(s), true, s);
    assert.equal(isClosedWithoutWorkStatus(s), true, s);
  }
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isClosedWithoutWorkStatus("completed"), false);
  for (const s of ["pending", "accepted", "assigned", "en_route", "in_progress", "bogus"]) assert.equal(isTerminalStatus(s), false, s);
});

test("rank orders the LIVE path only; a closed job never ranks as progress", () => {
  assert.ok(bookingStatusRank("in_progress") > bookingStatusRank("en_route"));
  assert.ok(bookingStatusRank("en_route") > bookingStatusRank("accepted"));
  assert.equal(bookingStatusRank("bogus"), 0);
  for (const s of ["expired", "customer_no_show", "provider_no_show", "cancelled_by_user", "rejected"]) assert.equal(bookingStatusRank(s), 0, s);
});

test("labels", () => {
  assert.equal(bookingStatusLabel("en_route", "2026-09-19T10:00:00Z"), "Arrived");
  assert.equal(bookingStatusLabel("in_progress"), "In progress");
  assert.equal(bookingStatusLabel("expired"), "Expired");
  assert.equal(bookingStatusLabel("customer_no_show"), "Customer not available");
  assert.equal(bookingStatusLabel("provider_no_show"), "Missed visit");
  // A closed job that still carries its arrival is not "Arrived".
  assert.equal(bookingStatusLabel("customer_no_show", "2026-09-19T10:00:00Z"), "Customer not available");
  assert.equal(bookingStatusLabel("cancelled_by_user", "2026-09-19T10:00:00Z"), "Cancelled by customer");
});
