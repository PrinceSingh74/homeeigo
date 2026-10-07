/**
 * How the money and performance screens word what the server sent. A value that was not sent is
 * "—" (never 0), a status the app does not know keeps the server's word, and no two server states
 * are merged into one label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DASH,
  confidencePercent,
  count,
  formatCalendarDay,
  formatDay,
  formatDayTime,
  hourOfDay,
  hoursText,
  humanise,
  percent,
  rupees,
  starsLabel,
  updatedAgo,
  withdrawalInProgress,
  withdrawalStatus,
} from "../money-format.ts";

test("rupees: Indian grouping, paise kept, nothing rounded away", () => {
  assert.equal(rupees(0), "₹0");
  assert.equal(rupees(658), "₹658");
  assert.equal(rupees(1234), "₹1,234");
  assert.equal(rupees(123456.5), "₹1,23,456.5");
  assert.equal(rupees(131.6), "₹131.6");
  assert.equal(rupees(99.99), "₹99.99");
  assert.equal(rupees(10000000), "₹1,00,00,000");
});

test("rupees: a value the server did not send is a dash, not ₹0", () => {
  assert.equal(rupees(null), DASH);
  assert.equal(rupees(undefined), DASH);
  assert.equal(rupees(Number.NaN), DASH);
});

test("rupees: a negative amount carries a minus sign; a rounding-zero does not", () => {
  assert.equal(rupees(-250), "− ₹250");
  assert.equal(rupees(-0.001), "₹0");
});

test("rupees: whole amounts match the device script's rounded label", () => {
  // e2e/native-android-section04-finance.ts looks for ₹ + Math.round(n).toLocaleString("en-IN").
  for (const n of [0, 5, 1200, 45210, 1500000]) {
    assert.equal(rupees(n), `₹${Math.round(n).toLocaleString("en-IN")}`);
  }
});

test("count and percent: sent values as they are, missing values as a dash", () => {
  assert.equal(count(0), "0");
  assert.equal(count(12), "12");
  assert.equal(count(null), DASH);
  assert.equal(percent(80), "80%");
  assert.equal(percent(87.46), "87.5%");
  assert.equal(percent(undefined), DASH);
});

test("confidencePercent: the server's 0–1 number as a percentage, nothing for a missing or impossible one", () => {
  assert.equal(confidencePercent(0.85), "85%");
  assert.equal(confidencePercent(0), "0%");
  assert.equal(confidencePercent(1), "100%");
  assert.equal(confidencePercent(null), null);
  assert.equal(confidencePercent(1.4), null);
  assert.equal(confidencePercent(-0.1), null);
});

test("humanise: an enum value in sentence case; nothing sent is a dash", () => {
  assert.equal(humanise("IN_PROGRESS"), "In progress");
  assert.equal(humanise("WITHIN_TYPICAL_DAY"), "Within typical day");
  assert.equal(humanise("gold"), "Gold");
  assert.equal(humanise(""), DASH);
  assert.equal(humanise(null), DASH);
});

test("formatDay / formatDayTime: readable, and a dash for a missing or unreadable instant", () => {
  const local = new Date(2026, 9, 7, 14, 5).toISOString();
  assert.equal(formatDay(local), "7 Oct 2026");
  assert.equal(formatDayTime(local), "7 Oct 2026, 2:05 pm");
  assert.equal(formatDayTime(new Date(2026, 0, 1, 0, 30).toISOString()), "1 Jan 2026, 12:30 am");
  assert.equal(formatDay(null), DASH);
  assert.equal(formatDay("not a date"), DASH);
  assert.equal(formatDayTime(undefined), DASH);
});

test("formatCalendarDay: a YYYY-MM-DD day is read as written, never moved by a time zone", () => {
  assert.equal(formatCalendarDay("2026-10-01"), "1 Oct");
  assert.equal(formatCalendarDay("2026-01-31", true), "31 Jan 2026");
  assert.equal(formatCalendarDay("2026-W3"), "2026-W3");
});

test("updatedAgo: says how old the reading is, and claims nothing without an instant", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  assert.equal(updatedAgo("2026-10-07T11:59:40.000Z", now), "Updated just now");
  assert.equal(updatedAgo("2026-10-07T11:48:00.000Z", now), "Updated 12 min ago");
  assert.equal(updatedAgo("2026-10-07T09:00:00.000Z", now), "Updated 3 h ago");
  assert.equal(updatedAgo("2026-10-06T11:00:00.000Z", now), "Updated 1 day ago");
  assert.equal(updatedAgo("2026-10-01T12:00:00.000Z", now), "Updated 6 days ago");
  assert.equal(updatedAgo(null, now), null);
  assert.equal(updatedAgo("", now), null);
  assert.equal(updatedAgo("garbage", now), null);
});

test("updatedAgo: a reading stamped slightly in the future (clock skew) is 'just now', not a negative age", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  assert.equal(updatedAgo("2026-10-07T12:00:30.000Z", now), "Updated just now");
});

test("hoursText and hourOfDay", () => {
  assert.equal(hoursText(1.5), "1.5 h");
  assert.equal(hoursText(0), "0 h");
  assert.equal(hoursText(null), DASH);
  assert.equal(hourOfDay(0), "12 am");
  assert.equal(hourOfDay(9), "9 am");
  assert.equal(hourOfDay(12), "12 pm");
  assert.equal(hourOfDay(18), "6 pm");
  assert.equal(hourOfDay(24), "24");
});

test("withdrawalStatus: one label per server state — REQUESTED and APPROVED are not merged", () => {
  assert.equal(withdrawalStatus("REQUESTED").label, "Requested");
  assert.equal(withdrawalStatus("APPROVED").label, "Approved");
  assert.notEqual(withdrawalStatus("REQUESTED").label, withdrawalStatus("APPROVED").label);
  assert.equal(withdrawalStatus("PROCESSING").label, "Processing");
  assert.deepEqual(withdrawalStatus("COMPLETED"), { label: "Completed", tone: "success" });
  assert.deepEqual(withdrawalStatus("FAILED"), { label: "Failed", tone: "danger" });
  assert.equal(withdrawalStatus("CANCELLED").label, "Cancelled");
  assert.deepEqual(withdrawalStatus("REVERSED"), { label: "Reversed", tone: "danger" });
});

test("withdrawalStatus: the withdraw answer's lowercase status reads the same; an unknown one keeps the server's word", () => {
  assert.equal(withdrawalStatus("requested").label, "Requested");
  assert.deepEqual(withdrawalStatus("ON_HOLD"), { label: "On hold", tone: "neutral" });
  assert.deepEqual(withdrawalStatus(null), { label: DASH, tone: "neutral" });
});

test("withdrawalInProgress: exactly the states the server counts as pending", () => {
  for (const s of ["REQUESTED", "APPROVED", "PROCESSING", "processing"]) assert.equal(withdrawalInProgress(s), true, s);
  for (const s of ["COMPLETED", "FAILED", "CANCELLED", "REVERSED", "", null]) assert.equal(withdrawalInProgress(s), false, String(s));
});

test("starsLabel", () => {
  assert.equal(starsLabel(1), "1 out of 5 star");
  assert.equal(starsLabel(4), "4 out of 5 stars");
});
