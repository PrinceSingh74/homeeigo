/**
 * Partner app: "My credentials" — status labels, expiry hints and which actions a row allows.
 *
 * Run: `node --test src/lib/__tests__/capabilities.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_CODE,
  OTHER_CHOICE,
  capabilityStatusBadge,
  catalogueChoices,
  requirementMark,
  resolveTypeCode,
  describeCapabilityError,
  expiryHint,
  humanizeCode,
  humanizeEnum,
  languageBadge,
  parseDateInput,
  rowPermissions,
  toCapabilityCode,
  toDateInput,
} from "../capabilities.ts";

const NOW = new Date("2026-10-05T06:00:00.000Z");
const fmt = (iso: string) => iso.slice(0, 10);

test("status reads as a glyph and a word; DECLARED is 'Awaiting review'", () => {
  assert.deepEqual(capabilityStatusBadge("DECLARED"), { glyph: "○", label: "Awaiting review" });
  assert.equal(capabilityStatusBadge("VERIFIED").label, "Verified");
  assert.equal(capabilityStatusBadge("REJECTED").label, "Rejected");
  assert.equal(capabilityStatusBadge("REVOKED").label, "Revoked");
  const glyphs = ["DECLARED", "VERIFIED", "REJECTED", "REVOKED"].map((s) => capabilityStatusBadge(s).glyph);
  assert.equal(new Set(glyphs).size, 4, "every status has its own glyph");
  // An unknown status is shown as sent, never relabelled as a known one.
  assert.deepEqual(capabilityStatusBadge("SOMETHING_NEW"), { glyph: "•", label: "SOMETHING_NEW" });
});

test("a typed name becomes a code the server's pattern accepts", () => {
  for (const [typed, code] of [
    ["Electrical Licence", "electrical-licence"],
    ["  Public liability (₹10L) ", "public-liability-10l"],
    ["steam_cleaner", "steam-cleaner"],
    ["--Ladder--", "ladder"],
  ] as const) {
    assert.equal(toCapabilityCode(typed), code);
    assert.match(code, CAPABILITY_CODE);
  }
  assert.equal(toCapabilityCode("   "), "");
  assert.equal(toCapabilityCode("!!!"), "");
  const long = toCapabilityCode(`${"a".repeat(79)} b c`);
  assert.ok(long.length <= 80);
  assert.match(long, CAPABILITY_CODE);
});

test("codes and enums are humanized for display only", () => {
  assert.equal(humanizeCode("electrical-licence"), "Electrical licence");
  assert.equal(humanizeEnum("OUT_OF_SERVICE"), "Out of service");
});

test("date input: empty is not given, a real YYYY-MM-DD passes, anything else is refused", () => {
  assert.deepEqual(parseDateInput(""), { ok: true, value: null });
  assert.deepEqual(parseDateInput(" 2027-03-31 "), { ok: true, value: "2027-03-31" });
  assert.deepEqual(parseDateInput("2026-02-30"), { ok: false });
  assert.deepEqual(parseDateInput("31/03/2027"), { ok: false });
  assert.deepEqual(parseDateInput("2027-3-1"), { ok: false });
  assert.equal(toDateInput("2027-03-31T00:00:00.000Z"), "2027-03-31");
  assert.equal(toDateInput(null), "");
  assert.equal(toDateInput("not a date"), "");
});

test("expiry hint: none without a date, expired, near expiry, valid", () => {
  assert.equal(expiryHint({ expiresAt: null }, NOW, fmt), null);
  assert.equal(expiryHint({}, NOW, fmt), null);

  const expired = expiryHint({ expiresAt: "2026-09-01T00:00:00.000Z", validity: "EXPIRED", nearExpiry: false }, NOW, fmt);
  assert.equal(expired?.tone, "expired");
  assert.match(expired!.text, /^Expired on 2026-09-01/);

  // An unverified row whose date has passed still reads as expired.
  assert.equal(expiryHint({ expiresAt: "2026-09-01T00:00:00.000Z", validity: "UNVERIFIED" }, NOW, fmt)?.tone, "expired");

  const soon = expiryHint({ expiresAt: "2026-10-15T06:00:00.000Z", validity: "VALID", nearExpiry: true }, NOW, fmt);
  assert.equal(soon?.tone, "soon");
  assert.match(soon!.text, /10 days left/);
  assert.equal(soon!.glyph, "⚠");

  const ok = expiryHint({ expiresAt: "2027-10-15T00:00:00.000Z", validity: "VALID", nearExpiry: false }, NOW, fmt);
  assert.deepEqual(ok, { tone: "ok", glyph: "", text: "Valid until 2027-10-15" });
});

test("DECLARED rows can be withdrawn; only certifications and insurance can be edited", () => {
  assert.equal(rowPermissions("skills", { status: "DECLARED" }).hint, null);
  for (const kind of ["skills", "equipment"] as const) {
    const p = rowPermissions(kind, { status: "DECLARED" });
    assert.equal(p.canRemove, true);
    assert.equal(p.canEdit, false);
    assert.equal(p.locked, false);
  }
  for (const kind of ["certifications", "insurance"] as const) {
    const p = rowPermissions(kind, { status: "DECLARED" });
    assert.equal(p.canRemove, true);
    assert.equal(p.canEdit, true);
  }
});

test("VERIFIED and REVOKED rows are locked: no remove, no edit, a hint that says why", () => {
  for (const kind of ["skills", "certifications", "equipment", "insurance"] as const) {
    for (const status of ["VERIFIED", "REVOKED"]) {
      const p = rowPermissions(kind, { status });
      assert.equal(p.canRemove, false, `${kind} ${status} must not be removable`);
      assert.equal(p.canEdit, false, `${kind} ${status} must not be editable`);
      assert.equal(p.locked, true);
      assert.match(p.hint ?? "", /locked/i);
    }
  }
  // The one partner-reported fact on verified equipment: whether it works.
  assert.equal(rowPermissions("equipment", { status: "VERIFIED" }).canReportOperational, true);
  assert.equal(rowPermissions("equipment", { status: "REVOKED" }).canReportOperational, false);
});

test("REJECTED rows can be withdrawn; certifications and insurance can also be edited back into review", () => {
  assert.deepEqual(
    { ...rowPermissions("certifications", { status: "REJECTED" }), hint: null },
    { canRemove: true, canEdit: true, canReportOperational: false, locked: false, hint: null },
  );
  for (const kind of ["skills", "certifications", "equipment", "insurance"] as const) {
    const p = rowPermissions(kind, { status: "REJECTED" });
    assert.equal(p.canRemove, true, `${kind} REJECTED must be removable`);
    assert.equal(p.locked, false);
    assert.match(p.hint ?? "", /remove it/i);
  }
  const skill = rowPermissions("skills", { status: "REJECTED" });
  assert.equal(skill.canEdit, false);
  assert.match(skill.hint ?? "", /declare it again/i);
  // A rejected equipment claim has no working state worth reporting.
  assert.equal(rowPermissions("equipment", { status: "REJECTED" }).canReportOperational, false);
});

const CATALOGUE = { certifications: ["first-aid", "electrical-licence"], equipment: ["steam-cleaner"], insurance: [] };

test("catalogue choices: the server's codes, in its order, with readable labels", () => {
  assert.deepEqual(catalogueChoices(CATALOGUE, "certifications"), [
    { code: "first-aid", label: "First aid" },
    { code: "electrical-licence", label: "Electrical licence" },
  ]);
  // Duplicates fold; anything the declare route would refuse is dropped, not repaired.
  assert.deepEqual(
    catalogueChoices({ equipment: ["ladder", "ladder", "Bad Code", "", 7 as unknown as string] }, "equipment"),
    [{ code: "ladder", label: "Ladder" }],
  );
});

test("no catalogue for a kind — empty, absent, or an older backend — means no picker", () => {
  assert.deepEqual(catalogueChoices(CATALOGUE, "insurance"), []);
  assert.deepEqual(catalogueChoices({}, "equipment"), []);
  assert.deepEqual(catalogueChoices(undefined, "certifications"), []);
  assert.deepEqual(catalogueChoices(null, "certifications"), []);
  assert.deepEqual(catalogueChoices({ certifications: null }, "certifications"), []);
});

test("the code an add form sends: a picked code as it is, typed text only for Other or with no catalogue", () => {
  const choices = catalogueChoices(CATALOGUE, "certifications");
  assert.equal(resolveTypeCode(choices, "first-aid", "ignored text"), "first-aid");
  assert.equal(resolveTypeCode(choices, OTHER_CHOICE, "Gas Safe"), "gas-safe");
  assert.equal(resolveTypeCode(choices, OTHER_CHOICE, "   "), "");
  // Nothing picked yet, or a value that is not on the list: nothing to send.
  assert.equal(resolveTypeCode(choices, null, "Gas Safe"), "");
  assert.equal(resolveTypeCode(choices, "not-on-the-list", ""), "");
  // No catalogue: today's free entry.
  assert.equal(resolveTypeCode([], null, "Public liability"), "public-liability");
});

test("a row is marked required / not required only when there is a catalogue to compare against", () => {
  assert.deepEqual(requirementMark(CATALOGUE, "certifications", "first-aid"), { required: true, glyph: "◆", label: "Required by a current service" });
  const other = requirementMark(CATALOGUE, "certifications", "gas-safe");
  assert.equal(other?.required, false);
  assert.match(other!.label, /not required/i);
  assert.notEqual(other!.glyph, "◆");
  // A code required for one kind says nothing about another kind.
  assert.equal(requirementMark(CATALOGUE, "equipment", "first-aid")?.required, false);
  assert.equal(requirementMark(CATALOGUE, "insurance", "public-liability"), null);
  assert.equal(requirementMark(undefined, "certifications", "first-aid"), null);
});

test("languages: the partner's own can be removed, an admin's record is locked", () => {
  assert.equal(rowPermissions("languages", { source: "SELF" }).canRemove, true);
  const admin = rowPermissions("languages", { source: "ADMIN" });
  assert.equal(admin.canRemove, false);
  assert.equal(admin.locked, true);
  assert.equal(languageBadge({ active: false, source: "ADMIN" }).label, "Inactive");
  assert.equal(languageBadge({ active: true, source: "SELF" }).label, "Declared by you");
});

test("server refusals read as plain language; CAPABILITY_LOCKED says the row is locked", () => {
  assert.match(describeCapabilityError("CAPABILITY_LOCKED", "CAPABILITY_LOCKED"), /locked/);
  assert.equal(describeCapabilityError("INVALID_INPUT", "expiresAt is required"), "Check the details and try again (expiresAt is required).");
  assert.equal(describeCapabilityError("INVALID_INPUT", "INVALID_INPUT"), "Check the details and try again.");
  assert.equal(describeCapabilityError(null, "Network request failed"), "Network request failed");
  assert.equal(describeCapabilityError(undefined, null), "Something went wrong. Try again.");
});
