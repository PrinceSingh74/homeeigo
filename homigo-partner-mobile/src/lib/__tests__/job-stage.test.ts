/**
 * Which copy of a job the screen shows.
 *
 * The job screen used to keep "the most advanced copy it had ever seen" (a module-level hold that
 * merged timestamps forward and never let a stage go back). The server does take stages back:
 *   - a RESCHEDULE clears `arrivedAt` (the arrival belonged to the old appointment);
 *   - a REASSIGNMENT removes the job from this partner — `GET /api/bookings/:id` answers 404;
 *   - a CANCEL or a CUSTOMER NO-SHOW ends it — statuses the old rank ordered below every live one,
 *     so the held "arrived" copy won and the screen went on offering "Start job".
 *
 * The rule now: THE FRESH DETAIL RESPONSE IS AUTHORITATIVE. An optimistic copy survives only while
 * its mutation is in flight; a 404 clears it; a list row is a first-paint placeholder and nothing more.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_JOB_STATUSES,
  CHAT_CLOSED_MESSAGE,
  detailReadOf,
  isActiveJobStatus,
  isChatClosedError,
  isChatOpen,
  isJobGoneError,
  isOfferStatus,
  jobSubResourcesEnabled,
  optimisticStagePatch,
  resolveJobBooking,
} from "../job-stage.ts";
import { PartnerApiError } from "../api-error.ts";

type Row = { id: string; status: string; enRouteAt: string | null; arrivedAt: string | null; startedAt: string | null; completedAt: string | null };
const row = (over: Partial<Row> = {}): Row => ({ id: "b1", status: "en_route", enRouteAt: "2026-10-07T09:00:00.000Z", arrivedAt: null, startedAt: null, completedAt: null, ...over });
const arrived = row({ arrivedAt: "2026-10-07T09:30:00.000Z" });
const NO_HOLD = { booking: null, inFlight: false } as const;

test("a fresh detail response is shown exactly as sent — no timestamp is carried forward", () => {
  const r = resolveJobBooking({ detail: { kind: "data", booking: row() }, listRow: arrived, hold: NO_HOLD });
  assert.deepEqual(r, { booking: row(), source: "detail", gone: false, clearHold: false });
});

test("reschedule: arrivedAt goes back to null and the held 'arrived' copy does not survive", () => {
  const rescheduled = row({ status: "accepted", enRouteAt: null, arrivedAt: null });
  const r = resolveJobBooking({ detail: { kind: "data", booking: rescheduled }, listRow: arrived, hold: { booking: arrived, inFlight: false } });
  assert.equal(r.booking, rescheduled);
  assert.equal(r.booking?.arrivedAt, null);
  assert.equal(r.source, "detail");
  assert.equal(r.clearHold, true);
});

test("reassignment: a 404 means the job is gone — the hold and the list row are both dropped", () => {
  const r = resolveJobBooking({ detail: { kind: "gone" }, listRow: arrived, hold: { booking: arrived, inFlight: false } });
  assert.deepEqual(r, { booking: null, source: "none", gone: true, clearHold: true });
});

test("a 404 clears the hold even while a mutation is still in flight", () => {
  const r = resolveJobBooking({ detail: { kind: "gone" }, listRow: null, hold: { booking: arrived, inFlight: true } });
  assert.equal(r.booking, null);
  assert.equal(r.gone, true);
  assert.equal(r.clearHold, true);
});

test("cancel: the cancelled detail wins over a held live stage", () => {
  const cancelled = row({ status: "cancelled_by_user", arrivedAt: "2026-10-07T09:30:00.000Z" });
  const r = resolveJobBooking({ detail: { kind: "data", booking: cancelled }, listRow: arrived, hold: { booking: arrived, inFlight: false } });
  assert.equal(r.booking?.status, "cancelled_by_user");
  assert.equal(r.clearHold, true);
});

test("customer no-show: the closed detail wins although it still carries the arrival", () => {
  const noShow = row({ status: "customer_no_show", arrivedAt: "2026-10-07T09:30:00.000Z" });
  const r = resolveJobBooking({ detail: { kind: "data", booking: noShow }, listRow: arrived, hold: { booking: arrived, inFlight: false } });
  assert.equal(r.booking?.status, "customer_no_show");
  assert.equal(r.source, "detail");
});

test("while a mutation is in flight its optimistic copy is shown over the (older) detail", () => {
  const optimistic = row({ arrivedAt: "2026-10-07T09:31:00.000Z" });
  const r = resolveJobBooking({ detail: { kind: "data", booking: row() }, listRow: null, hold: { booking: optimistic, inFlight: true } });
  assert.deepEqual(r, { booking: optimistic, source: "held", gone: false, clearHold: false });
});

test("the moment the mutation settles the hold ends — whatever the detail says is shown", () => {
  const optimistic = row({ arrivedAt: "2026-10-07T09:31:00.000Z" });
  const r = resolveJobBooking({ detail: { kind: "data", booking: row() }, listRow: null, hold: { booking: optimistic, inFlight: false } });
  assert.equal(r.booking?.arrivedAt, null);
  assert.equal(r.source, "detail");
  assert.equal(r.clearHold, true);
});

test("a hold for another job is never shown", () => {
  const other = { ...arrived, id: "b2" };
  const r = resolveJobBooking({ detail: { kind: "data", booking: row() }, listRow: null, hold: { booking: other, inFlight: true } });
  assert.equal(r.source, "detail");
  assert.equal(r.clearHold, true);
});

test("before the detail has answered, a list row is the first paint — and only then", () => {
  assert.deepEqual(resolveJobBooking({ detail: { kind: "none" }, listRow: arrived, hold: NO_HOLD }), { booking: arrived, source: "list", gone: false, clearHold: false });
  assert.deepEqual(resolveJobBooking({ detail: { kind: "none" }, listRow: null, hold: NO_HOLD }), { booking: null, source: "none", gone: false, clearHold: false });
});

test("before the detail has answered, a settled hold is not shown in place of the list row", () => {
  const r = resolveJobBooking({ detail: { kind: "none" }, listRow: row(), hold: { booking: arrived, inFlight: false } });
  assert.equal(r.source, "list");
  assert.equal(r.clearHold, true);
});

/* ---- reading the detail query ---- */

