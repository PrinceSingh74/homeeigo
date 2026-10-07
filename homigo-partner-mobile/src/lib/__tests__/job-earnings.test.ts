/**
 * What THIS job pays the partner. The server itemises it
 * (`GET /api/providers/me/bookings/:id/earning`, backend `lib/earning-settlement.ts`): gross,
 * commission, a derived "Performance bonus" / "Adjustment" when net ≠ gross − commission, net. The
 * screen renders those lines verbatim. Before completion there is no row and the screen says so —
 * no estimate is computed here from the booking amount and a commission rate.
 *
 * Ported from apps/partner-web/tests/job-earnings.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EARNINGS_AFTER_COMPLETION, earningAmountText, jobEarningsView } from "../job-earnings.ts";
import type { PartnerJobEarning } from "../../types/partner.ts";

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
const idle = { data: undefined, isLoading: false, isError: false };

test("a job that is not completed shows the after-completion sentence and no numbers", () => {
  for (const status of ["pending", "accepted", "assigned", "en_route", "in_progress"]) {
    const v = jobEarningsView(status, idle);
    assert.equal(v.state, "after_completion");
    assert.deepEqual(v.lines, []);
    assert.equal(v.state === "after_completion" && v.message, EARNINGS_AFTER_COMPLETION);
  }
});

test("a completed job with the server's row shows the server's lines, verbatim", () => {
  const v = jobEarningsView("completed", { data: earning, isLoading: false, isError: false });
  assert.equal(v.state, "lines");
  assert.equal(v.lines, earning.lines);
  if (v.state !== "lines") throw new Error("unreachable");
  assert.equal(v.net, 576.4);
  assert.equal(v.invoiceNumber, "ERN-ABCD1234");
  assert.equal(v.settlementLabel, "Credited to your wallet");
});

test("a reversed earning is labelled as reversed and still itemised", () => {
  const v = jobEarningsView("completed", { data: { ...earning, settlement: "REVERSED" }, isLoading: false, isError: false });
  assert.equal(v.state === "lines" && v.settlementLabel, "Reversed");
});

test("a completed job the server has no earning for says so — it does not fall back to the booking amount", () => {
  const v = jobEarningsView("completed", { data: null, isLoading: false, isError: false });
  assert.equal(v.state, "none");
  assert.equal(v.state === "none" && v.message, "No earning is recorded for this job yet");
  assert.deepEqual(v.lines, []);
});

test("loading and error states are their own, never a number", () => {
  assert.equal(jobEarningsView("completed", { data: undefined, isLoading: true, isError: false }).state, "loading");
  const err = jobEarningsView("completed", { data: undefined, isLoading: false, isError: true });
  assert.equal(err.state, "error");
  assert.deepEqual(err.lines, []);
});

test("a job that ended without work has no earnings line to show", () => {
  for (const status of ["cancelled_by_user", "cancelled_by_provider", "rejected", "expired", "customer_no_show", "provider_no_show", "CANCELLED_BY_USER"]) {
    assert.equal(jobEarningsView(status, idle).state, "hidden", status);
  }
});

test("the sign comes from the server's kind, the number is exact", () => {
  assert.equal(earningAmountText({ key: "gross", label: "Gross amount", amount: 658, kind: "base" }), "₹658");
  assert.equal(earningAmountText({ key: "commission", label: "Platform commission", amount: 131.6, kind: "debit" }), "− ₹131.6");
  assert.equal(earningAmountText({ key: "adjustment", label: "Performance bonus", amount: 50, kind: "credit" }), "+ ₹50");
  assert.equal(earningAmountText({ key: "net", label: "Net earning", amount: 576.4, kind: "total" }), "₹576.4");
});

test("paise are never rounded away, and grouping is Indian whatever the device locale", () => {
  assert.equal(earningAmountText({ key: "net", label: "Net earning", amount: 1234.56, kind: "total" }), "₹1,234.56");
  assert.equal(earningAmountText({ key: "net", label: "Net earning", amount: 123456.5, kind: "total" }), "₹1,23,456.5");
});

test("the module never multiplies an amount by a commission rate", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "job-earnings.ts"), "utf8");
  assert.doesNotMatch(text, /commissionRate/);
  assert.doesNotMatch(text, /finalAmount\s*\*/);
});
