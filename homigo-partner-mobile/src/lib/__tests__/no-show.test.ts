/**
 * "Customer not available" on the job screen. The server decides everything that matters — whether
 * the wait is served, whether the fee applies, and the sentence that says so (`noShow` on
 * `GET /api/bookings/:id/actions`). What is tested here is the little the app works out for itself:
 * the live countdown between two server answers, and which controls a given answer puts on screen.
 *
 * Ported from apps/partner-web/tests/no-show.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorPhotoUploadId, noShowResultView, noShowView, NO_SHOW_REFETCH_FLOOR_MS } from "../no-show.ts";
import type { NoShowPreview } from "../../types/partner.ts";

const T0 = 1_760_000_000_000;
const MIN = 60_000;

const preview = (over: Partial<NoShowPreview> = {}): NoShowPreview => ({
  canReport: false,
  waitedMinutes: 10,
  graceMinutes: 15,
  minutesLeft: 5,
  feeWillApply: false,
  feePercent: 50,
  reason: "NO_DOOR_PHOTO",
  hasDoorPhoto: false,
  message: "Add a photo at the door, with location on, before you report.",
  ...over,
});

test("at the moment of the answer it shows the server's minutes", () => {
  const v = noShowView(preview(), T0, T0);
  assert.equal(v.waitLabel, "You can report in 5 min");
  assert.equal(v.minutesLeft, 5);
  assert.equal(v.canReport, false);
  assert.equal(v.shouldRefetch, false);
});

test("whole minutes come off as they pass; a part minute does not", () => {
  assert.equal(noShowView(preview(), T0, T0 + 59_000).minutesLeft, 5);
  assert.equal(noShowView(preview(), T0, T0 + 2 * MIN + 1).minutesLeft, 3);
  assert.equal(noShowView(preview(), T0, T0 + 2 * MIN + 1).waitLabel, "You can report in 3 min");
});

// Found on the Android emulator 2026-10-08: a partner who arrived long before the booked time was
// told "You can report in 23975 min". The number is the server's; only the unit it is read in changes.
test("a long wait is said in hours and days, a short one stays in minutes", () => {
  const label = (minutesLeft: number) => noShowView(preview({ minutesLeft }), T0, T0).waitLabel;
  assert.equal(label(1), "You can report in 1 min");
  assert.equal(label(89), "You can report in 89 min");
  assert.equal(label(90), "You can report in 1 hr 30 min");
  assert.equal(label(120), "You can report in 2 hr");
  assert.equal(label(1439), "You can report in 23 hr 59 min");
  assert.equal(label(1440), "You can report in 1 day");
  assert.equal(label(23975), "You can report in 16 days 15 hr");
  // The count the screen keeps is still whole minutes.
  assert.equal(noShowView(preview({ minutesLeft: 23975 }), T0, T0).minutesLeft, 23975);
});

test("at zero it asks the server again instead of enabling the button on the local clock", () => {
  const v = noShowView(preview(), T0, T0 + 5 * MIN);
  assert.equal(v.minutesLeft, 0);
  assert.equal(v.canReport, false);
  assert.equal(v.shouldRefetch, true);
  assert.equal(v.waitLabel, "Checking the wait…");
});

test("it never counts below zero, and a clock that ran backwards does not add minutes", () => {
  assert.equal(noShowView(preview(), T0, T0 + 90 * MIN).minutesLeft, 0);
  assert.equal(noShowView(preview(), T0, T0 - 10 * MIN).minutesLeft, 5);
});

test("an answer that just arrived is not asked for again straight away (no refetch loop)", () => {
  const fresh = preview({ minutesLeft: 0, waitedMinutes: 15 });
  assert.equal(noShowView(fresh, T0, T0 + NO_SHOW_REFETCH_FLOOR_MS - 1).shouldRefetch, false);
  assert.equal(noShowView(fresh, T0, T0 + NO_SHOW_REFETCH_FLOOR_MS).shouldRefetch, true);
});

test("once the server says it can be reported, it can — whatever the local clock says", () => {
  const v = noShowView(preview({ canReport: true, waitedMinutes: 16, minutesLeft: 0 }), T0, T0 - 60 * MIN);
  assert.equal(v.canReport, true);
  assert.equal(v.waitLabel, "You can report now");
  assert.equal(v.shouldRefetch, false);
});

test("a wait the server could not measure stays closed and is not polled", () => {
  const v = noShowView(preview({ waitedMinutes: null, minutesLeft: null }), T0, T0 + 30 * MIN);
  assert.equal(v.canReport, false);
  assert.equal(v.minutesLeft, null);
  assert.equal(v.shouldRefetch, false);
  assert.equal(v.waitLabel, "Not available yet");
});

test("no door photo on record: the photo is asked for", () => {
  assert.equal(noShowView(preview(), T0, T0).doorPhoto, "NEEDED");
});

test("a door photo on record: it says so and stops asking", () => {
  assert.equal(noShowView(preview({ hasDoorPhoto: true, feeWillApply: true, reason: null }), T0, T0).doorPhoto, "ADDED");
});

test("a photo that would change nothing is not asked for (vouched arrival, nothing prepaid)", () => {
  assert.equal(noShowView(preview({ reason: "ARRIVAL_VOUCHED" }), T0, T0).doorPhoto, "NOT_ASKED");
  assert.equal(noShowView(preview({ reason: "NOT_PREPAID" }), T0, T0).doorPhoto, "NOT_ASKED");
  assert.equal(noShowView(preview({ reason: "ARRIVAL_VOUCHED", hasDoorPhoto: true }), T0, T0).doorPhoto, "ADDED");
});

test("the sentence shown is the server's, untouched", () => {
  assert.equal(noShowView(preview({ message: "Server sentence." }), T0, T0).message, "Server sentence.");
});

test("each photo gets its own upload id, so another photo is not refused as a duplicate", () => {
  assert.equal(doorPhotoUploadId(T0), `m-door-${T0}`);
  assert.notEqual(doorPhotoUploadId(T0 + 1), doorPhotoUploadId(T0));
});

test("no fee taken: the server's message and its note", () => {
  assert.deepEqual(
    noShowResultView({ message: "No-show recorded", status: "customer_no_show", feeAmount: 0, feeWithheld: "NO_DOOR_PHOTO", feeNote: "No fee was taken: add a photo next time." }),
    { message: "No-show recorded", feeNote: "No fee was taken: add a photo next time.", feeRecorded: null },
  );
});

test("fee taken: the amount the server disclosed, and no note", () => {
  assert.deepEqual(noShowResultView({ message: "No-show recorded", status: "customer_no_show", feeAmount: 275 }), {
    message: "No-show recorded",
    feeNote: null,
    feeRecorded: 275,
  });
});

/* The type mirrors the backend's preview, field for field — read from both sources. */
const fieldsOf = (source: string, name: string): string[] => {
  const at = source.indexOf(`export type ${name} = {`);
  if (at < 0) throw new Error(`${name} not found`);
  const block = source.slice(at, source.indexOf("\n};", at));
  return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!).sort();
};
const mobileRoot = join(import.meta.dirname, "..", "..", "..");
const backendSrc = join(mobileRoot, "..", "apps", "backend", "src");
const types = readFileSync(join(mobileRoot, "src", "types", "partner.ts"), "utf8").replace(/\r\n/g, "\n");

test("NoShowPreview has exactly the backend's fields", () => {
  const backend = readFileSync(join(backendSrc, "services", "booking-no-show.service.ts"), "utf8").replace(/\r\n/g, "\n");
  const theirs = fieldsOf(backend, "NoShowPreview");
  assert.equal(theirs.length, 9);
  assert.deepEqual(fieldsOf(types, "NoShowPreview"), theirs);
});

test("the actions answer carries it as `noShow`, as the route sends it", () => {
  const route = readFileSync(join(backendSrc, "routes", "bookings.ts"), "utf8");
  assert.ok(route.includes("...(noShow ? { noShow } : {})"));
  assert.match(types, /noShow\?: NoShowPreview/);
});
