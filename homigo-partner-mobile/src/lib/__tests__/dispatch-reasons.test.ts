/**
 * Why a partner is not offered jobs. The server words readiness blockers itself; eligibility
 * arrives as codes only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchReasons } from "../dispatch-reasons.ts";

test("a readiness blocker is shown in the server's words, with where to fix it", () => {
  const out = dispatchReasons({ blockers: [{ code: "SERVICE_AREA_REQUIRED", message: "Set your service area to receive jobs." }] });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.message, "Set your service area to receive jobs.");
  assert.equal(out[0]!.fromServer, true);
  assert.equal(out[0]!.action?.href, "/hq/account-availability");
});

test("an eligibility code that repeats a blocker is not shown twice", () => {
  const out = dispatchReasons({
    blockers: [{ code: "APPROVAL_PENDING", message: "Your application is under review." }],
    reasons: ["APPROVAL_PENDING", "SKILL_MISMATCH"],
  });
  assert.deepEqual(out.map((r) => r.code), ["APPROVAL_PENDING", "SKILL_MISMATCH"]);
  assert.equal(out[0]!.message, "Your application is under review.");
  assert.equal(out[1]!.fromServer, false);
});

test("the mirror pairs collapse too (NOT_ACTIVE ↔ LIFECYCLE_NOT_ACTIVE, SKILL_MISMATCH ↔ SKILL_REQUIRED)", () => {
  const out = dispatchReasons({
    blockers: [
      { code: "LIFECYCLE_NOT_ACTIVE", message: "Finish onboarding." },
      { code: "SKILL_REQUIRED", message: "Add a service." },
    ],
    reasons: ["NOT_ACTIVE", "SKILL_MISMATCH", "OUTSIDE_SERVICE_AREA"],
  });
  assert.deepEqual(out.map((r) => r.code), ["LIFECYCLE_NOT_ACTIVE", "SKILL_REQUIRED", "OUTSIDE_SERVICE_AREA"]);
});

test("offline by choice: being unavailable and stale is the consequence, not a problem to fix", () => {
  const reasons = ["NOT_AVAILABLE", "STALE_PRESENCE", "STALE_LOCATION", "NO_CAPACITY"];
  assert.deepEqual(dispatchReasons({ reasons, offlineByChoice: true }).map((r) => r.code), ["NO_CAPACITY"]);
  assert.deepEqual(dispatchReasons({ reasons }).map((r) => r.code), reasons);
});

test("a restricted account points at documents; an unknown code is shown as itself, not guessed", () => {
  const out = dispatchReasons({ reasons: ["ACCOUNT_RESTRICTED", "SOME_NEW_RULE"] });
  assert.equal(out[0]!.action?.href, "/hq/trust-documents");
  assert.equal(out[1]!.message, "some new rule");
  assert.equal(out[1]!.action, null);
});

test("nothing to say when neither read has anything", () => {
  assert.deepEqual(dispatchReasons({}), []);
  assert.deepEqual(dispatchReasons({ blockers: [], reasons: null }), []);
});
