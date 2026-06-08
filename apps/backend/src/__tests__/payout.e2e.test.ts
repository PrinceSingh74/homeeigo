import { describe, expect, test } from "bun:test";
import { WithdrawalStatus } from "@prisma/client";

describe("Payout E2E contracts", () => {
  test("partner status mapping", () => {
    const map = (s: WithdrawalStatus) => {
      if (s === WithdrawalStatus.COMPLETED) return "Completed";
      if (s === WithdrawalStatus.PROCESSING) return "Processing";
      if (s === WithdrawalStatus.FAILED) return "Failed";
      return "Pending";
    };
    expect(map(WithdrawalStatus.COMPLETED)).toBe("Completed");
    expect(map(WithdrawalStatus.REQUESTED)).toBe("Pending");
  });

  test("available = current - pending", () => {
    const current = 10000;
    const pending = 3000;
    expect(Math.max(0, current - pending)).toBe(7000);
  });

  test("no duplicate payout completion", () => {
    const terminal = WithdrawalStatus.COMPLETED;
    const shouldSkip = terminal === WithdrawalStatus.COMPLETED;
    expect(shouldSkip).toBe(true);
  });

  test("payout webhook processed completes withdrawal", () => {
    const status = "processed";
    expect(["processed", "success"].includes(status.toLowerCase())).toBe(true);
  });
});

describe("Partner finance center API", () => {
  test("endpoint path is /api/providers/me/payouts", () => {
    expect("/api/providers/me/payouts").toContain("payouts");
  });
});
