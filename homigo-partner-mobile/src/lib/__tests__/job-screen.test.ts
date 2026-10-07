/**
 * What the job screen draws from a booking and the server's answers (`lib/job-screen.ts`).
 *
 * The rules under test are the server's, read off the screen's side:
 *  - a stage is reached only on what the payload says now (a cleared `arrivedAt` is "not arrived");
 *  - a closed job has its own plain summary and no current stage;
 *  - position refusals keep the server's sentence, and "Turn on location" is offered only where a
 *    setting can help;
 *  - PIN timing and attempts come from the refusal's `data`, never from a guessed number;
 *  - the proof gate mirrors `qualityBlocksCompletion` and never blocks what it cannot count.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PartnerApiError, networkError } from "../api-error.ts";
import {
  arrivalGateLines,
  attemptsLeftText,
  canPartnerCancel,
  chatBubble,
  completionProof,
  failureSentence,
  isOfflineError,
  jobRailSteps,
  jobTerminalSummary,
  LOCATION_REFUSAL_CODES,
  locationRefusal,
  mapsUrl,
  OFFLINE_SENTENCE,
  photosByStage,
  photoStagesOpen,
  pickJobPolicy,
  pinResendWait,
  pinSendLabel,
  PROOF_BEFORE_AFTER_HINT,
  PROOF_PHOTO_HINT,
  reasonState,
  refusalCode,
  startPinFailure,
} from "../job-screen.ts";

const fmt = (iso: string) => `at ${iso.slice(11, 16)}`;
const T1 = "2026-10-07T09:00:00.000Z";
const T2 = "2026-10-07T09:30:00.000Z";
const T3 = "2026-10-07T09:45:00.000Z";
const T4 = "2026-10-07T11:00:00.000Z";
const states = (steps: ReturnType<typeof jobRailSteps>) => steps.map((s) => s.state).join(",");
const refusal = (code: string, message: string, status = 400, data: Record<string, unknown> | null = null, retryAfter: number | null = null) =>
  new PartnerApiError(message, { status, code, data, retryAfter });

/* ------------------------------------------------------------- stage rail */

test("the rail has the five stages in order, and an offer has reached none of them", () => {
  const steps = jobRailSteps({ status: "pending" }, fmt);
  assert.deepEqual(steps.map((s) => s.label), ["Accepted", "On the way", "Arrived", "Started", "Completed"]);
  assert.equal(states(steps), "todo,todo,todo,todo,todo");
});

test("the last reached stage is the current one and carries the server's time", () => {
  assert.equal(states(jobRailSteps({ status: "accepted" }, fmt)), "current,todo,todo,todo,todo");
  const enRoute = jobRailSteps({ status: "en_route", enRouteAt: T1 }, fmt);
  assert.equal(states(enRoute), "done,current,todo,todo,todo");
  assert.equal(enRoute[1]!.note, "at 09:00");
  const arrived = jobRailSteps({ status: "en_route", enRouteAt: T1, arrivedAt: T2 }, fmt);
  assert.equal(states(arrived), "done,done,current,todo,todo");
  assert.equal(arrived[2]!.note, "at 09:30");
  assert.equal(states(jobRailSteps({ status: "in_progress", enRouteAt: T1, arrivedAt: T2, startedAt: T3 }, fmt)), "done,done,done,current,todo");
});

test("there is no accept time on the payload, so Accepted never shows one", () => {
  for (const s of jobRailSteps({ status: "completed", enRouteAt: T1, arrivedAt: T2, startedAt: T3, completedAt: T4 }, fmt)) {
    if (s.key === "accepted") assert.equal(s.note, null);
  }
});

test("an arrival the server took back (reschedule / reassignment) reads as not arrived", () => {
  const steps = jobRailSteps({ status: "en_route", enRouteAt: T1, arrivedAt: null }, fmt);
  assert.equal(steps[2]!.state, "todo");
  assert.equal(steps[2]!.note, null);
  assert.equal(steps[1]!.state, "current");
});

