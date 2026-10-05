/**
 * Service readiness (`src/lib/service-readiness.ts`): the sentence and next step for each reason a
 * performed service is not being matched, and the page-level summary. The wording is the contract —
 * a state that is waiting on a review must never read as something the professional has to do.
 *
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { describeReadiness, describeReadinessGap, READINESS_LINKS, summarizeReadiness } from "@/lib/service-readiness";

const gap = (code: string, detail = "", title?: string) => describeReadinessGap({ code, detail, ...(title ? { title } : {}) });

describe("credential gaps link to My Credentials", () => {
  test("missing things name the thing in words, not its code", () => {
    const cert = gap("CERTIFICATION_MISSING", "first-aid");
    expect(cert.sentence).toContain('"First aid"');
    expect(cert.sentence).not.toContain("first-aid");
    expect(cert.step?.href).toBe(READINESS_LINKS.credentials);
    for (const code of ["SKILL_MISSING", "EQUIPMENT_MISSING"]) {
      expect(gap(code, "pressure-washer").sentence).toContain('"Pressure washer"');
      expect(gap(code, "pressure-washer").step?.href).toBe(READINESS_LINKS.credentials);
    }
    expect(gap("LANGUAGE_MISMATCH", "hi").sentence).toContain("Hindi");
    expect(gap("LANGUAGE_MISMATCH", "hi").step?.href).toBe(READINESS_LINKS.credentials);
  });

  test("an unverified certificate is waiting on review — never a request to add it again", () => {
    const line = gap("CERTIFICATION_UNVERIFIED", "first-aid");
    expect(line.waiting).toBe(true);
    expect(line.sentence).toMatch(/awaiting review/);
    expect(line.sentence).not.toMatch(/\b(add|upload)\b/i);
    expect(line.step?.label).toMatch(/^View/);
  });

  test("an expired certificate says expired; rejected and revoked say what happened", () => {
    expect(gap("CERTIFICATION_EXPIRED", "first-aid:EXPIRED").sentence).toMatch(/has expired/);
    expect(gap("CERTIFICATION_EXPIRED", "first-aid:REJECTED|EXPIRED").sentence).toMatch(/has expired/);
    expect(gap("CERTIFICATION_EXPIRED", "first-aid:REJECTED").sentence).toMatch(/could not be verified/);
    const revoked = gap("CERTIFICATION_EXPIRED", "first-aid:REVOKED");
    expect(revoked.sentence).toMatch(/revoked/);
    expect(revoked.step?.href).toBe(READINESS_LINKS.support);
    expect(gap("CERTIFICATION_EXPIRED", "first-aid").sentence).toMatch(/no longer valid/);
  });

  test("insurance: missing, awaiting review, expired and not started are different sentences", () => {
    expect(gap("INSURANCE_INVALID", "public-liability:MISSING").sentence).toMatch(/none is on your credentials/);
    const pending = gap("INSURANCE_INVALID", "public-liability:EXPIRED|UNVERIFIED");
    expect(pending.waiting).toBe(true);
    expect(pending.sentence).toMatch(/awaiting review/);
    expect(gap("INSURANCE_INVALID", "public-liability:EXPIRED").sentence).toMatch(/has expired/);
    expect(gap("INSURANCE_INVALID", "public-liability:NOT_YET_EFFECTIVE").sentence).toMatch(/not started yet/);
    expect(gap("INSURANCE_INVALID", "public-liability:EXPIRED").sentence).toContain('"Public liability"');
  });
});

describe("profile gaps", () => {
  test("background check wording follows its exact state", () => {
    const pending = gap("BACKGROUND_CHECK_NOT_CLEARED", "PENDING");
    expect(pending.sentence).toMatch(/being reviewed/);
    expect(pending.waiting).toBe(true);
    expect(pending.step?.href).toBe(READINESS_LINKS.verification);

    const failed = gap("BACKGROUND_CHECK_NOT_CLEARED", "FAILED");
    expect(failed.sentence).toMatch(/was not cleared — contact support/);
    expect(failed.step?.href).toBe(READINESS_LINKS.support);

    expect(gap("BACKGROUND_CHECK_NOT_CLEARED", "NOT_DONE").sentence).toMatch(/not done yet/);
    const unknown = gap("BACKGROUND_CHECK_NOT_CLEARED", "UNKNOWN");
    expect(unknown.sentence).not.toMatch(/UNKNOWN|being reviewed|not done yet/);
    expect(unknown.step?.href).toBe(READINESS_LINKS.verification);
  });

  test("identity verification points at the verification page", () => {
    expect(gap("KYC_UNVERIFIED", "identity_not_verified").step?.href).toBe(READINESS_LINKS.verification);
    expect(gap("KYC_UNVERIFIED", "identity_not_verified").sentence).not.toContain("identity_not_verified");
  });

  test("experience is a fact with no action", () => {
    const line = gap("EXPERIENCE_INSUFFICIENT", "1<3");
    expect(line.sentence).toBe("This service needs at least 3 years of experience; your profile shows 1.");
    expect(line.step).toBeNull();
    expect(gap("EXPERIENCE_INSUFFICIENT", "0<1").sentence).toMatch(/at least 1 year of experience; your profile shows 0/);
    expect(gap("EXPERIENCE_INSUFFICIENT", "garbled").step).toBeNull();
    expect(gap("EXPERIENCE_INSUFFICIENT", "garbled").sentence).not.toContain("garbled");
  });

  test("training shows the module title, or a readable slug, and links to the Academy", () => {
    const titled = gap("TRAINING_INCOMPLETE", "deep-clean-101", "Deep Cleaning Basics");
    expect(titled.sentence).toContain('"Deep Cleaning Basics"');
    expect(titled.step?.href).toBe(READINESS_LINKS.academy);
    expect(gap("TRAINING_INCOMPLETE", "deep-clean-101").sentence).toContain('"Deep clean 101"');
  });
});

describe("unknown codes", () => {
  test("a code this app does not know is a neutral sentence, never the raw code", () => {
    const line = gap("SOME_FUTURE_REASON", "x-y");
    expect(line.sentence).not.toMatch(/SOME_FUTURE_REASON|x-y/);
    expect(line.step?.href).toBe(READINESS_LINKS.support);
  });
});

describe("per service and page summary", () => {
  const ready = { readiness: { ready: true, missing: [] } };
  const notReady = { readiness: { ready: false, missing: [{ code: "KYC_UNVERIFIED", detail: "identity_not_verified" }] } };

  test("a ready service, or one with no readiness, has no lines", () => {
    expect(describeReadiness(ready.readiness)).toEqual([]);
    expect(describeReadiness(undefined)).toEqual([]);
    expect(describeReadiness(notReady.readiness)).toHaveLength(1);
  });

  test("the summary counts services that are not ready", () => {
    expect(summarizeReadiness([ready, notReady, ready, notReady, ready])!.sentence).toBe("2 of your 5 services are not being offered jobs yet.");
    expect(summarizeReadiness([ready, notReady])!.sentence).toBe("1 of your 2 services is not being offered jobs yet.");
    expect(summarizeReadiness([notReady, notReady])!.sentence).toBe("None of your 2 services are being offered jobs yet.");
    expect(summarizeReadiness([notReady])!.sentence).toBe("Your service is not being offered jobs yet.");
  });

  test("all ready is no banner; no readiness at all (older backend) is no readiness UI", () => {
    expect(summarizeReadiness([ready, ready])).toEqual({ total: 2, notReady: 0, sentence: null });
    expect(summarizeReadiness([{}, {}])).toBeNull();
    expect(summarizeReadiness([])).toBeNull();
    // A mixed board counts only what the server reported.
    expect(summarizeReadiness([{}, notReady, ready])!.sentence).toBe("1 of your 2 services is not being offered jobs yet.");
  });
});
