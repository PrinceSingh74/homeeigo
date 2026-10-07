/**
 * Phase 13 P2 — the partner's per-job earnings line.
 *
 * `Earning` persists gross, commission and net only; the bonus and the deduction computed at
 * completion (`earnings.service.ts`) go to the ledger and are folded into `netEarning`. The invoice
 * (`invoice-report.service.ts`) derives the gap from the three stored values and shows it as a
 * "Performance bonus" or an "Adjustment" row. The job page shows the same itemisation, so both read
 * one function — the lines below are the server's own words and numbers, nothing is re-derived on a
 * client. Pure: no database.
 */
import { describe, expect, test } from "bun:test";
import { partnerEarningLines, partnerJobEarningView } from "../lib/earning-settlement";

describe("partnerEarningLines — gross, commission, the derived adjustment, net", () => {
  test("a perfect-rating bonus folded into net comes back as a Performance bonus line", () => {
    // The real case that motivated the invoice fix: 658 − 131.6 = 526.4, net 576.4 (₹50 bonus).
    expect(partnerEarningLines({ grossAmount: 658, commission: 131.6, netEarning: 576.4 })).toEqual([
      { key: "gross", label: "Gross amount", amount: 658, kind: "base" },
      { key: "commission", label: "Platform commission", amount: 131.6, kind: "debit" },
      { key: "adjustment", label: "Performance bonus", amount: 50, kind: "credit" },
      { key: "net", label: "Net earning", amount: 576.4, kind: "total" },
    ]);
  });

  test("gross − commission = net → no adjustment line at all", () => {
    expect(partnerEarningLines({ grossAmount: 500, commission: 100, netEarning: 400 }).map((l) => l.key)).toEqual([
      "gross",
      "commission",
      "net",
    ]);
  });

  test("net below gross − commission is an Adjustment debit, with the amount positive", () => {
    const lines = partnerEarningLines({ grossAmount: 500, commission: 100, netEarning: 300 });
    expect(lines[2]).toEqual({ key: "adjustment", label: "Adjustment", amount: 100, kind: "debit" });
  });

  test("float noise below a paisa is not an adjustment", () => {
    expect(partnerEarningLines({ grossAmount: 333.33, commission: 66.67, netEarning: 266.66 }).map((l) => l.key)).toEqual([
      "gross",
      "commission",
      "net",
    ]);
  });
});

describe("partnerJobEarningView — the row as the job page receives it", () => {
  const row = {
    id: "clx1234567890earning",
    bookingId: "bk1",
    grossAmount: 658,
    commission: 131.6,
    netEarning: 576.4,
    paymentStatus: "CREDITED" as const,
    createdAt: new Date("2026-10-07T10:00:00.000Z"),
  };

  test("carries the invoice number the invoices page uses, the settlement state and the lines", () => {
    const v = partnerJobEarningView(row);
    expect(v.earningId).toBe(row.id);
    expect(v.invoiceNumber).toBe("ERN-0EARNING");
    expect(v.bookingId).toBe("bk1");
    expect(v.settlement).toBe("CREDITED");
    expect(v.earnedAt).toBe("2026-10-07T10:00:00.000Z");
    expect(v.net).toBe(576.4);
    expect(v.lines.map((l) => l.key)).toEqual(["gross", "commission", "adjustment", "net"]);
  });

  test("a reversed earning says so and still itemises (history keeps its rows)", () => {
    expect(partnerJobEarningView({ ...row, paymentStatus: "REVERSED" }).settlement).toBe("REVERSED");
  });

  test("never carries the customer's money or anything outside the partner boundary", () => {
    const keys = Object.keys(partnerJobEarningView(row));
    expect(keys.sort()).toEqual(["bookingId", "earnedAt", "earningId", "invoiceNumber", "lines", "net", "settlement"]);
  });
});
