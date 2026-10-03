import { describe, expect, test } from "bun:test";
import { IFSC_REGEX, validateWithdrawInput, formatPayoutStatus, maskAccountNumber } from "../src/lib/finance";

describe("Section 04 mobile finance helpers", () => {
  test("IFSC regex accepts valid codes", () => {
    expect(IFSC_REGEX.test("HDFC0001234")).toBe(true);
    expect(IFSC_REGEX.test("INVALID")).toBe(false);
  });

  test("maskAccountNumber shows last four digits only", () => {
    expect(maskAccountNumber("123456789012")).toBe("•••• 9012");
  });

  test("formatPayoutStatus maps backend states", () => {
    expect(formatPayoutStatus("COMPLETED")).toBe("Success");
    expect(formatPayoutStatus("PROCESSING")).toBe("Processing");
    expect(formatPayoutStatus("REQUESTED")).toBe("Requested");
  });

  test("validateWithdrawInput rejects over available balance", () => {
    const err = validateWithdrawInput({
      amount: 5000,
      availableBalance: 1000,
      accountHolder: "Test User",
      bankAccountNumber: "1234567890",
      ifscCode: "HDFC0001234",
    });
    expect(err).toContain("cannot exceed");
  });

  test("validateWithdrawInput accepts valid input", () => {
    expect(
      validateWithdrawInput({
        amount: 500,
        availableBalance: 1000,
        accountHolder: "Test User",
        bankAccountNumber: "1234567890",
        ifscCode: "HDFC0001234",
      }),
    ).toBeNull();
  });
});
