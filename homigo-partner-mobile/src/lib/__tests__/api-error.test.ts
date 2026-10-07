/**
 * What a failed request carries to the screen.
 *
 * The backend's refusal is `{ success: false, error: <sentence>, code, data?, details?, retryAfter? }`
 * (route handlers; global: middleware/error.middleware.ts). The old client kept `error`, `code` and
 * `retryAfter` and dropped `data` — so "2 attempts left" (`data.attemptsLeft`), the resend cool-down
 * (`data.retryAfterSec`), the blocking requirements (`data.blocking`), the no-show wait
 * (`data.waitedMinutes` / `graceMinutes`) and the quality verdict (`data.verdict`) never reached the
 * partner. And a request that never left the phone looked like any other failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiErrorFromResponse,
  errorDataNumber,
  getErrorMessage,
  isNetworkError,
  NETWORK_ERROR_CODE,
  networkError,
  PartnerApiError,
} from "../api-error.ts";

test("a refusal keeps the server's sentence, code, status and data block", () => {
  const e = apiErrorFromResponse(400, "Bad Request", { success: false, error: "That PIN is not right.", code: "OTP_INVALID", data: { attemptsLeft: 2 } }, null);
  assert.ok(e instanceof PartnerApiError);
  assert.equal(e.message, "That PIN is not right.");
  assert.equal(e.status, 400);
  assert.equal(e.code, "OTP_INVALID");
  assert.deepEqual(e.data, { attemptsLeft: 2 });
  assert.equal(errorDataNumber(e, "attemptsLeft"), 2);
  assert.equal(isNetworkError(e), false);
});

test("the documented data fields are all reachable", () => {
  const cooldown = apiErrorFromResponse(429, "", { success: false, error: "Wait before resending.", code: "RESEND_COOLDOWN", data: { retryAfterSec: 41 } }, null);
  assert.equal(errorDataNumber(cooldown, "retryAfterSec"), 41);
  const grace = apiErrorFromResponse(400, "", { success: false, error: "Wait a little longer.", code: "GRACE_NOT_ELAPSED", data: { waitedMinutes: 6, graceMinutes: 15 } }, null);
  assert.equal(errorDataNumber(grace, "waitedMinutes"), 6);
  assert.equal(errorDataNumber(grace, "graceMinutes"), 15);
  const gate = apiErrorFromResponse(409, "", { success: false, error: "Blocked.", code: "REQUIREMENT_GATE_BLOCKED", data: { target: "START", blocking: [{ code: "water" }] } }, null);
  assert.deepEqual(gate.data?.blocking, [{ code: "water" }]);
  const verdict = apiErrorFromResponse(409, "", { success: false, error: "Refused.", code: "QUALITY_VERDICT_BLOCKED", data: { verdict: "REWORK_REQUIRED", verdictId: 7 } }, null);
  assert.equal(verdict.data?.verdict, "REWORK_REQUIRED");
});

test("a missing or null number in data is null — never 0", () => {
  const e = apiErrorFromResponse(400, "", { success: false, error: "Enter the PIN.", code: "OTP_REQUIRED", data: { attemptsLeft: null } }, null);
  assert.equal(errorDataNumber(e, "attemptsLeft"), null);
  assert.equal(errorDataNumber(e, "retryAfterSec"), null);
  assert.equal(errorDataNumber(new Error("x"), "attemptsLeft"), null);
});

test("a refusal with no data block has data null; a non-object data is not passed off as one", () => {
  assert.equal(apiErrorFromResponse(404, "", { success: false, error: "Booking not found", code: "NOT_FOUND" }, null).data, null);
  assert.equal(apiErrorFromResponse(400, "", { success: false, error: "x", code: "X", data: "nope" }, null).data, null);
  assert.equal(apiErrorFromResponse(400, "", { success: false, error: "x", code: "X", data: [1] }, null).data, null);
});

test("retryAfter comes from the body, else from the Retry-After header (seconds)", () => {
  assert.equal(apiErrorFromResponse(429, "", { success: false, error: "Slow down", code: "RATE_LIMIT_EXCEEDED", retryAfter: 300 }, "9").retryAfter, 300);
  assert.equal(apiErrorFromResponse(429, "", { success: false, error: "Slow down" }, "9").retryAfter, 9);
  assert.equal(apiErrorFromResponse(429, "", { success: false, error: "Slow down" }, "soon").retryAfter, null);
  assert.equal(apiErrorFromResponse(429, "", { success: false, error: "Slow down" }, null).retryAfter, null);
});

test("field-level validation details are flattened to their messages", () => {
  const e = apiErrorFromResponse(400, "", { success: false, error: "Validation error", code: "VALIDATION_ERROR", details: [{ field: "reason", message: "Reason must be at least 3 characters" }, "plain"] }, null);
  assert.deepEqual(e.details, ["Reason must be at least 3 characters", "plain"]);
  assert.equal(getErrorMessage(e), "Reason must be at least 3 characters. plain");
});

test("a body that is not JSON falls back to the status text, with no code", () => {
  const e = apiErrorFromResponse(502, "Bad Gateway", null, null);
  assert.equal(e.message, "Bad Gateway");
  assert.equal(e.status, 502);
  assert.equal(e.code, null);
  assert.equal(apiErrorFromResponse(500, "", null, null).message, "Request failed");
});

test("a network failure is status 0, code NETWORK_ERROR — distinguishable from any HTTP refusal", () => {
  const e = networkError(new TypeError("Network request failed"));
  assert.equal(e.status, 0);
  assert.equal(e.code, NETWORK_ERROR_CODE);
  assert.equal(NETWORK_ERROR_CODE, "NETWORK_ERROR");
  assert.equal(isNetworkError(e), true);
  assert.equal(e.data, null);
  assert.equal(isNetworkError(new TypeError("Network request failed")), false);
  assert.equal(isNetworkError(apiErrorFromResponse(503, "", { success: false, error: "down", code: "SERVICE_UNAVAILABLE" }, null)), false);
});

test("getErrorMessage: the server's sentence, else the fallback", () => {
  assert.equal(getErrorMessage(apiErrorFromResponse(409, "", { success: false, error: "Work is on safety hold.", code: "SAFETY_HOLD_ACTIVE" }, null)), "Work is on safety hold.");
  assert.equal(getErrorMessage(networkError()), "You're offline. Check your connection and try again.");
  assert.equal(getErrorMessage(null, "Could not save."), "Could not save.");
});

test("the constructor keeps the shape existing call sites use", () => {
  const e = new PartnerApiError("x", { status: 403, code: "FORBIDDEN", retryAfter: 3 });
  assert.equal(e.name, "PartnerApiError");
  assert.deepEqual([e.status, e.code, e.retryAfter, e.data, e.details], [403, "FORBIDDEN", 3, null, []]);
  assert.ok(e instanceof Error);
});
