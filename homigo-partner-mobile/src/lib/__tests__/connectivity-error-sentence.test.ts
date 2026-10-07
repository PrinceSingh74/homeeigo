/**
 * Offline is told apart from a refusal, and the offline banner follows the app's own requests
 * (there is no NetInfo, and React Query's onlineManager never fires on React Native).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiErrorFromResponse, networkError } from "../api-error.ts";
import { CONNECTED, nextConnectivity, outcomeOf } from "../connectivity.ts";
import { OFFLINE_SENTENCE, errorCode, errorSentence, isOfflineError } from "../error-sentence.ts";

test("a request with no HTTP answer is offline; its sentence is the fixed offline one", () => {
  const e = networkError(new TypeError("Network request failed"));
  assert.equal(isOfflineError(e), true);
  assert.equal(errorSentence(e), OFFLINE_SENTENCE);
  assert.equal(outcomeOf(e), "no-answer");
});

test("a refusal is an answer: the server's sentence is shown unchanged", () => {
  const e = apiErrorFromResponse(409, "Conflict", { success: false, error: "Complete KYC to go online", code: "APPROVAL_PENDING" }, null);
  assert.equal(isOfflineError(e), false);
  assert.equal(errorSentence(e), "Complete KYC to go online");
  assert.equal(errorCode(e), "APPROVAL_PENDING");
  assert.equal(outcomeOf(e), "answered");
});

test("validation details win over the generic sentence", () => {
  const e = apiErrorFromResponse(400, "Bad Request", { error: "Validation failed", code: "VALIDATION_ERROR", details: ["Phone is too short", { message: "Name is required" }] }, null);
  assert.equal(errorSentence(e), "Phone is too short. Name is required");
});

test("a 5xx and a non-API error are answers / plain sentences, never 'offline'", () => {
  const e = apiErrorFromResponse(503, "Service Unavailable", null, null);
  assert.equal(isOfflineError(e), false);
  assert.equal(outcomeOf(e), "answered");
  assert.equal(errorSentence(new Error("boom")), "boom");
  assert.equal(errorSentence(null, "Could not save."), "Could not save.");
  assert.equal(outcomeOf(new Error("render bug")), "answered");
});

test("connectivity follows the latest request and remembers when the outage began", () => {
  let s = CONNECTED;
  s = nextConnectivity(s, "no-answer", 1_000);
  assert.deepEqual(s, { offline: true, since: 1_000 });
  // A second unanswered request does not move the start of the outage.
  s = nextConnectivity(s, "no-answer", 5_000);
  assert.deepEqual(s, { offline: true, since: 1_000 });
  s = nextConnectivity(s, "answered", 6_000);
  assert.deepEqual(s, CONNECTED);
});

test("an answered request while online keeps the same state object (no re-render)", () => {
  assert.equal(nextConnectivity(CONNECTED, "answered", 1), CONNECTED);
  assert.equal(outcomeOf(undefined), "answered");
});