test("arrival on an accepted job (arrival is a timestamp, not a status) still reaches Arrived", () => {
  assert.equal(states(jobRailSteps({ status: "accepted", arrivedAt: T2 }, fmt)), "done,done,current,todo,todo");
});

test("a completed job has every step done; a stage without a timestamp shows no invented time", () => {
  const steps = jobRailSteps({ status: "completed", completedAt: T4 }, fmt);
  assert.equal(states(steps), "done,done,done,done,done");
  assert.deepEqual(steps.map((s) => s.note), [null, null, null, null, "at 11:00"]);
});

test("a job closed without work keeps what was reached ticked and has no current stage", () => {
  const noShow = jobRailSteps({ status: "customer_no_show", enRouteAt: T1, arrivedAt: T2 }, fmt);
  assert.equal(states(noShow), "done,done,done,todo,todo");
  assert.equal(states(jobRailSteps({ status: "expired" }, fmt)), "todo,todo,todo,todo,todo");
  assert.equal(states(jobRailSteps({ status: "cancelled_by_user", enRouteAt: T1 }, fmt)), "done,done,todo,todo,todo");
});

/* ------------------------------------------------------- which answer rules */

test("the server's /actions answer rules while it is for the stage on screen", () => {
  const server = { stage: "ARRIVED", primaryAction: "START_SERVICE" };
  const mirror = { stage: "ARRIVED", primaryAction: "START_SERVICE", local: true };
  assert.deepEqual(pickJobPolicy(server, mirror), { policy: server, source: "server", stale: false });
});

test("a cached /actions answer for an older stage is not shown: the mirror of the fresh booking is, and it is asked for again", () => {
  // The customer rescheduled: the detail now has arrivedAt null (EN_ROUTE), /actions still says ARRIVED.
  const server = { stage: "ARRIVED", primaryAction: "START_SERVICE" };
  const mirror = { stage: "EN_ROUTE", primaryAction: "MARK_ARRIVED" };
  assert.deepEqual(pickJobPolicy(server, mirror), { policy: mirror, source: "mirror", stale: true });
});

test("with no server answer yet the mirror is the first paint, and nothing is stale", () => {
  const mirror = { stage: "ACCEPTED" };
  assert.deepEqual(pickJobPolicy(null, mirror), { policy: mirror, source: "mirror", stale: false });
  assert.deepEqual(pickJobPolicy(undefined, mirror), { policy: mirror, source: "mirror", stale: false });
});

/* ----------------------------------------------------------- closed states */

test("cancelled, expired, customer no-show and missed visit each have their own plain summary", () => {
  const titles = ["cancelled_by_user", "cancelled_by_provider", "rejected", "expired", "customer_no_show", "provider_no_show"].map((s) => jobTerminalSummary(s)?.title);
  assert.deepEqual(titles, ["Cancelled by the customer", "You cancelled this job", "You declined this job", "This job expired", "Customer was not available", "Missed visit"]);
  assert.equal(new Set(titles).size, titles.length);
});

test("a live job has no terminal summary; statuses are read in either case", () => {
  for (const s of ["pending", "accepted", "assigned", "en_route", "in_progress", "", null, undefined, "something_new"]) assert.equal(jobTerminalSummary(s), null);
  assert.equal(jobTerminalSummary("CUSTOMER_NO_SHOW")?.title, "Customer was not available");
  assert.equal(jobTerminalSummary("completed")?.tone, "success");
});

test("the partner's own reason is shown only on the partner's own cancel", () => {
  assert.equal(jobTerminalSummary("cancelled_by_provider", "  Vehicle broke down  ")?.message, "Your reason: Vehicle broke down");
  assert.equal(jobTerminalSummary("cancelled_by_provider", null)?.message, "This job was cancelled from your side.");
  assert.doesNotMatch(jobTerminalSummary("cancelled_by_user", "someone else's words")!.message, /someone else/);
});

/* ------------------------------------------------------------------ cancel */

