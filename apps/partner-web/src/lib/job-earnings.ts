import type { PartnerEarningLine, PartnerJobEarning } from "@/types/partner";

/**
 * What THIS job pays the partner, on the job page. The server itemises it
 * (`GET /api/providers/me/bookings/:id/earning`, backend `lib/earning-settlement.ts`): gross,
 * commission, a derived bonus or adjustment, net. The page renders those lines verbatim. Before
 * completion there is no row and the page says so: nothing is estimated here from the booking
 * amount, and no rate is applied on the client.
 */
export const EARNINGS_AFTER_COMPLETION = "Your earning for this job is shown once it is completed.";

const NOTHING_TO_SHOW = new Set(["cancelled", "cancelled_by_user", "cancelled_by_provider", "rejected", "expired"]);

export type JobEarningsView =
  | { state: "hidden"; lines: PartnerEarningLine[] }
  | { state: "after_completion"; lines: PartnerEarningLine[]; message: string }
  | { state: "loading"; lines: PartnerEarningLine[] }
  | { state: "error"; lines: PartnerEarningLine[]; message: string }
  | { state: "none"; lines: PartnerEarningLine[]; message: string }
  | { state: "lines"; lines: PartnerEarningLine[]; net: number; invoiceNumber: string; settlementLabel: string; earnedAt: string };

export function jobEarningsView(
  status: string,
  query: { data: PartnerJobEarning | null | undefined; isLoading: boolean; isError: boolean },
): JobEarningsView {
  const s = (status ?? "").toLowerCase();
  if (NOTHING_TO_SHOW.has(s)) return { state: "hidden", lines: [] };
  if (s !== "completed") return { state: "after_completion", lines: [], message: EARNINGS_AFTER_COMPLETION };
  if (query.isLoading) return { state: "loading", lines: [] };
  if (query.isError) return { state: "error", lines: [], message: "Your earning for this job could not be loaded right now." };
  if (query.data === null) return { state: "none", lines: [], message: "No earning is recorded for this job." };
  if (!query.data) return { state: "loading", lines: [] };
  const e = query.data;
  return {
    state: "lines",
    lines: e.lines,
    net: e.net,
    invoiceNumber: e.invoiceNumber,
    settlementLabel: e.settlement === "REVERSED" ? "Reversed" : "Credited to your wallet",
    earnedAt: e.earnedAt,
  };
}

/** The exact rupee amount (paise kept), signed by the server's `kind`, never recomputed. */
export function earningAmountText(line: PartnerEarningLine): string {
  const rupees = `₹${line.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (line.kind === "debit") return `− ${rupees}`;
  if (line.kind === "credit") return `+ ${rupees}`;
  return rupees;
}
