/**
 * Phase 11 — preferred provider is not a customer booking guarantee.
 *
 * What the code actually does:
 *   - Gender / "pick this professional" is unsupported (`PROFESSIONAL_PREFERENCE_SUPPORTED`).
 *   - `matching.preferredProvider` is a catalogue flag no matcher reads.
 *   - A rework follow-up with `sameProviderPreferred` asks for the same partner first, and only
 *     when the follow-up fee is WAIVED. If they are not eligible, the follow-up is created
 *     unassigned. QUOTED fees are refused rather than priced here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFESSIONAL_PREFERENCE_SUPPORTED } from "../lib/service-catalog-config";
import { followUpFeeDecision } from "../lib/booking-case-policy";

describe("preferred provider contract", () => {
  test("customer professional preference is not honoured by assignment", () => {
    expect(PROFESSIONAL_PREFERENCE_SUPPORTED).toBe(false);
  });

  test("matchers do not read the catalogue preferredProvider flag", () => {
    const root = join(import.meta.dir, "..");
    for (const file of ["services/matching.service.ts", "lib/matching-gates.ts", "lib/matching-signals.ts"]) {
      const src = readFileSync(join(root, file), "utf8");
      expect(src.includes("preferredProvider"), file).toBe(false);
    }
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