test("cancel is offered only for a held, live job the server has answered for", () => {
  for (const stage of ["ACCEPTED", "EN_ROUTE", "ARRIVED", "STARTED", "IN_PROGRESS"]) assert.equal(canPartnerCancel({ status: "en_route", serverStage: stage }), true, stage);
  assert.equal(canPartnerCancel({ status: "ACCEPTED", serverStage: "accepted" }), true);
  // Before /actions answers: not shown.
  assert.equal(canPartnerCancel({ status: "accepted", serverStage: null }), false);
  assert.equal(canPartnerCancel({ status: "accepted", serverStage: undefined }), false);
  // An offer is declined, not cancelled; a closed job has nothing to cancel.
  assert.equal(canPartnerCancel({ status: "pending", serverStage: "OFFERED" }), false);
  for (const status of ["completed", "cancelled_by_user", "cancelled_by_provider", "expired", "customer_no_show", "provider_no_show", "rejected"]) {
    assert.equal(canPartnerCancel({ status, serverStage: "IN_PROGRESS" }), false, status);
  }
  // The server says the job is already over.
  for (const stage of ["COMPLETED", "CANCELLED", "CUSTOMER_NO_SHOW", "EXPIRED", "OFFERED"]) assert.equal(canPartnerCancel({ status: "in_progress", serverStage: stage }), false, stage);
});

test("the reason is 3 to 500 characters after trimming — the bounds of the cancel and reject routes", () => {
  assert.deepEqual(reasonState("  ab  "), { value: "ab", valid: false, hint: "Write at least 3 characters." });
  assert.deepEqual(reasonState("  abc  "), { value: "abc", valid: true, hint: null });
  assert.equal(reasonState("x".repeat(500)).valid, true);
  assert.equal(reasonState("x".repeat(501)).valid, false);
  assert.equal(reasonState("   ").valid, false);
  const schema = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "routes", "bookings.ts"), "utf8");
  assert.match(schema, /reason: \{ maxLen: 500 \}/, "the cancel route no longer caps the reason at 500 — update REASON_MAX");
});

/* ---------------------------------------------------------- server refusals */

test("offline is told apart from a refusal", () => {
  assert.equal(isOfflineError(networkError()), true);
  assert.equal(isOfflineError(refusal("FORBIDDEN", "Forbidden", 403)), false);
  assert.equal(isOfflineError(new Error("boom")), false);
  assert.equal(failureSentence(networkError()), OFFLINE_SENTENCE);
  assert.equal(failureSentence(refusal("INVALID_STATUS", "Cannot cancel a completed booking")), "Cannot cancel a completed booking");
  assert.equal(failureSentence(null, "fallback"), "fallback");
  assert.equal(refusalCode(refusal("OTP_INVALID", "x")), "OTP_INVALID");
  assert.equal(refusalCode(new Error("x")), null);
});

test("every position refusal keeps the server's sentence unchanged", () => {
  assert.deepEqual([...LOCATION_REFUSAL_CODES], ["LOCATION_REQUIRED", "LOCATION_INVALID", "OUTSIDE_SERVICE_AREA", "LOCATION_UNCONFIRMED", "LOCATION_MISMATCH"]);
  for (const code of LOCATION_REFUSAL_CODES) {
    const sentence = `Server sentence for ${code}.`;
    const r = locationRefusal(refusal(code, sentence, code.startsWith("LOCATION_UN") || code === "LOCATION_MISMATCH" ? 409 : 400), false);
    assert.equal(r?.code, code);
    assert.equal(r?.message, sentence);
  }
});

test("'Turn on location' is offered where a setting can help, and not when the server holds a position elsewhere", () => {
  assert.equal(locationRefusal(refusal("LOCATION_REQUIRED", "s"), true)?.offerLocationSettings, true);
  assert.equal(locationRefusal(refusal("LOCATION_REQUIRED", "s"), false)?.offerLocationSettings, true);
  assert.equal(locationRefusal(refusal("LOCATION_UNCONFIRMED", "s", 409), false)?.offerLocationSettings, true);
  assert.equal(locationRefusal(refusal("OUTSIDE_SERVICE_AREA", "s"), false)?.offerLocationSettings, false);
  assert.equal(locationRefusal(refusal("LOCATION_MISMATCH", "s", 409), false)?.offerLocationSettings, false);
  // …unless the phone itself had no fix to send.
  assert.equal(locationRefusal(refusal("LOCATION_MISMATCH", "s", 409), true)?.offerLocationSettings, true);
});

