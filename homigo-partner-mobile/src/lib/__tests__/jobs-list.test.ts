/**
 * The jobs list: filters map to ONE server status each, pages join without duplicates, and a card
 * shows only what the server sent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_LIST_FILTER, CANCELLED_STATUSES, CLOSED_OUTCOME_STATUSES, bookingStatusLabel } from "../booking-status.ts";
import {
  CLOSED_SOURCES,
  JOB_FILTERS,
  JOB_SOURCES,
  addressLine,
  compactSelection,
  hasMorePages,
  jobsToday,
  mergePages,
  nextStep,
  pickActiveJob,
  slotLine,
  statusTone,
} from "../jobs-list.ts";

test("the three live filters use the server's own keys (shared with the job screen's cache)", () => {
  assert.equal(JOB_SOURCES.pending.status, BOOKING_LIST_FILTER.OFFERS);
  assert.equal(JOB_SOURCES.active.status, BOOKING_LIST_FILTER.ACTIVE_WORK);
  assert.equal(JOB_SOURCES.completed.status, BOOKING_LIST_FILTER.COMPLETED);
  assert.deepEqual(JOB_FILTERS.map((f) => f.label), ["New", "Active", "Completed", "Closed"]);
  // The device script taps the first filter by this name.
  assert.equal(JOB_FILTERS[0]!.accessibilityLabel, "New requests");
});

test("Closed covers every closed-without-work status, one server filter each — never a comma list", () => {
  assert.deepEqual(
    CLOSED_SOURCES.map((s) => s.status),
    [BOOKING_LIST_FILTER.CANCELLED, BOOKING_LIST_FILTER.EXPIRED, BOOKING_LIST_FILTER.CUSTOMER_NO_SHOW, BOOKING_LIST_FILTER.PROVIDER_NO_SHOW],
  );
  for (const s of CLOSED_SOURCES) assert.equal(s.status.includes(","), false);
  // "cancelled" is the three cancelled statuses; the other three are the closed outcomes.
  assert.equal(CANCELLED_STATUSES.length + CLOSED_OUTCOME_STATUSES.length, 6);
  assert.equal(CLOSED_SOURCES.find((s) => s.id === "customer_no_show")!.label, bookingStatusLabel("customer_no_show"));
  assert.equal(CLOSED_SOURCES.find((s) => s.id === "provider_no_show")!.label, bookingStatusLabel("provider_no_show"));
  assert.equal(CLOSED_SOURCES.find((s) => s.id === "expired")!.label, bookingStatusLabel("expired"));
});

test("pages join in order and a job that shifted between pages appears once", () => {
  const merged = mergePages([[{ id: "a" }, { id: "b" }], undefined, [{ id: "b" }, { id: "c" }]]);
  assert.deepEqual(merged.map((r) => r.id), ["a", "b", "c"]);
});

test("there is another page only while the server's total says so and the last page was full", () => {
  assert.equal(hasMorePages({ total: 45, pagesLoaded: 1, pageSize: 20, lastPageLength: 20 }), true);
  assert.equal(hasMorePages({ total: 45, pagesLoaded: 3, pageSize: 20, lastPageLength: 5 }), false);
  assert.equal(hasMorePages({ total: 40, pagesLoaded: 2, pageSize: 20, lastPageLength: 20 }), false);
  // A short page ends the list even when the total is stale.
  assert.equal(hasMorePages({ total: 100, pagesLoaded: 2, pageSize: 20, lastPageLength: 3 }), false);
  assert.equal(hasMorePages({ total: undefined, pagesLoaded: 1, pageSize: 20, lastPageLength: 20 }), false);
});

const AREA_ONLY = { label: null, fullAddress: "Pune, Maharashtra, 411045", addressLine1: null, addressLine2: null, buildingName: null, flatNumber: null, landmark: null, specialInstructions: null, city: "Pune", state: "Maharashtra", zipCode: "411045", latitude: null, longitude: null };

test("before acceptance the server sends the area only, and it is labelled as an area", () => {
  assert.deepEqual(addressLine(AREA_ONLY), { label: "Area", value: "Pune, Maharashtra, 411045" });
  assert.deepEqual(addressLine({ ...AREA_ONLY, fullAddress: "12 Rose Villa, Baner Road, Pune", addressLine1: "12 Rose Villa" }), { label: "Address", value: "12 Rose Villa, Baner Road, Pune" });
  assert.deepEqual(addressLine({ ...AREA_ONLY, fullAddress: null }), { label: "Area", value: "Pune, Maharashtra, 411045" });
  assert.equal(addressLine({ ...AREA_ONLY, fullAddress: null, city: null, state: null, zipCode: null }), null);
  assert.equal(addressLine(null), null);
});

test("a card's selection line leaves out the title and the slot, which have their own lines", () => {
  const rows = [
    { key: "service", label: "Service", value: "Deep cleaning" },
    { key: "option", label: "Option", value: "2 BHK" },
    { key: "quantity", label: "Quantity", value: "2 rooms" },
    { key: "addons", label: "Add-ons", value: "Balcony" },
    { key: "slot", label: "Slot", value: "09 Oct 2026 · 10:00 AM · 2 hr" },
  ];
  assert.equal(compactSelection(rows), "2 BHK · Quantity: 2 rooms · Add-ons: Balcony");
  assert.equal(slotLine(rows), "09 Oct 2026 · 10:00 AM · 2 hr");
  assert.equal(compactSelection([rows[0]!, rows[4]!]), null);
});

test("status tone: offers want attention, arrival is a step forward, a missed visit is an error", () => {
  assert.equal(statusTone("pending"), "warning");
  assert.equal(statusTone("en_route"), "info");
  assert.equal(statusTone("EN_ROUTE", "2026-10-07T10:00:00Z"), "leaf");
  assert.equal(statusTone("in_progress"), "leaf");
  assert.equal(statusTone("completed"), "success");
  assert.equal(statusTone("provider_no_show"), "danger");
  assert.equal(statusTone("expired"), "neutral");
  assert.equal(statusTone(null), "neutral");
});

test("the active job is the one furthest along; ties go to the earliest booked", () => {
  const rows = [
    { id: "late", status: "accepted" as const, scheduledDate: "2026-10-07T15:00:00Z", arrivedAt: null },
    { id: "early", status: "accepted" as const, scheduledDate: "2026-10-07T09:00:00Z", arrivedAt: null },
    { id: "moving", status: "en_route" as const, scheduledDate: "2026-10-07T18:00:00Z", arrivedAt: null },
  ];
  assert.equal(pickActiveJob(rows)!.id, "moving");
  assert.equal(pickActiveJob(rows.slice(0, 2))!.id, "early");
  assert.equal(pickActiveJob([{ id: "x", status: "in_progress" as const, scheduledDate: "2026-10-07T20:00:00Z", arrivedAt: null }, ...rows])!.id, "x");
  assert.equal(pickActiveJob([{ id: "done", status: "completed" as const, scheduledDate: "2026-10-07T09:00:00Z", arrivedAt: null }]), null);
  assert.equal(pickActiveJob(undefined), null);
});

test("today's schedule is the device's calendar day, earliest first", () => {
  const now = new Date(2026, 9, 7, 12, 0, 0).getTime();
  const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).toISOString();
  const rows = [{ scheduledDate: at(7, 16) }, { scheduledDate: at(8, 9) }, { scheduledDate: at(7, 8) }, { scheduledDate: "not a date" }];
  assert.deepEqual(jobsToday(rows, now).map((r) => r.scheduledDate), [at(7, 8), at(7, 16)]);
});

test("the next step is the server's primary action, with the server's reason when it is blocked", () => {
  assert.deepEqual(nextStep({ primaryAction: "START_NAVIGATION" }), { label: "On my way", blockedBy: null });
  assert.deepEqual(nextStep({ primaryAction: "MARK_ARRIVED", disabledReasons: { MARK_ARRIVED: "Available in 12 min" } }), { label: "I've arrived", blockedBy: "Available in 12 min" });
  // The start PIN is entered on the job screen: not a blocker.
  assert.deepEqual(nextStep({ primaryAction: "START_SERVICE", disabledReasons: { START_SERVICE: "Customer OTP required" } }), { label: "Start job", blockedBy: null });
  assert.deepEqual(nextStep({ primaryAction: "START_SERVICE", disabledReasons: { START_SERVICE: "Payment confirmation pending" } }), { label: "Start job", blockedBy: "Payment confirmation pending" });
  assert.equal(nextStep({ primaryAction: null }), null);
  assert.equal(nextStep(undefined), null);
});
