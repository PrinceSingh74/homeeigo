/**
 * Defects an adversarial review of the rebuilt job flow found, each pinned by the rule that fixes it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK_ERROR_MESSAGE } from "../api-error.ts";
import { OFFLINE_SENTENCE as ERROR_OFFLINE } from "../error-sentence.ts";
import { EVIDENCE_MAX_REQUEST_CHARS, EVIDENCE_REQUEST_TOO_LARGE_MESSAGE, stagedPhotosFit } from "../evidence-photo.ts";
import { jobEarningsView } from "../job-earnings.ts";
import { failureSentence, jobTerminalSummary, OFFLINE_SENTENCE } from "../job-screen.ts";
import { PartnerApiError } from "../api-error.ts";

const BACKEND = join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src");

test("staged completion photos are refused before they can exceed the server's request cap", () => {
  // The cap is the server's (index.ts): read it, so a lowered cap fails this test instead of a partner's completion.
  const index = readFileSync(join(BACKEND, "index.ts"), "utf8");
  const cap = /:\s*(\d+)\s*\*\s*1024\s*\*\s*1024;/.exec(index.slice(index.indexOf("maxRequestBodySize")));
  assert.ok(cap, "the server's body cap could not be read");
  const serverBytes = Number(cap[1]) * 1024 * 1024;
  assert.ok(EVIDENCE_MAX_REQUEST_CHARS < serverBytes, "the phone's budget must sit under the server's cap");
  assert.ok(serverBytes - EVIDENCE_MAX_REQUEST_CHARS >= 1024 * 1024, "and leave room for the rest of the body");

  const photo = (chars: number) => "x".repeat(chars);
  const third = Math.floor(EVIDENCE_MAX_REQUEST_CHARS / 3);
  assert.deepEqual(stagedPhotosFit([], photo(third)), { ok: true });
  assert.deepEqual(stagedPhotosFit([photo(third)], photo(third)), { ok: true });
  // Four photos the per-photo rule allows (8 MiB each is ~11.2M characters) do not fit one request.
  const refused = stagedPhotosFit([photo(third), photo(third)], photo(third + 10));
  assert.deepEqual(refused, { ok: false, message: EVIDENCE_REQUEST_TOO_LARGE_MESSAGE });
  assert.match(EVIDENCE_REQUEST_TOO_LARGE_MESSAGE, /remove|smaller/i, "the sentence says what to do");
});

test("a completed job does not promise an earning the server may not have recorded", () => {
  const done = jobTerminalSummary("completed");
  assert.ok(done);
  assert.doesNotMatch(done.message, /shown below/i);
});

test("no earning row: the server's own sentence, with its 'yet'", () => {
  const providers = readFileSync(join(BACKEND, "routes", "providers.ts"), "utf8");
  const sentence = "No earning is recorded for this job yet";
  assert.ok(providers.includes(sentence), "the server no longer says this sentence");
  const v = jobEarningsView("completed", { data: null, isLoading: false, isError: false });
  assert.equal(v.state === "none" && v.message, sentence);
});

test("there is one offline sentence, whichever layer words it", () => {
  assert.equal(NETWORK_ERROR_MESSAGE, OFFLINE_SENTENCE);
  assert.equal(ERROR_OFFLINE, OFFLINE_SENTENCE);
  assert.equal(failureSentence(new PartnerApiError(NETWORK_ERROR_MESSAGE, { status: 0, code: "NETWORK_ERROR" })), OFFLINE_SENTENCE);
});
