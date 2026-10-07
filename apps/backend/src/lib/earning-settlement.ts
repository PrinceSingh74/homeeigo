/**
 * Canonical settlement filter for partner-available earnings.
 *
 * `Earning.paymentStatus` is `EarningSettlementStatus`:
 *   CREDITED — money that settled to the partner. Realised, forecastable, coachable.
 *   REVERSED — clawed back. Must not inflate available totals, forecasts, or per-job averages.
 *
 * Wallet and ledger remain the money movement source of truth. This flag does not replace them
 * and must not be used to invent a third balance. Reads that answer "what can this partner
 * spend / forecast / be coached on" filter CREDITED. Itemised history may still show REVERSED
 * rows with their status.
 */
export const CREDITED_EARNING_WHERE = { paymentStatus: "CREDITED" as const };

/* ------------------------------------------------------------------ */
/* The partner's per-job earnings line (Phase 13 P2)                   */
/* ------------------------------------------------------------------ */

/**
 * One line of a job's earning as the partner reads it. `amount` is always positive; `kind` says
 * which way it moves: `base` is the gross, `debit` is taken off, `credit` is added, `total` is net.
 */
export type PartnerEarningLine = {
  key: "gross" | "commission" | "adjustment" | "net";
  label: string;
  amount: number;
  kind: "base" | "debit" | "credit" | "total";
};

/**
 * `Earning` persists gross, commission and net only. The bonus and the deduction computed at
 * completion (`earnings.service.ts` — `net = gross − commission + bonus − deduction`) go to the
 * ledger and are folded into `netEarning`, so the one thing that can be itemised from the row is
 * the gap between net and gross − commission: a "Performance bonus" when positive, an "Adjustment"
 * when negative, no line when zero. Correct for every historical row without a backfill; the invoice
 * (`invoice-report.service.ts`) and the job page both read these lines, so they cannot disagree.
 */
export function partnerEarningLines(e: { grossAmount: number; commission: number; netEarning: number }): PartnerEarningLine[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const adjustment = round2(e.netEarning - (e.grossAmount - e.commission));
  const lines: PartnerEarningLine[] = [
    { key: "gross", label: "Gross amount", amount: round2(e.grossAmount), kind: "base" },
    { key: "commission", label: "Platform commission", amount: round2(e.commission), kind: "debit" },
  ];
  if (adjustment > 0) lines.push({ key: "adjustment", label: "Performance bonus", amount: adjustment, kind: "credit" });
  else if (adjustment < 0) lines.push({ key: "adjustment", label: "Adjustment", amount: Math.abs(adjustment), kind: "debit" });
  lines.push({ key: "net", label: "Net earning", amount: round2(e.netEarning), kind: "total" });
  return lines;
}

/** The invoice number the invoices page and the printable invoice already show for an earning. */
export function earningInvoiceNumber(earningId: string): string {
  return `ERN-${earningId.slice(-8).toUpperCase()}`;
}

/**
 * `GET /api/providers/me/bookings/:bookingId/earning` — mirrored field for field in
 * `apps/partner-web/src/types/partner.ts` (`PartnerJobEarning`). Only the partner's own money: the
 * customer's payment, refund or tender never appear here (X-29).
 */
export type PartnerJobEarning = {
  earningId: string;
  invoiceNumber: string;
  bookingId: string;
  settlement: "CREDITED" | "REVERSED";
  earnedAt: string;
  lines: PartnerEarningLine[];
  net: number;
};

export function partnerJobEarningView(row: {
  id: string;
  bookingId: string | null;
  grossAmount: number;
  commission: number;
  netEarning: number;
  paymentStatus: "CREDITED" | "REVERSED";
  createdAt: Date;
}): PartnerJobEarning {
  const lines = partnerEarningLines(row);
  return {
    earningId: row.id,
    invoiceNumber: earningInvoiceNumber(row.id),
    bookingId: row.bookingId ?? "",
    settlement: row.paymentStatus,
    earnedAt: row.createdAt.toISOString(),
    lines,
    net: lines[lines.length - 1]!.amount,
  };
}
