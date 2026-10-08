/**
 * Partner app: "My credentials" screen rules — the status pill, what a write answered, how a failure
 * reads (offline apart from a refusal), the dated form's checks and the equipment report body.
 *
 * Run: `node --test src/lib/__tests__/credentials-screen.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiErrorFromResponse, networkError } from "../api-error.ts";
import { LANGUAGE_CODE } from "../capabilities.ts";
import {
  LANGUAGE_OPTIONS,
  capabilityFailure,
  checkDatedForm,
  datedRowView,
  equipmentReportBody,
  equipmentRowView,
  languageLabel,
  languagePill,
  languageRowView,
  pendingReviewLabel,
  skillRowView,
  statusPill,
  writeOutcome,
} from "../credentials-screen.ts";
import { OFFLINE_SENTENCE } from "../error-sentence.ts";

test("status is a word with a tone; an unknown status is shown as sent, never guessed", () => {
  assert.deepEqual(statusPill("DECLARED"), { label: "Awaiting review", tone: "info" });
  assert.deepEqual(statusPill("VERIFIED"), { label: "Verified", tone: "success" });
  assert.deepEqual(statusPill("REJECTED"), { label: "Rejected", tone: "danger" });
  assert.deepEqual(statusPill("REVOKED"), { label: "Revoked", tone: "danger" });
  assert.deepEqual(statusPill("ON_HOLD"), { label: "On hold", tone: "neutral" });
});

test("a language has no review status: active or not, and who recorded it", () => {
  assert.deepEqual(languagePill({ active: true, source: "SELF" }), { label: "Declared by you", tone: "neutral" });
  assert.deepEqual(languagePill({ active: true, source: "ADMIN" }), { label: "Recorded by the Homeeigo team", tone: "success" });
  assert.deepEqual(languagePill({ active: false, source: "ADMIN" }), { label: "Inactive", tone: "neutral" });
});

test("every offered language is a code the declare route accepts; an unlisted code reads as the code", () => {
  for (const l of LANGUAGE_OPTIONS) assert.match(l.code, LANGUAGE_CODE);
  assert.equal(new Set(LANGUAGE_OPTIONS.map((l) => l.code)).size, LANGUAGE_OPTIONS.length);
  assert.equal(languageLabel("hi"), "Hindi");
  assert.equal(languageLabel("fr"), "FR");
});

test("a write's confirmation comes from what the server answered", () => {
  assert.equal(writeOutcome("Skill", { row: { id: 1, status: "DECLARED" }, changed: true }), "Skill saved. Status: Awaiting review.");
  // `changed: false` — the server kept the row as it was; the app must not claim it saved something.
  assert.equal(writeOutcome("Skill", { row: { id: 1, status: "VERIFIED" }, changed: false }), "Nothing changed. Skill is already on your profile with these details.");
  // Languages carry no status.
  assert.equal(writeOutcome("Language", { row: { id: 2 }, changed: true }), "Language saved.");
  // An edit answers `{ row }` only (no `changed`): it was saved.
  assert.equal(writeOutcome("Certification", { row: { id: 3, status: "DECLARED" } }), "Certification saved. Status: Awaiting review.");
});

test("no connection is told apart from a refusal", () => {
  assert.deepEqual(capabilityFailure(networkError(new TypeError("Network request failed"))), { tone: "warning", message: OFFLINE_SENTENCE });
  const locked = apiErrorFromResponse(409, "Conflict", { success: false, error: "CAPABILITY_LOCKED", code: "CAPABILITY_LOCKED" }, null);
  assert.equal(capabilityFailure(locked).tone, "danger");
  // The server sends the bare code as its sentence here; the partner never reads a raw code.
  assert.doesNotMatch(capabilityFailure(locked).message, /CAPABILITY_LOCKED/);
});

test("a refusal the server wrote a sentence for is shown in its words", () => {
  const e = apiErrorFromResponse(403, "Forbidden", { success: false, error: "Your account is suspended.", code: "ACCOUNT_SUSPENDED" }, null);
  assert.deepEqual(capabilityFailure(e), { tone: "danger", message: "Your account is suspended." });
  const validation = apiErrorFromResponse(422, "", { success: false, error: "Validation failed", code: "VALIDATION_ERROR", details: ["note is too long"] }, null);
  assert.equal(capabilityFailure(validation).message, "note is too long");
});

test("pending-review count: the server's figure includes service requests, and the label says so", () => {
  assert.equal(pendingReviewLabel([]), "Awaiting review");
  assert.equal(pendingReviewLabel([{ status: "ACTIVE" }]), "Awaiting review");
  assert.equal(pendingReviewLabel([{ status: "ACTIVE" }, { status: "REQUESTED" }]), "Awaiting review, with service requests");
  assert.equal(pendingReviewLabel(undefined), "Awaiting review");
});

const DATED = { editing: false, code: "first-aid", freeEntry: false, typeLabel: "Certificate or licence", start: "", expires: "", expiryRequired: false };

test("dated form: the same checks the server makes, before the request", () => {
  assert.deepEqual(checkDatedForm(DATED), { ok: true, start: null, expires: null });
  assert.deepEqual(checkDatedForm({ ...DATED, start: "2026-01-01", expires: "2027-01-01" }), { ok: true, start: "2026-01-01", expires: "2027-01-01" });
  assert.deepEqual(checkDatedForm({ ...DATED, code: "" }), { ok: false, field: "type", message: "Choose the certificate or licence." });
  assert.deepEqual(checkDatedForm({ ...DATED, code: "", freeEntry: true }), { ok: false, field: "type", message: "Enter the certificate or licence." });
  assert.deepEqual(checkDatedForm({ ...DATED, start: "01/02/2026" }), { ok: false, field: "start", message: "Write the date as YYYY-MM-DD, for example 2027-03-31." });
  assert.deepEqual(checkDatedForm({ ...DATED, expires: "2026-02-30" }), { ok: false, field: "expires", message: "Write the date as YYYY-MM-DD, for example 2027-03-31." });
  // Backend: `expiresAt <= issuedAt` is INVALID_INPUT.
  assert.deepEqual(checkDatedForm({ ...DATED, start: "2026-05-01", expires: "2026-05-01" }), { ok: false, field: "expires", message: "The expiry date must be after the start date." });
});

test("dated form: insurance needs an expiry date; an edit does not need the type again", () => {
  assert.deepEqual(checkDatedForm({ ...DATED, expiryRequired: true }), { ok: false, field: "expires", message: "The expiry date is required." });
  assert.deepEqual(checkDatedForm({ ...DATED, editing: true, code: "", expiryRequired: true, expires: "2027-03-31" }), { ok: true, start: null, expires: "2027-03-31" });
});

const NOW = new Date("2026-10-05T06:00:00.000Z");
const fmt = (iso: string) => iso.slice(0, 10);
const BASE = { providerId: "p1", dataOrigin: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

test("a skill row: the catalogue's name, its level as stated, and the lock a verified row carries", () => {
  const v = skillRowView(
    { ...BASE, id: 7, skillCode: "deep-clean", level: "SKILLED", status: "VERIFIED", source: "SELF", sourceRef: null, verifiedAt: "2026-09-20T00:00:00.000Z", expiresAt: null, skillName: "Deep cleaning", skillCategory: "Cleaning", skillActive: false, validity: "VALID", nearExpiry: false },
    NOW,
    fmt,
  );
  assert.equal(v.title, "Deep cleaning");
  assert.deepEqual(v.pill, { label: "Verified", tone: "success" });
  assert.equal(v.subtitle, "Cleaning · Level: Skilled");
  assert.deepEqual(v.facts, [
    { label: "Category", value: "Cleaning" },
    { label: "Your level", value: "Skilled" },
    { label: "Verified on", value: "2026-09-20" },
  ]);
  assert.equal(v.perms.canRemove, false);
  assert.ok(v.notes.includes("This skill is no longer offered in the catalogue."));
  assert.equal(v.attention, null);
});

test("a certificate row: only what the server sent is listed; an expired one is flagged in a word", () => {
  const v = datedRowView(
    "certifications",
    { ...BASE, id: 3, certificationType: "first-aid", issuer: "Red Cross", referenceNumber: null, issuedAt: null, expiresAt: "2026-09-30T00:00:00.000Z", status: "DECLARED", verificationSource: null, documentId: null, proofRef: null, verifiedAt: null, revokedAt: null, revokedReason: null, validity: "EXPIRED", nearExpiry: false },
    { certifications: ["first-aid"], equipment: [], insurance: [] },
    NOW,
    fmt,
  );
  assert.equal(v.title, "First aid");
  assert.deepEqual(v.pill, { label: "Awaiting review", tone: "info" });
  assert.deepEqual(v.attention, { label: "Expired", tone: "danger" });
  assert.deepEqual(v.facts, [
    { label: "Issued by", value: "Red Cross" },
    { label: "Expires", value: "2026-09-30" },
  ]);
  assert.ok(v.notes.includes("Required by a current service"));
  assert.equal(v.perms.canEdit, true);
});

test("an insurance row that has not started says so; a revoked one carries the server's reason", () => {
  const row = { ...BASE, id: 4, insuranceType: "public-liability", insurer: null, policyReference: "PL-1", effectiveFrom: "2026-11-01T00:00:00.000Z", expiresAt: "2027-11-01T00:00:00.000Z", status: "VERIFIED" as const, documentId: "d1", proofRef: null, verifiedAt: null, revokedAt: null, revokedReason: null, validity: "NOT_YET_EFFECTIVE" as const, nearExpiry: false };
  const v = datedRowView("insurance", row, null, NOW, fmt);
  assert.deepEqual(v.attention, { label: "Not in effect yet", tone: "info" });
  assert.deepEqual(v.facts, [
    { label: "Policy number", value: "PL-1" },
    { label: "Effective from", value: "2026-11-01" },
    { label: "Expires", value: "2027-11-01" },
    { label: "Supporting document", value: "Attached" },
  ]);
  const revoked = datedRowView("insurance", { ...row, status: "REVOKED", validity: "REVOKED", revokedReason: "Policy cancelled by insurer" }, null, NOW, fmt);
  assert.ok(revoked.notes.includes("Reason: Policy cancelled by insurer"));
  assert.equal(revoked.attention, null);
});

test("an equipment row: ownership and condition in words; an overdue inspection is flagged", () => {
  const v = equipmentRowView(
    { ...BASE, id: 5, equipmentType: "steam-cleaner", ownership: "RENTED", operational: "OUT_OF_SERVICE", status: "VERIFIED", verifiedAt: null, inspectionDueAt: "2026-09-01T00:00:00.000Z", note: "Model X", validity: "INSPECTION_OVERDUE", nearExpiry: false },
    null,
    fmt,
  );
  assert.equal(v.subtitle, "Rented · Out of service");
  assert.deepEqual(v.attention, { label: "Inspection overdue", tone: "danger" });
  assert.deepEqual(v.facts, [
    { label: "Ownership", value: "Rented" },
    { label: "Condition", value: "Out of service" },
    { label: "Inspection due", value: "2026-09-01" },
    { label: "Note", value: "Model X" },
  ]);
  assert.equal(v.perms.canReportOperational, true);
});

test("a language row: its name, how well it is spoken, and who recorded it", () => {
  const v = languageRowView({ ...BASE, id: 9, languageCode: "ta", proficiency: "FLUENT", source: "ADMIN", active: true, validity: "ACTIVE" });
  assert.equal(v.title, "Tamil");
  assert.equal(v.subtitle, "Fluent");
  assert.deepEqual(v.pill, { label: "Recorded by the Homeeigo team", tone: "success" });
  assert.equal(v.perms.canRemove, false);
});

test("reporting equipment: a verified item sends no note (the server locks it otherwise); a claim resends its note", () => {
  const base = { equipmentType: "steam-cleaner", ownership: "OWNED" as const, note: "Model X" };
  assert.deepEqual(equipmentReportBody({ ...base, operational: "OPERATIONAL", status: "VERIFIED" }), {
    equipmentType: "steam-cleaner",
    ownership: "OWNED",
    operational: "OUT_OF_SERVICE",
  });
  assert.deepEqual(equipmentReportBody({ ...base, operational: "OUT_OF_SERVICE", status: "DECLARED" }), {
    equipmentType: "steam-cleaner",
    ownership: "OWNED",
    operational: "OPERATIONAL",
    note: "Model X",
  });
});