test("404 is 'gone'; a network failure or a server error is not", () => {
  assert.equal(isJobGoneError(new PartnerApiError("Booking not found", { status: 404, code: "NOT_FOUND" })), true);
  assert.equal(isJobGoneError(new PartnerApiError("No connection", { status: 0, code: "NETWORK_ERROR" })), false);
  assert.equal(isJobGoneError(new PartnerApiError("Server error", { status: 500 })), false);
  assert.equal(isJobGoneError(new Error("404")), false);
  assert.equal(isJobGoneError(null), false);
});

test("detailReadOf: data → data, 404 → gone (even with stale data), other errors keep the last data", () => {
  const b = row();
  assert.deepEqual(detailReadOf({ data: b, error: null }), { kind: "data", booking: b });
  assert.deepEqual(detailReadOf({ data: b, error: new PartnerApiError("gone", { status: 404 }) }), { kind: "gone" });
  assert.deepEqual(detailReadOf({ data: b, error: new PartnerApiError("offline", { status: 0, code: "NETWORK_ERROR" }) }), { kind: "data", booking: b });
  assert.deepEqual(detailReadOf({ data: undefined, error: new PartnerApiError("offline", { status: 0, code: "NETWORK_ERROR" }) }), { kind: "none" });
  assert.deepEqual(detailReadOf({ data: undefined, error: null }), { kind: "none" });
});

/* ---- optimistic patches ---- */

test("an optimistic patch states only what the action itself sets", () => {
  const at = "2026-10-07T10:00:00.000Z";
  assert.deepEqual(optimisticStagePatch("ACCEPT", at), { status: "accepted" });
  assert.deepEqual(optimisticStagePatch("START_NAVIGATION", at), { status: "en_route", enRouteAt: at });
  assert.deepEqual(optimisticStagePatch("MARK_ARRIVED", at), { arrivedAt: at });
  assert.deepEqual(optimisticStagePatch("START_SERVICE", at), { status: "in_progress", startedAt: at });
  assert.deepEqual(optimisticStagePatch("COMPLETE_SERVICE", at), { status: "completed", completedAt: at });
  assert.equal(optimisticStagePatch("REPORT_NO_SHOW", at), null);
  assert.equal(optimisticStagePatch("CALL_CUSTOMER", at), null);
});

/* ---- what a status lets the partner read (ported from partner-web job-stage) ---- */

const ACTIVE = ["accepted", "assigned", "en_route", "in_progress"];
const NOT_ACTIVE = ["pending", "completed", "rejected", "cancelled_by_user", "cancelled_by_provider", "expired", "customer_no_show", "provider_no_show"];

test("exactly accepted, assigned, en_route and in_progress are an active job (either letter case)", () => {
  assert.deepEqual([...ACTIVE_JOB_STATUSES], ACTIVE);
  assert.deepEqual(ACTIVE.filter((s) => !isActiveJobStatus(s)), []);
  assert.deepEqual(NOT_ACTIVE.filter((s) => isActiveJobStatus(s)), []);
  assert.equal(isActiveJobStatus("IN_PROGRESS"), true);
  for (const s of [undefined, null, "", "something_new"]) assert.equal(isActiveJobStatus(s), false);
});

test("only pending is an offer", () => {
  assert.equal(isOfferStatus("pending"), true);
  assert.equal(isOfferStatus("PENDING"), true);
  for (const s of [...ACTIVE, "completed", "expired", undefined, null]) assert.equal(isOfferStatus(s), false);
});

test("an offer reads no sub-resource; a job the partner holds or held reads all; nothing before the status is known", () => {
  const ALL = ["actions", "requirements", "execution", "safety", "quality", "completion", "evidence"] as const;
  assert.deepEqual(ALL.filter((k) => jobSubResourcesEnabled("pending")[k]), []);
  assert.deepEqual(ALL.filter((k) => jobSubResourcesEnabled(undefined)[k]), []);
  for (const s of [...ACTIVE, "completed", "cancelled_by_user", "customer_no_show"]) {
    assert.deepEqual(ALL.filter((k) => !jobSubResourcesEnabled(s)[k]), [], s);
  }
});

test("chat is open only while the job is active; the server's CHAT_CLOSED refusal is recognised", () => {
  assert.deepEqual(ACTIVE.filter((s) => !isChatOpen(s)), []);
  assert.deepEqual([...NOT_ACTIVE, undefined, null].filter((s) => isChatOpen(s)), []);
  assert.equal(isChatClosedError(new PartnerApiError("Chat is not available", { status: 403, code: "CHAT_CLOSED" })), true);
  assert.equal(isChatClosedError(new PartnerApiError("Forbidden", { status: 403, code: "FORBIDDEN" })), false);
  assert.equal(isChatClosedError(new Error("CHAT_CLOSED")), false);
  assert.equal(CHAT_CLOSED_MESSAGE, "Chat is closed for this job.");
});
