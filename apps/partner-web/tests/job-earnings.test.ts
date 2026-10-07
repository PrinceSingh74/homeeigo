import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EARNINGS_AFTER_COMPLETION, earningAmountText, jobEarningsView } from "../src/lib/job-earnings";
import type { PartnerJobEarning } from "../src/types/partner";

/**
 * Phase 13 P2 — what THIS job pays the partner, on the job page. The server itemises it
 * (`GET /api/providers/me/bookings/:id/earning`, backend `lib/earning-settlement.ts`): gross,
 * commission, a derived "Performance bonus" / "Adjustment" when net ≠ gross − commission, net. The
 * page renders those lines verbatim. Before completion there is no row and the page says so — no
 * estimate is computed here from the booking amount and a commission rate.
 */
const earning: PartnerJobEarning = {
  earningId: "e1",
  invoiceNumber: "ERN-ABCD1234",
  bookingId: "b1",
  settlement: "CREDITED",
  earnedAt: "2026-10-07T10:00:00.000Z",
  lines: [
    { key: "gross", label: "Gross amount", amount: 658, kind: "base" },
    { key: "commission", label: "Platform commission", amount: 131.6, kind: "debit" },
    { key: "adjustment", label: "Performance bonus", amount: 50, kind: "credit" },
    { key: "net", label: "Net earning", amount: 576.4, kind: "total" },
  ],
  net: 576.4,
};

describe("jobEarningsView — which state the earnings line is in", () => {
  test("a job that is not completed shows the after-completion sentence and no numbers", () => {
    for (const status of ["pending", "accepted", "assigned", "en_route", "in_progress"] as const) {
      const v = jobEarningsView(status, { data: undefined, isLoading: false, isError: false });
      expect(v.state).toBe("after_completion");
      expect(v.lines).toEqual([]);
      expect(v.message).toBe(EARNINGS_AFTER_COMPLETION);
    }
  });

  test("a completed job with the server's row shows the server's lines, verbatim", () => {
    const v = jobEarningsView("completed", { data: earning, isLoading: false, isError: false });
    expect(v.state).toBe("lines");
    expect(v.lines).toBe(earning.lines);
    expect(v.net).toBe(576.4);
    expect(v.invoiceNumber).toBe("ERN-ABCD1234");
    expect(v.settlementLabel).toBe("Credited to your wallet");
  });

  test("a reversed earning is labelled as reversed and still itemised", () => {
    const v = jobEarningsView("completed", { data: { ...earning, settlement: "REVERSED" }, isLoading: false, isError: false });
    expect(v.state).toBe("lines");
    expect(v.settlementLabel).toBe("Reversed");
  });

  test("a completed job the server has no earning for says so — it does not fall back to the booking amount", () => {
    const v = jobEarningsView("completed", { data: null, isLoading: false, isError: false });
    expect(v.state).toBe("none");
    expect(v.message).toBe("No earning is recorded for this job.");
    expect(v.lines).toEqual([]);
  });

  test("loading and error states are their own, never a number", () => {
    expect(jobEarningsView("completed", { data: undefined, isLoading: true, isError: false }).state).toBe("loading");
    const err = jobEarningsView("completed", { data: undefined, isLoading: false, isError: true });
    expect(err.state).toBe("error");
    expect(err.lines).toEqual([]);
  });

  test("a cancelled job has no earnings line to show", () => {
    for (const status of ["cancelled", "cancelled_by_user", "cancelled_by_provider", "rejected"] as const) {
      expect(jobEarningsView(status, { data: undefined, isLoading: false, isError: false }).state).toBe("hidden");
    }
  });
});

describe("earningAmountText — the sign comes from the server's kind, the number is exact", () => {
  test("base and total are plain, a debit is taken off, a credit is added", () => {
    expect(earningAmountText({ key: "gross", label: "Gross amount", amount: 658, kind: "base" })).toBe("₹658");
    expect(earningAmountText({ key: "commission", label: "Platform commission", amount: 131.6, kind: "debit" })).toBe("− ₹131.6");
    expect(earningAmountText({ key: "adjustment", label: "Performance bonus", amount: 50, kind: "credit" })).toBe("+ ₹50");
    expect(earningAmountText({ key: "net", label: "Net earning", amount: 576.4, kind: "total" })).toBe("₹576.4");
  });

  test("paise are never rounded away (the invoice shows them too)", () => {
    expect(earningAmountText({ key: "net", label: "Net earning", amount: 1234.56, kind: "total" })).toBe("₹1,234.56");
  });
});

describe("no client-side estimate on the job page", () => {
  test("the job page and the earnings line never multiply an amount by a commission rate", () => {
    const src = join(import.meta.dir, "..", "src");
    for (const rel of ["app/(partner)/requests/[id]/page.tsx", "components/requests/JobEarningsLine.tsx", "lib/job-earnings.ts"]) {
      const text = readFileSync(join(src, rel), "utf8");
      expect(text).not.toMatch(/commissionRate/);
      expect(text).not.toMatch(/finalAmount\s*\*/);
    }
  });
});
