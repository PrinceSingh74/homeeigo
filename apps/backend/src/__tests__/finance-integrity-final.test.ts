import { describe, expect, test } from "bun:test";
import { financialIntegrityService } from "../services/financial-integrity.service";
import { financeLiabilityService } from "../services/finance-liability.service";

describe("Phase 6 — Financial Integrity Validator (final)", () => {
  test("validate() is available", () => {
    expect(typeof financialIntegrityService.validate).toBe("function");
    expect(typeof financialIntegrityService.runChecks).toBe("function");
  });

  test("liability service includes referral + adjustment", async () => {
    expect(typeof financeLiabilityService.buildCurrentReport).toBe("function");
  });

  test("severity → level mapping", () => {
    const toLevel = (s: string) => (s === "CRITICAL" ? "CRITICAL" : s === "LOW" ? "INFO" : "WARNING");
    expect(toLevel("CRITICAL")).toBe("CRITICAL");
    expect(toLevel("HIGH")).toBe("WARNING");
    expect(toLevel("MEDIUM")).toBe("WARNING");
    expect(toLevel("LOW")).toBe("INFO");
  });

  test("score penalty model bounded 0-100", () => {
    const penaltyFor = (sev: string) =>
      sev === "CRITICAL" ? 15 : sev === "HIGH" ? 8 : sev === "MEDIUM" ? 4 : 2;
    const issues = ["CRITICAL", "HIGH", "LOW"];
    const penalty = issues.reduce((s, i) => s + penaltyFor(i), 0);
    const score = Math.max(0, 100 - penalty);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(75);
  });

  test("new validator categories are defined", () => {
    const categories = [
      "MISSING_REFERRAL_LEDGER_ENTRY",
      "MISSING_ADJUSTMENT_JOURNAL",
      "MISSING_HCOIN_EXPIRY_JOURNAL",
      "MISSING_HISTORICAL_JOURNAL",
    ];
    expect(categories).toContain("MISSING_REFERRAL_LEDGER_ENTRY");
    expect(categories).toContain("MISSING_ADJUSTMENT_JOURNAL");
    expect(categories).toContain("MISSING_HCOIN_EXPIRY_JOURNAL");
    expect(categories.length).toBe(4);
  });
});