test("anything that is not a position refusal is left to the ordinary error line", () => {
  assert.equal(locationRefusal(refusal("OTP_INVALID", "Incorrect PIN"), true), null);
  assert.equal(locationRefusal(refusal("REQUIREMENT_GATE_BLOCKED", "x", 409), false), null);
  assert.equal(locationRefusal(networkError(), true), null);
  assert.equal(locationRefusal(new Error("LOCATION_REQUIRED"), true), null);
});

test("the position codes are the ones the server's routes answer with", () => {
  const routes = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "routes", "bookings.ts"), "utf8");
  const service = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "services", "arrival-position.service.ts"), "utf8");
  for (const code of LOCATION_REFUSAL_CODES) assert.ok(routes.includes(code) || service.includes(code), `${code} is no longer sent by the backend`);
});

test("a wrong PIN shows the server's sentence and its attempts-left count", () => {
  const f = startPinFailure(refusal("OTP_INVALID", "Incorrect PIN", 400, { attemptsLeft: 2 }));
  assert.deepEqual(f, { message: "Incorrect PIN", kind: "INVALID", attemptsLeft: 2, needsNewPin: false });
  assert.equal(attemptsLeftText(f.attemptsLeft), "2 attempts left");
  assert.equal(attemptsLeftText(1), "1 attempt left");
  assert.equal(attemptsLeftText(0), "0 attempts left");
});

test("attempts left is never invented: no count from the server means no line", () => {
  assert.equal(startPinFailure(refusal("OTP_INVALID", "Incorrect PIN", 400, { attemptsLeft: null })).attemptsLeft, null);
  assert.equal(startPinFailure(refusal("OTP_INVALID", "Incorrect PIN")).attemptsLeft, null);
  assert.equal(attemptsLeftText(null), null);
  // A count on a code that is not OTP_INVALID is not a PIN-attempt count.
  assert.equal(startPinFailure(refusal("OTP_LOCKED", "Too many attempts", 400, { attemptsLeft: 0 })).attemptsLeft, null);
});

test("an expired, locked or never-sent PIN needs a new one; other refusals keep their own sentence", () => {
  assert.deepEqual(
    ["OTP_EXPIRED", "OTP_LOCKED", "OTP_NOT_REQUESTED", "OTP_REQUIRED"].map((c) => {
      const f = startPinFailure(refusal(c, `sentence ${c}`));
      return [f.kind, f.needsNewPin, f.message];
    }),
    [
      ["EXPIRED", true, "sentence OTP_EXPIRED"],
      ["LOCKED", true, "sentence OTP_LOCKED"],
      ["NOT_REQUESTED", true, "sentence OTP_NOT_REQUESTED"],
      ["NOT_REQUESTED", true, "sentence OTP_REQUIRED"],
    ],
  );
  const hold = startPinFailure(refusal("SAFETY_HOLD_ACTIVE", "A safety hold is active", 409));
  assert.deepEqual([hold.kind, hold.needsNewPin, hold.message], ["OTHER", false, "A safety hold is active"]);
  assert.equal(startPinFailure(networkError()).message, OFFLINE_SENTENCE);
});

test("the resend wait is the server's retryAfterSec (or its retryAfter), never a default", () => {
  assert.equal(pinResendWait(refusal("RESEND_COOLDOWN", "Wait", 429, { retryAfterSec: 24 })), 24);
  assert.equal(pinResendWait(refusal("RESEND_COOLDOWN", "Wait", 429, { retryAfterSec: 23.2 })), 24);
  assert.equal(pinResendWait(refusal("RATE_LIMITED", "Wait", 429, null, 60)), 60);
  assert.equal(pinResendWait(refusal("RESEND_COOLDOWN", "Wait", 429)), null);
  assert.equal(pinResendWait(refusal("RESEND_COOLDOWN", "Wait", 429, { retryAfterSec: 0 })), null);
  assert.equal(pinResendWait(new Error("x")), null);
});

