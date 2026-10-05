/**
 * My credentials — the pure rules behind the page (`src/lib/credentials.ts`): what a typed name is
 * stored as, which actions the page may OFFER for a row (the server decides again), and how a
 * refusal is worded.
 *
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import {
  canEdit,
  canToggleOperational,
  canWithdraw,
  capabilityErrorMessage,
  CAPABILITY_CODE,
  expiryHint,
  formatDay,
  humanizeCode,
  isLocked,
  isRequiredByServices,
  requirementCodes,
  requirementOptions,
  toCapabilityCode,
  toDateInput,
} from "@/lib/credentials";

describe("codes", () => {
  test("a typed name becomes a code the server's pattern accepts", () => {
    expect(toCapabilityCode("  First Aid (Level 2) ")).toBe("first-aid-level-2");
    expect(toCapabilityCode("Pressure washer")).toBe("pressure-washer");
    expect(CAPABILITY_CODE.test(toCapabilityCode("A/C — split unit"))).toBe(true);
  });

  test("nothing usable is an empty code, never a guess", () => {
    expect(toCapabilityCode("")).toBe("");
    expect(toCapabilityCode(" —— ")).toBe("");
    expect(toCapabilityCode("हिन्दी")).toBe("");
  });

  test("a long name is cut without leaving a trailing dash", () => {
    const code = toCapabilityCode(`${"a".repeat(79)} b`);
    expect(code.length).toBeLessThanOrEqual(80);
    expect(CAPABILITY_CODE.test(code)).toBe(true);
  });

  test("a stored code reads back as words", () => {
    expect(humanizeCode("first-aid-level-2")).toBe("First aid level 2");
  });
});

describe("what the page may offer", () => {
  test("a claim never accepted (DECLARED or REJECTED) can be removed; a decision cannot", () => {
    for (const kind of ["skills", "certifications", "equipment", "insurance"] as const) {
      expect(canWithdraw(kind, { status: "DECLARED" })).toBe(true);
      expect(canWithdraw(kind, { status: "REJECTED" })).toBe(true);
      expect(canWithdraw(kind, { status: "VERIFIED" })).toBe(false);
      expect(canWithdraw(kind, { status: "REVOKED" })).toBe(false);
    }
  });

  test("DECLARED and REJECTED rows can be edited; VERIFIED and REVOKED are locked", () => {
    expect(canEdit("insurance", { status: "DECLARED" })).toBe(true);
    expect(canEdit("insurance", { status: "REJECTED" })).toBe(true);
    expect(canEdit("skills", { status: "VERIFIED" })).toBe(false);
    expect(isLocked("skills", { status: "VERIFIED" })).toBe(true);
    expect(isLocked("skills", { status: "REVOKED" })).toBe(true);
    expect(isLocked("skills", { status: "REJECTED" })).toBe(false);
  });

  test("languages follow who recorded them, not a status", () => {
    expect(canWithdraw("languages", { source: "SELF" })).toBe(true);
    expect(canEdit("languages", { source: "SELF" })).toBe(true);
    expect(canWithdraw("languages", { source: "ADMIN" })).toBe(false);
    expect(isLocked("languages", { source: "ADMIN" })).toBe(true);
  });

  test("verified equipment can still be reported out of service; revoked cannot", () => {
    expect(canToggleOperational({ status: "VERIFIED" })).toBe(true);
    expect(canToggleOperational({ status: "REVOKED" })).toBe(false);
  });
});

describe("requirement catalogue", () => {
  const catalogue = { certifications: ["first-aid", "electrician-licence"], equipment: ["pressure-washer"], insurance: [] };

  test("the picker offers the server's codes with a readable label", () => {
    expect(requirementOptions(catalogue, "certifications")).toEqual([
      { code: "first-aid", label: "First aid" },
      { code: "electrician-licence", label: "Electrician licence" },
    ]);
    // A catalogue code survives the name→code step unchanged, so picking one stores that exact code.
    expect(toCapabilityCode("electrician-licence")).toBe("electrician-licence");
  });

  test("an empty or absent list offers nothing — the form falls back to free entry", () => {
    expect(requirementOptions(catalogue, "insurance")).toEqual([]);
    expect(requirementOptions(undefined, "certifications")).toEqual([]);
    expect(requirementOptions(catalogue, "equipment", ["pressure-washer"])).toEqual([]);
  });

  test("a row is marked from the catalogue only; no catalogue is 'unknown', not 'not required'", () => {
    expect(isRequiredByServices(catalogue, "certifications", "first-aid")).toBe(true);
    expect(isRequiredByServices(catalogue, "certifications", "yoga-teacher")).toBe(false);
    expect(isRequiredByServices(catalogue, "insurance", "public-liability")).toBe(false);
    expect(isRequiredByServices(undefined, "certifications", "first-aid")).toBeNull();
    expect(isRequiredByServices({} as never, "equipment", "pressure-washer")).toBeNull();
  });

  test("anything that is not a valid code is dropped", () => {
    expect(requirementCodes({ certifications: ["ok-code", "Not A Code", 3 as never], equipment: [], insurance: [] }, "certifications")).toEqual(["ok-code"]);
  });
});

describe("expiry", () => {
  const expiresAt = "2027-01-31T00:00:00.000Z";

  test("the server's verdict decides the wording", () => {
    expect(expiryHint({ validity: "EXPIRED", expiresAt })).toEqual({ label: `Expired on ${formatDay(expiresAt)}`, tone: "bad" });
    expect(expiryHint({ validity: "VALID", nearExpiry: true, expiresAt })!.tone).toBe("pending");
    expect(expiryHint({ validity: "VALID", nearExpiry: false, expiresAt })).toEqual({ label: `Expires ${formatDay(expiresAt)}`, tone: "ok" });
    expect(expiryHint({ validity: "INSPECTION_OVERDUE", expiresAt }, "Inspection due")!.tone).toBe("bad");
  });

  test("no date and nothing to warn about is no hint", () => {
    expect(expiryHint({ validity: "UNVERIFIED", nearExpiry: false, expiresAt: null })).toBeNull();
  });

  test("a date typed as a day reads back as the same day", () => {
    expect(toDateInput(expiresAt)).toBe("2027-01-31");
    expect(formatDay(expiresAt)).toMatch(/31/);
    expect(toDateInput(null)).toBe("");
  });
});

describe("refusals", () => {
  test("CAPABILITY_LOCKED is explained, never shown as a raw code", () => {
    const message = capabilityErrorMessage(Object.assign(new Error("CAPABILITY_LOCKED"), { code: "CAPABILITY_LOCKED" }));
    expect(message).toMatch(/locked/i);
    expect(message).not.toMatch(/CAPABILITY_LOCKED/);
  });

  test("INVALID_INPUT keeps the detail the partner can act on", () => {
    expect(capabilityErrorMessage(Object.assign(new Error("expiresAt must be after issuedAt"), { code: "INVALID_INPUT" }))).toMatch(/after the issue date/);
    expect(capabilityErrorMessage(Object.assign(new Error("level"), { code: "INVALID_INPUT" }))).toMatch(/not valid/);
  });

  test("an unknown code falls back to a sentence, not the code", () => {
    expect(capabilityErrorMessage(Object.assign(new Error("INVALID_TRANSITION"), { code: "INVALID_TRANSITION" }))).toBe("Could not save that. Please try again.");
    expect(capabilityErrorMessage(new Error("Network down"))).toBe("Network down");
  });
});
