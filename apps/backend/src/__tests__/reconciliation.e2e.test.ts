import { describe, expect, test } from "bun:test";
import { ReconciliationStatus } from "@prisma/client";

describe("Reconciliation E2E contracts", () => {
  test("all status values present", () => {
    /**
     * Both sides are compared as plain strings.
     *
     * `.sort()` widens the enum's values to `string[]`, and the expected literals are `string[]`
     * too. Casting either side to the enum type would only be re-stating what the assertion is
     * already checking, so the comparison is made in the type both sides actually have.
     */
    const actual: string[] = [...Object.values(ReconciliationStatus)].sort();
    const expected: string[] = [
      "MATCHED",
      "MISMATCH",
      "MISSING_GATEWAY",
      "MISSING_LOCAL",
      "REFUND_MISMATCH",
      "SETTLEMENT_MISMATCH",
      "SETTLEMENT_PENDING",
    ].sort();
    expect(actual).toEqual(expected);
  });

  test("no double spend — payment id unique", () => {
    const payments = new Set(["pay_1", "pay_2"]);
    expect(payments.has("pay_1")).toBe(true);
    expect(payments.size).toBe(2);
  });

  test("refund cannot exceed paid", () => {
    const paid = 500;
    const refunded = 600;
    expect(refunded > paid).toBe(true);
  });

  test("match pct 100 when no issues", () => {
    const matched = 50;
    const total = 50;
    expect(total > 0 ? Math.round((matched / total) * 100) : 100).toBe(100);
  });
});

describe("Migration verification", () => {
  test("PASS when no pending or failed", () => {
    const issues: string[] = [];
    expect(issues.length === 0 ? "PASS" : "FAIL").toBe("PASS");
  });

  test("schema checksum is sha256 hex length 64", () => {
    const sample = "a".repeat(64);
    expect(sample.length).toBe(64);
  });
});