test("the send button reads Send PIN, Resend in N s, then Resend PIN", () => {
  assert.equal(pinSendLabel(false, 0), "Send PIN");
  assert.equal(pinSendLabel(true, 30), "Resend in 30 s");
  assert.equal(pinSendLabel(false, 12), "Resend in 12 s");
  assert.equal(pinSendLabel(true, 0), "Resend PIN");
});

/* ------------------------------------------------------------------ photos */

const photo = (id: string, stage: string, over: Partial<{ isCurrent: boolean; mediaAccessUrl: string | null }> = {}) => ({
  id,
  stage,
  isCurrent: true,
  mediaAccessUrl: `/api/bookings/b1/evidence/${id}/media`,
  capturedAt: T1,
  ...over,
});

test("photos are grouped Arrival, Start, Completion — always all three, in that order", () => {
  const groups = photosByStage([photo("c", "COMPLETION"), photo("a", "ARRIVAL"), photo("s", "start")]);
  assert.deepEqual(groups.map((g) => [g.stage, g.label, g.photos.map((p) => p.id)]), [
    ["ARRIVAL", "Arrival", ["a"]],
    ["START", "Start", ["s"]],
    ["COMPLETION", "Completion", ["c"]],
  ]);
  assert.deepEqual(photosByStage(undefined).map((g) => g.photos.length), [0, 0, 0]);
});

test("a position stamp without a photo and a replaced photo are not pictures to show", () => {
  const groups = photosByStage([photo("stamp", "ARRIVAL", { mediaAccessUrl: null }), photo("old", "ARRIVAL", { isCurrent: false }), photo("door", "ARRIVAL")]);
  assert.deepEqual(groups[0]!.photos.map((p) => p.id), ["door"]);
});

test("which stages take a photo follows the server's stage; nothing once the job is over", () => {
  assert.deepEqual(photoStagesOpen("ACCEPTED"), ["ARRIVAL"]);
  assert.deepEqual(photoStagesOpen("EN_ROUTE"), ["ARRIVAL"]);
  assert.deepEqual(photoStagesOpen("ARRIVED"), ["ARRIVAL"]);
  assert.deepEqual(photoStagesOpen("IN_PROGRESS"), ["START", "COMPLETION"]);
  assert.deepEqual(photoStagesOpen("STARTED"), ["START", "COMPLETION"]);
  for (const s of ["OFFERED", "COMPLETED", "CANCELLED", "CUSTOMER_NO_SHOW", "EXPIRED", null, undefined, ""]) assert.deepEqual(photoStagesOpen(s), []);
});

test("no proof policy: Complete is never held back, and the ask is an invitation", () => {
  for (const quality of [null, undefined, { proofRequired: false, beforeAfterPhotos: false }]) {
    const p = completionProof(quality, [], 0);
    assert.deepEqual([p.required, p.ready, p.hint], [false, true, null]);
    assert.match(p.ask, /sent when you complete the job/);
  }
});

test("proofRequired: the button says so until one stored or staged photo exists", () => {
  const q = { proofRequired: true };
  assert.deepEqual([completionProof(q, [], 0).ready, completionProof(q, [], 0).hint], [false, PROOF_PHOTO_HINT]);
  assert.equal(completionProof(q, [], 1).ready, true);
  assert.equal(completionProof(q, [photo("a", "ARRIVAL")], 0).ready, true);
  // A row without a stored photo is not proof.
  assert.equal(completionProof(q, [photo("stamp", "ARRIVAL", { mediaAccessUrl: null })], 0).ready, false);
  assert.match(completionProof(q, [], 0).ask, /required/);
});

