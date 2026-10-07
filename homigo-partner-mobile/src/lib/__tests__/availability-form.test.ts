/**
 * The availability form never shows or saves an invented default. The old screen prefilled
 * 09:00–18:00, 5 jobs a day and 5 km when the server had null, then saved them as real settings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAvailabilityPatch, formFromServer, isHm, otherBreakWindows, parseAreas, type AvailabilityServer } from "../availability-form.ts";

const EMPTY: AvailabilityServer = {
  workingDays: [],
  workingHoursStart: null,
  workingHoursEnd: null,
  breakWindows: [],
  maxJobsPerDay: null,
  maxConcurrentJobs: 4,
  serviceRadiusKm: null,
  serviceRegions: [],
  city: null,
  baseLatitude: null,
  baseLongitude: null,
};

const SET: AvailabilityServer = {
  workingDays: ["Mon", "Tue", "Wed"],
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  breakWindows: [{ start: "12:30", end: "13:00" }],
  maxJobsPerDay: 6,
  maxConcurrentJobs: 2,
  serviceRadiusKm: 8,
  serviceRegions: ["Baner", "Aundh"],
  city: "Pune",
  baseLatitude: 18.55,
  baseLongitude: 73.78,
};

test("null from the server is an empty field — no 09:00, no 18:00, no 5 jobs, no 5 km", () => {
  const f = formFromServer(EMPTY);
  assert.equal(f.start, "");
  assert.equal(f.end, "");
  assert.equal(f.breakStart, "");
  assert.equal(f.maxDay, "");
  assert.equal(f.radius, "");
  assert.deepEqual(f.days, []);
  assert.equal(f.maxAtOnce, "4");
});

test("saving an untouched form sends nothing at all", () => {
  for (const server of [EMPTY, SET]) {
    const p = buildAvailabilityPatch(formFromServer(server), server);
    assert.equal(p.settings, null);
    assert.equal(p.serviceArea, null);
    assert.equal(p.unchanged, true);
    assert.deepEqual(p.errors, {});
  }
});

test("only the field the partner changed is sent", () => {
  const form = { ...formFromServer(SET), maxDay: "9" };
  const p = buildAvailabilityPatch(form, SET);
  assert.deepEqual(p.settings, { maxJobsPerDay: 9 });
  assert.equal(p.serviceArea, null);
});

test("hours go together: the server fills a missing half with its own default, so one half is refused here", () => {
  const p = buildAvailabilityPatch({ ...formFromServer(EMPTY), start: "10:00" }, EMPTY);
  assert.equal(p.settings, null);
  assert.match(p.errors.hours ?? "", /both/);
  const ok = buildAvailabilityPatch({ ...formFromServer(EMPTY), start: "10:00", end: "19:30" }, EMPTY);
  assert.deepEqual(ok.settings, { workingHoursStart: "10:00", workingHoursEnd: "19:30" });
});

test("times are 24-hour HH:MM and the start is before the end", () => {
  assert.equal(isHm("09:00"), true);
  assert.equal(isHm("23:59"), true);
  assert.equal(isHm("9:00"), false);
  assert.equal(isHm("24:00"), false);
  assert.equal(isHm("09:60"), false);
  assert.match(buildAvailabilityPatch({ ...formFromServer(SET), start: "9am" }, SET).errors.hours ?? "", /24-hour/);
  assert.match(buildAvailabilityPatch({ ...formFromServer(SET), start: "18:00" }, SET).errors.hours ?? "", /before/);
});

test("clearing the daily limit sends null (no limit); clearing the break sends an empty list", () => {
  const p = buildAvailabilityPatch({ ...formFromServer(SET), maxDay: "", breakStart: "", breakEnd: "" }, SET);
  assert.deepEqual(p.settings, { maxJobsPerDay: null, breakWindows: [] });
});

test("the form edits the FIRST break only: every other break window is sent back untouched", () => {
  const MANY: AvailabilityServer = {
    ...SET,
    breakWindows: [
      { start: "12:30", end: "13:00" },
      { start: "15:00", end: "15:15" },
      { start: "17:30", end: "17:45" },
    ],
  };
  // Changing the first break keeps the other two, in order.
  const edited = buildAvailabilityPatch({ ...formFromServer(MANY), breakStart: "12:00", breakEnd: "12:45" }, MANY);
  assert.deepEqual(edited.settings, {
    breakWindows: [
      { start: "12:00", end: "12:45" },
      { start: "15:00", end: "15:15" },
      { start: "17:30", end: "17:45" },
    ],
  });
  // Clearing the first break removes that one window, not all of them.
  const cleared = buildAvailabilityPatch({ ...formFromServer(MANY), breakStart: "", breakEnd: "" }, MANY);
  assert.deepEqual(cleared.settings, {
    breakWindows: [
      { start: "15:00", end: "15:15" },
      { start: "17:30", end: "17:45" },
    ],
  });
  // An unrelated change never sends break windows at all.
  assert.deepEqual(buildAvailabilityPatch({ ...formFromServer(MANY), maxDay: "7" }, MANY).settings, { maxJobsPerDay: 7 });
  assert.equal(otherBreakWindows(MANY), 2);
  assert.equal(otherBreakWindows(SET), 0);
  assert.equal(otherBreakWindows(EMPTY), 0);
});

test("limits are the server's: 1–50 a day, 1–20 at once, 1–50 km", () => {
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), maxDay: "51" }, SET).errors.maxDay);
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), maxDay: "2.5" }, SET).errors.maxDay);
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), maxAtOnce: "0" }, SET).errors.maxAtOnce);
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), maxAtOnce: "" }, SET).errors.maxAtOnce);
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), radius: "60" }, SET).errors.radius);
  assert.deepEqual(buildAvailabilityPatch({ ...formFromServer(SET), radius: "12.5" }, SET).serviceArea, { serviceRadiusKm: 12.5 });
});

test("an error in one group does not stop the other group being saved", () => {
  const p = buildAvailabilityPatch({ ...formFromServer(SET), maxDay: "999", city: "Mumbai" }, SET);
  assert.equal(p.settings, null);
  assert.deepEqual(p.serviceArea, { city: "Mumbai" });
  assert.equal(p.unchanged, false);
});

test("working days: order is normalised, removing all of them is refused", () => {
  const p = buildAvailabilityPatch({ ...formFromServer(SET), days: ["Sat", "Mon"] }, SET);
  assert.deepEqual(p.settings, { workingDays: ["Mon", "Sat"] });
  assert.ok(buildAvailabilityPatch({ ...formFromServer(SET), days: [] }, SET).errors.days);
  // Same days in another order is not a change.
  assert.equal(buildAvailabilityPatch({ ...formFromServer(SET), days: ["Wed", "Mon", "Tue"] }, SET).unchanged, true);
});

test("areas are split on commas; a new pin sends latitude and longitude together", () => {
  assert.deepEqual(parseAreas(" Baner ,, Aundh , "), ["Baner", "Aundh"]);
  const p = buildAvailabilityPatch({ ...formFromServer(SET), areas: "Baner, Wakad", lat: 18.6, lng: 73.76 }, SET);
  assert.deepEqual(p.serviceArea, { serviceRegions: ["Baner", "Wakad"], baseLatitude: 18.6, baseLongitude: 73.76 });
  const half = buildAvailabilityPatch({ ...formFromServer(EMPTY), lat: 18.6, lng: null }, EMPTY);
  assert.equal(half.serviceArea, null);
});
