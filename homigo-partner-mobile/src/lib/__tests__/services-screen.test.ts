/**
 * Partner app: "My services" screen rules — what a request answered, how a failure reads, the lane
 * pill and the search over the services that can be requested.
 *
 * Run: `node --test src/lib/__tests__/services-screen.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiErrorFromResponse, networkError } from "../api-error.ts";
import { OFFLINE_SENTENCE } from "../error-sentence.ts";
import { AVAILABLE_LIMIT, lanePill, requestOutcome, searchAvailable, serviceFailure } from "../services-screen.ts";

test("a request's confirmation follows the server's answer, not the tap", () => {
  assert.deepEqual(requestOutcome({ row: { id: 1, status: "REQUESTED" }, changed: true }), {
    tone: "success",
    message: "Request sent. The Homeeigo team has to approve it before you are offered jobs for this service.",
  });
  // `changed: false`: the row already existed — nothing new was sent.
  assert.deepEqual(requestOutcome({ row: { id: 1, status: "REQUESTED" }, changed: false }), {
    tone: "info",
    message: "You already asked for this service. It is awaiting approval.",
  });
  assert.deepEqual(requestOutcome({ row: { id: 1, status: "ACTIVE" }, changed: false }), { tone: "info", message: "You already perform this service." });
});

test("no connection is told apart from a refusal; a raw code is never shown", () => {
  assert.deepEqual(serviceFailure(networkError()), { tone: "warning", message: OFFLINE_SENTENCE });
  const refused = apiErrorFromResponse(409, "", { success: false, error: "SERVICE_NOT_OPERATIONAL", code: "SERVICE_NOT_OPERATIONAL", data: { blocking: ["SERVICE_NOT_OPERATIONAL"] } }, null);
  assert.deepEqual(serviceFailure(refused), { tone: "danger", message: "This service is not open for requests right now." });
  const unknown = apiErrorFromResponse(500, "", { success: false, error: "Unexpected capability outcome", code: "INTERNAL_ERROR" }, null);
  assert.deepEqual(serviceFailure(unknown), { tone: "danger", message: "Unexpected capability outcome" });
});

test("each lane's state is a word with a tone", () => {
  assert.deepEqual(lanePill("pending"), { label: "Awaiting approval", tone: "info" });
  assert.deepEqual(lanePill("suspended"), { label: "Suspended", tone: "warning" });
  assert.deepEqual(lanePill("revoked"), { label: "Revoked", tone: "danger" });
  // Performing says ready or not only when the server judged it.
  assert.deepEqual(lanePill("performing", { ready: true, missing: [] }), { label: "Ready for jobs", tone: "success" });
  assert.deepEqual(lanePill("performing", { ready: false, missing: [] }), { label: "Not being offered jobs yet", tone: "warning" });
  assert.equal(lanePill("performing"), null);
  assert.equal(lanePill("available"), null);
});

const cards = Array.from({ length: 45 }, (_, i) => ({ serviceId: `s${i}`, name: i === 3 ? "Deep Spa" : `Cleaning ${i}`, category: i === 7 ? "Spa and salon" : "Home" }));

test("search matches the name or the category, ignores case, and caps what is drawn", () => {
  const all = searchAvailable(cards, "");
  assert.equal(all.total, 45);
  assert.equal(all.shown.length, AVAILABLE_LIMIT);
  const spa = searchAvailable(cards, "  SPA ");
  assert.deepEqual(spa.shown.map((c) => c.serviceId), ["s3", "s7"]);
  assert.equal(spa.total, 2);
  assert.deepEqual(searchAvailable(cards, "zzz"), { shown: [], total: 0 });
});
