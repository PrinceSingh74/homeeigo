/**
 * Found on the Android emulator 2026-10-08 (second device run). Accepting an offer hit a server
 * fault (HTTP 500, an unhandled database error), and the job page showed the server's `error`
 * string verbatim: a Prisma invocation trace with a Windows source path and SQL column names, in a
 * danger banner. A refusal (4xx) carries a sentence written for the partner; a fault (5xx) carries
 * whatever the exception said. The screen must not read the second kind out loud.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PartnerApiError } from "../api-error.ts";
import { failureSentence, SERVER_FAULT_SENTENCE } from "../job-screen.ts";

test("a server fault (5xx) is told in the app's own words, never the exception text", () => {
  const trace = "\nInvalid `tx.booking.update()` invocation in\nD:\\homigo\\apps\\backend\\src\\services\\booking.service.ts:1767:24\nThe column `trace_id` does not exist in the current database.";
  assert.equal(failureSentence(new PartnerApiError(trace, { status: 500 })), SERVER_FAULT_SENTENCE);
  assert.equal(failureSentence(new PartnerApiError("Bad Gateway", { status: 502 })), SERVER_FAULT_SENTENCE);
  assert.equal(failureSentence(new PartnerApiError("Service Unavailable", { status: 503, code: "EXECUTION_UNAVAILABLE" })), SERVER_FAULT_SENTENCE);
});

test("a refusal (4xx) keeps the server's sentence", () => {
  assert.equal(failureSentence(new PartnerApiError("This step is waiting on step 1.", { status: 409, code: "DEPENDENCY_INCOMPLETE" })), "This step is waiting on step 1.");
  assert.equal(failureSentence(new PartnerApiError("Booking not found", { status: 404, code: "NOT_FOUND" })), "Booking not found");
});

test("the fault sentence does not leak anything and says what to do", () => {
  assert.doesNotMatch(SERVER_FAULT_SENTENCE, /prisma|invocation|column|\.ts|\\/i);
  assert.match(SERVER_FAULT_SENTENCE, /try again/i);
});
