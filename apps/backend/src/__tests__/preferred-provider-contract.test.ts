/**
 * Phase 11 — preferred provider is a preference, never a guarantee and never a way round a gate.
 *
 * What the code actually does:
 *   - Gender / "pick this professional" is unsupported (`PROFESSIONAL_PREFERENCE_SUPPORTED`).
 *   - `matching.preferredProvider` on a service gives a professional who already completed a job
 *     for this customer extra RANKING points in `matching.service.ts`. It is read nowhere in the
 *     hard gates or the eligibility signals, so it cannot make an ineligible partner eligible.
 *     (Until 2026-10-06 this file asserted that no matcher read the flag at all. The matcher had
 *     been reading it for ranking since the Phase 11 work, and `phase10-11-spec-conformance`
 *     tests that behaviour; the owner confirmed the ranking boost is the contract.)
 *   - A rework follow-up with `sameProviderPreferred` asks for the same partner first, and only
 *     when the follow-up fee is WAIVED. If they are not eligible, the follow-up is created
 *     unassigned. QUOTED fees are refused rather than priced here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFESSIONAL_PREFERENCE_SUPPORTED } from "../lib/service-catalog-config";
import { followUpFeeDecision } from "../lib/booking-case-policy";

const source = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8");

describe("preferred provider contract", () => {
  test("customer professional preference is not honoured by assignment", () => {
    expect(PROFESSIONAL_PREFERENCE_SUPPORTED).toBe(false);
  });

  test("the hard gates and eligibility signals never read the catalogue preferredProvider flag", () => {
    for (const file of ["lib/matching-gates.ts", "lib/matching-signals.ts"]) {
      expect(source(file).includes("preferredProvider"), file).toBe(false);
    }
  });

  test("the matcher reads the flag for ranking only: a fixed boost, applied to returning professionals", () => {
    const matcher = source("services/matching.service.ts");
    // Read in exactly one place, to load the returning professionals for this customer.
    expect(matcher.split("matching?.preferredProvider").length - 1).toBe(1);
    expect(matcher).toMatch(/catalog\?\.matching\?\.preferredProvider === true && request\.customerId\s*\?\s*await this\.loadReturningProviders/);
    // The boost is a ranking constant, not a gate result.
    expect(matcher).toMatch(/const PREFERRED_PROVIDER_BOOST = \d+;/);
  });

  test("rework asks for the same partner only on a waived fee, and never invents a quoted price", () => {
    expect(followUpFeeDecision({ fee: "WAIVED", sameProviderPreferred: true, windowDays: 7 })).toEqual({
      ok: true,
      fee: "WAIVED",
      sameProviderPreferred: true,
      windowDays: 7,
    });
    expect(followUpFeeDecision({ fee: "QUOTED", sameProviderPreferred: true })).toEqual({
      ok: false,
      error: "OWNER_APPROVAL_REQUIRED",
    });
    expect(followUpFeeDecision(null)).toEqual({ ok: false, error: "REWORK_FEE_NOT_CONFIGURED" });
    const waived = followUpFeeDecision({ fee: "WAIVED" });
    expect(waived.ok && waived.sameProviderPreferred).toBe(false);
  });
});
