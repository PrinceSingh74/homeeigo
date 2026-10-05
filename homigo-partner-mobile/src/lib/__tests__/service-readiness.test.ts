/**
 * Partner app: "My services" — the sentence and next step for each readiness gap.
 *
 * Run: `node --test src/lib/__tests__/service-readiness.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeReadinessGap,
  describeServiceRequestError,
  NOT_READY_LABEL,
  READINESS_ROUTES,
  READY_LABEL,
  readinessSummary,
  readinessView,
} from "../service-readiness.ts";

const gap = (code: string, detail = "", title?: string) => describeReadinessGap({ code, detail, title });

test("credential gaps point at My credentials", () => {
  for (const [code, detail] of [
    ["SKILL_MISSING", "deep-cleaning"],
    ["CERTIFICATION_MISSING", "first-aid"],
    ["CERTIFICATION_UNVERIFIED", "first-aid"],
    ["CERTIFICATION_EXPIRED", "first-aid:EXPIRED"],
    ["EQUIPMENT_MISSING", "steam-cleaner"],
    ["INSURANCE_INVALID", "public-liability:MISSING"],
    ["LANGUAGE_MISMATCH", "hi"],
  ] as const) {
    const l = gap(code, detail);
    assert.equal(l.target, "credentials", code);
    assert.equal(l.actionLabel, "Open My credentials");
  }
  assert.equal(READINESS_ROUTES.credentials, "/hq/academy-credentials");
});

test("codes are shown as readable names, never as raw codes", () => {
  assert.match(gap("CERTIFICATION_MISSING", "first-aid").text, /“First aid” certificate/);
  assert.match(gap("EQUIPMENT_MISSING", "steam-cleaner").text, /“Steam cleaner”/);
  assert.match(gap("SKILL_MISSING", "deep-cleaning").text, /“Deep cleaning”/);
  for (const l of [gap("CERTIFICATION_EXPIRED", "first-aid:EXPIRED|REVOKED"), gap("INSURANCE_INVALID", "public-liability:UNVERIFIED")]) {
    assert.doesNotMatch(l.text, /first-aid|public-liability|EXPIRED|UNVERIFIED|REVOKED|\|/);
  }
});

test("a certificate that is already uploaded is never asked for again", () => {
  const unverified = gap("CERTIFICATION_UNVERIFIED", "first-aid");
  assert.match(unverified.text, /awaiting review/);
  assert.doesNotMatch(unverified.text, /\b(add|upload)\b/i);
  const insurance = gap("INSURANCE_INVALID", "public-liability:UNVERIFIED");
  assert.match(insurance.text, /awaiting review/);
  assert.doesNotMatch(insurance.text, /\b(add|upload)\b/i);
  // A pending replacement outranks the expired one it replaces.
  assert.match(gap("INSURANCE_INVALID", "public-liability:EXPIRED|UNVERIFIED").text, /awaiting review/);
});

test("an expired certificate says expired; rejected and revoked say so too", () => {
  assert.match(gap("CERTIFICATION_EXPIRED", "first-aid:EXPIRED").text, /has expired/);
  assert.match(gap("CERTIFICATION_EXPIRED", "first-aid:REJECTED|EXPIRED").text, /has expired/);
  assert.match(gap("CERTIFICATION_EXPIRED", "first-aid:REJECTED").text, /was not accepted/);
  const revoked = gap("CERTIFICATION_EXPIRED", "first-aid:REVOKED");
  assert.match(revoked.text, /revoked/);
  assert.equal(revoked.target, "support");
  // No state at all: stated as not valid, nothing invented.
  assert.match(gap("CERTIFICATION_EXPIRED", "first-aid").text, /not valid at the moment/);
});

test("insurance: missing, not yet started, expired", () => {
  assert.match(gap("INSURANCE_INVALID", "public-liability:MISSING").text, /none is on your profile/);
  assert.match(gap("INSURANCE_INVALID", "public-liability").text, /none is on your profile/);
  assert.match(gap("INSURANCE_INVALID", "public-liability:NOT_YET_EFFECTIVE").text, /has not started yet/);
  assert.match(gap("INSURANCE_INVALID", "public-liability:EXPIRED").text, /has expired/);
  assert.equal(gap("INSURANCE_INVALID", "public-liability:REVOKED").target, "support");
});

test("skill and equipment gaps do not assume whether the item was already declared", () => {
  assert.match(gap("SKILL_MISSING", "deep-cleaning").text, /if it is already there/);
  assert.match(gap("EQUIPMENT_MISSING", "ladder").text, /add it if it is not listed/);
});

test("background check wording follows the state exactly", () => {
  const pending = gap("BACKGROUND_CHECK_NOT_CLEARED", "PENDING");
  assert.match(pending.text, /being reviewed/);
  assert.equal(pending.target, "verification");
  const failed = gap("BACKGROUND_CHECK_NOT_CLEARED", "FAILED");
  assert.match(failed.text, /was not cleared — contact support/);
  assert.equal(failed.target, "support");
  assert.equal(failed.actionLabel, "Contact support");
  const notDone = gap("BACKGROUND_CHECK_NOT_CLEARED", "NOT_DONE");
  assert.match(notDone.text, /not done yet/);
  assert.equal(notDone.target, "verification");
  const unknown = gap("BACKGROUND_CHECK_NOT_CLEARED", "UNKNOWN");
  assert.match(unknown.text, /not cleared yet/);
  assert.doesNotMatch(unknown.text, /UNKNOWN/);
});

test("identity verification points at the verification screen and asks for no upload", () => {
  const kyc = gap("KYC_UNVERIFIED", "identity_not_verified");
  assert.equal(kyc.target, "verification");
  assert.equal(READINESS_ROUTES.verification, "/hq/trust-verification");
  assert.doesNotMatch(kyc.text, /\bupload\b|identity_not_verified/i);
});

test("experience is a stated fact with no action", () => {
  const l = gap("EXPERIENCE_INSUFFICIENT", "1<3");
  assert.equal(l.text, "This service needs at least 3 years of experience; your profile shows 1.");
  assert.equal(l.target, null);
  assert.equal(l.actionLabel, null);
  assert.equal(gap("EXPERIENCE_INSUFFICIENT", "0<1").text, "This service needs at least 1 year of experience; your profile shows 0.");
  const odd = gap("EXPERIENCE_INSUFFICIENT", "garbled");
  assert.equal(odd.target, null);
  assert.doesNotMatch(odd.text, /garbled/);
});

test("training shows the module title, falls back to a readable slug, and points at the academy", () => {
  const titled = gap("TRAINING_INCOMPLETE", "ac-safety-101", "AC safety basics");
  assert.match(titled.text, /“AC safety basics”/);
  assert.equal(titled.target, "academy");
  assert.equal(READINESS_ROUTES.academy, "/hq/academy-training");
  assert.match(gap("TRAINING_INCOMPLETE", "ac-safety-101").text, /“Ac safety 101”/);
  assert.match(gap("TRAINING_INCOMPLETE", "ac-safety-101", "  ").text, /“Ac safety 101”/);
});

test("an unknown code is a neutral sentence, never the raw code", () => {
  const l = gap("SOMETHING_NEW_V2", "raw:DETAIL");
  assert.doesNotMatch(l.text, /SOMETHING_NEW_V2|raw:DETAIL/);
  assert.equal(l.target, "support");
});

test("language gap names the language, not just a code path", () => {
  const l = gap("LANGUAGE_MISMATCH", "hi");
  assert.match(l.text, /speak (Hindi|HI) at the level/);
});

test("readiness view: ready, not ready, and absent", () => {
  assert.deepEqual(readinessView({ ready: true, missing: [] }), { ready: true, glyph: "✓", label: READY_LABEL, lines: [] });
  const v = readinessView({ ready: false, missing: [{ code: "KYC_UNVERIFIED", detail: "identity_not_verified" }, { code: "EXPERIENCE_INSUFFICIENT", detail: "1<3" }] });
  assert.equal(v?.ready, false);
  assert.equal(v?.label, NOT_READY_LABEL);
  assert.equal(v?.lines.length, 2);
  assert.notEqual(v?.glyph, "✓");
  // Not ready with nothing named still explains itself.
  assert.equal(readinessView({ ready: false, missing: [] })?.lines.length, 1);
  // Older backend / other lanes: no readiness UI at all.
  assert.equal(readinessView(undefined), null);
  assert.equal(readinessView(null), null);
  assert.equal(readinessView({} as never), null);
});

test("summary: only when something is not ready; nothing when all ready or readiness is absent", () => {
  const ready = { readiness: { ready: true, missing: [] } };
  const notReady = { readiness: { ready: false, missing: [{ code: "KYC_UNVERIFIED", detail: "" }] } };
  assert.equal(readinessSummary([ready, ready]), null);
  assert.equal(readinessSummary([{}, {}]), null);
  assert.equal(readinessSummary([]), null);
  assert.equal(readinessSummary([ready, notReady, ready]), "1 of your 3 services is not being offered jobs yet. See what is missing below.");
  assert.equal(readinessSummary([notReady, notReady]), "2 of your 2 services are not being offered jobs yet. See what is missing below.");
  assert.equal(readinessSummary([notReady]), "1 of your 1 service is not being offered jobs yet. See what is missing below.");
});

test("request errors read as plain language, never a raw code", () => {
  assert.equal(describeServiceRequestError("ALREADY_OFFERED", "This partner already performs this service"), "You already perform this service.");
  assert.equal(describeServiceRequestError("SOMETHING_ELSE", "SOMETHING_ELSE"), "Something went wrong. Try again.");
  assert.equal(describeServiceRequestError(null, "Network request failed"), "Network request failed");
  assert.match(describeServiceRequestError("CAPABILITY_LOCKED", "capability is SUSPENDED"), /contact support/);
});
