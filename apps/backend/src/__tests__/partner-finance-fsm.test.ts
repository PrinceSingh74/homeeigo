import { describe, expect, test } from "bun:test";
import { assertFinanceTransition, canTransitionFinance, deriveFinanceState } from "../lib/partner-finance-fsm";
import { FINANCE_STATES, JOB_STATES, LIFECYCLE_STATES } from "../lib/partner-four-axis";

describe("partner finance FSM", () => {
  test("happy path EARNING_POSTED → … → PAID", () => {
    const path = [
      ["EARNING_POSTED", "PENDING"],
      ["PENDING", "AVAILABLE"],
      ["AVAILABLE", "WITHDRAWAL_REQUESTED"],
      ["WITHDRAWAL_REQUESTED", "PROCESSING"],
      ["PROCESSING", "PAID"],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransitionFinance(from, to)).toBe(true);
    }
    expect(canTransitionFinance("EARNING_POSTED", "AVAILABLE")).toBe(true);
  });

  test("job COMPLETED is not a finance hop", () => {
    expect((FINANCE_STATES as readonly string[]).includes("COMPLETED")).toBe(false);
    expect((JOB_STATES as readonly string[]).includes("EARNING_POSTED")).toBe(false);
    expect((LIFECYCLE_STATES as readonly string[]).includes("PAID")).toBe(false);
    expect(() => assertFinanceTransition("AVAILABLE", "PAID")).toThrow(/INVALID_TRANSITION/);
  });

  test("projects earning + withdrawal onto the finance axis", () => {
    expect(
      deriveFinanceState({ earningExists: true, settlementStatus: "HELD", availableBalance: 0 }),
    ).toBe("EARNING_POSTED");
    expect(
      deriveFinanceState({
        earningExists: true,
        settlementStatus: "CREDITED",
        availableBalance: 800,
        reservedBalance: 0,
      }),
    ).toBe("AVAILABLE");
    expect(
      deriveFinanceState({
        earningExists: true,
        settlementStatus: "CREDITED",
        availableBalance: 800,
        withdrawalStatus: "REQUESTED",
      }),
    ).toBe("WITHDRAWAL_REQUESTED");
    expect(
      deriveFinanceState({
        earningExists: true,
        settlementStatus: "CREDITED",
        withdrawalStatus: "PROCESSING",
      }),
    ).toBe("PROCESSING");
    expect(
      deriveFinanceState({
        earningExists: true,
        settlementStatus: "CREDITED",
        withdrawalStatus: "COMPLETED",
      }),
    ).toBe("PAID");
  });
});