test("beforeAfterPhotos: a before photo (Arrival or Start) AND a completion photo", () => {
  const q = { beforeAfterPhotos: true };
  assert.equal(completionProof(q, [], 0).hint, PROOF_BEFORE_AFTER_HINT);
  assert.deepEqual([completionProof(q, [], 1).ready, completionProof(q, [], 1).hint], [false, "Add a before photo first (under Photos, Start)."]);
  assert.deepEqual([completionProof(q, [photo("s", "START")], 0).ready, completionProof(q, [photo("s", "START")], 0).hint], [false, PROOF_PHOTO_HINT]);
  assert.equal(completionProof(q, [photo("a", "ARRIVAL")], 1).ready, true);
  assert.equal(completionProof(q, [photo("s", "START"), photo("c", "COMPLETION")], 0).ready, true);
});

test("when the photos cannot be counted the gate stands aside and the server decides", () => {
  for (const unknown of [null, undefined]) {
    const p = completionProof({ proofRequired: true, beforeAfterPhotos: true }, unknown, 0);
    assert.deepEqual([p.required, p.ready, p.hint], [true, true, null]);
  }
});

test("the proof gate is the server's rule (qualityBlocksCompletion)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "lib", "service-runtime-policy.ts"), "utf8");
  assert.match(src, /quality\.beforeAfterPhotos && !\(evidence\.hasBefore && evidence\.hasAfter\)/);
  assert.match(src, /quality\.proofRequired && evidence\.photos < 1/);
  const evidence = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "lib", "quality-evidence.ts"), "utf8");
  assert.match(evidence, /BEFORE_STAGES = new Set\(\["ARRIVAL", "START"\]\)/);
  assert.match(evidence, /AFTER_STAGES = new Set\(\["COMPLETION"\]\)/);
});

/* -------------------------------------------------------------------- chat */

test("bubbles are sender-aware and carry only the receipts the server sent", () => {
  const base = { senderUserId: "me", deliveredAt: null, readAt: null };
  assert.deepEqual(chatBubble(base, "me"), { mine: true, receipt: "Sent" });
  assert.deepEqual(chatBubble({ ...base, deliveredAt: T1 }, "me"), { mine: true, receipt: "Delivered" });
  assert.deepEqual(chatBubble({ ...base, deliveredAt: T1, readAt: T2 }, "me"), { mine: true, receipt: "Read" });
  // The customer's message: no receipt is shown for it, whatever its fields say.
  assert.deepEqual(chatBubble({ senderUserId: "customer", deliveredAt: T1, readAt: T2 }, "me"), { mine: false, receipt: null });
  // Not signed in / unknown id: nothing is claimed as the partner's own.
  assert.deepEqual(chatBubble(base, null), { mine: false, receipt: null });
  assert.deepEqual(chatBubble({ ...base, senderUserId: "" }, ""), { mine: false, receipt: null });
});

/* -------------------------------------------------------------------- maps */

test("Open in Maps goes to the booking's own coordinates, else the address text, else nowhere", () => {
  assert.equal(mapsUrl({ latitude: 12.97, longitude: 77.59, fullAddress: "x" }), "https://www.google.com/maps/dir/?api=1&destination=12.97,77.59");
  assert.equal(mapsUrl({ latitude: null, longitude: null, fullAddress: "Bengaluru, Karnataka, 560001" }), "https://www.google.com/maps/search/?api=1&query=Bengaluru%2C%20Karnataka%2C%20560001");
  // 0,0 is "no fix", not a place to send a partner.
  assert.equal(mapsUrl({ latitude: 0, longitude: 0, fullAddress: " " }), null);
  assert.equal(mapsUrl({ latitude: null, longitude: null, fullAddress: null }), null);
  assert.equal(mapsUrl(null), null);
});

/* ------------------------------------------------------------ requirements */

test("the arrival answer's requirement gate becomes lines in the server's words", () => {
  assert.deepEqual(arrivalGateLines(null), []);
  assert.deepEqual(arrivalGateLines({ ok: true, blocking: [] }), []);
  assert.deepEqual(
    arrivalGateLines({
      ok: false,
      blocking: [
        { label: "Water supply", remediation: { text: "Ask the customer to turn the water on." } },
        { label: "Power", remediation: { text: "" } },
      ],
    }),
    ["Water supply: Ask the customer to turn the water on.", "Power"],
  );
});
