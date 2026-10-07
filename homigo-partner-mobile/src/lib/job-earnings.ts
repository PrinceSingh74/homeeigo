import type { PartnerEarningLine, PartnerJobEarning } from "@/types/partner";

/**
 * What THIS job pays the partner, on the job screen. Ported from apps/partner-web/src/lib/job-earnings.ts.
 * Pure: no React Native import.
 *
 * The server itemises it (`GET /api/providers/me/bookings/:id/earning`, backend
 * `lib/earning-settlement.ts`): gross, commission, a derived bonus or adjustment, net. The screen
 * renders those lines verbatim. Before completion there is no row and the screen says so: nothing is
 * estimated here from the booking amount, and no rate is applied on the client.
 */
export const EARNINGS_AFTER_COMPLETION = "Your earning for this job is shown once it is completed.";

/** Statuses that end a job without work done: there will never be an earning to wait for. */
const NOTHING_TO_SHOW = new Set(["cancelled_by_user", "cancelled_by_provider", "rejected", "expired", "customer_no_show", "provider_no_show"]);

export type JobEarningsView =
  | { state: "hidden"; lines: PartnerEarningLine[] }
  | { state: "after_completion"; lines: PartnerEarningLine[]; message: string }
  | { state: "loading"; lines: PartnerEarningLine[] }
  | { state: "error"; lines: PartnerEarningLine[]; message: string }
  | { state: "none"; lines: PartnerEarningLine[]; message: string }
  | { state: "lines"; lines: PartnerEarningLine[]; net: number; invoiceNumber: string; earningId: string; settlementLabel: string; earnedAt: string };

/**
 * @param status the booking's status (wire or enum form)
 * @param query  the React Query state of `partnerApi.getBookingEarning(id)` — `data: null` is the
 *               server's 404 EARNING_NOT_FOUND, `undefined` is "not loaded"
 */
/**
 * The server's own sentence for 404 EARNING_NOT_FOUND (routes/providers.ts). "Yet" matters: the row
 * is written after completion, and a fee-waived follow-up visit never gets one.
 */
export const EARNING_NOT_RECORDED = "No earning is recorded for this job yet";

export function jobEarningsView(
  status: string,
  query: { data: PartnerJobEarning | null | undefined; isLoading: boolean; isError: boolean },
): JobEarningsView {
  const s = (status ?? "").toLowerCase();
  if (NOTHING_TO_SHOW.has(s)) return { state: "hidden", lines: [] };
  if (s !== "completed") return { state: "after_completion", lines: [], message: EARNINGS_AFTER_COMPLETION };
  if (query.isLoading) return { state: "loading", lines: [] };
  if (query.isError) return { state: "error", lines: [], message: "Your earning for this job could not be loaded right now." };
  if (query.data === null) return { state: "none", lines: [], message: EARNING_NOT_RECORDED };
  if (!query.data) return { state: "loading", lines: [] };
  const e = query.data;
  return {
    state: "lines",
    lines: e.lines,
    net: e.net,
    invoiceNumber: e.invoiceNumber,
    earningId: e.earningId,
    settlementLabel: e.settlement === "REVERSED" ? "Reversed" : "Credited to your wallet",
    earnedAt: e.earnedAt,
  };
}

/**
 * Indian digit grouping (1,23,456.5) with up to two decimals, paise kept. Written out instead of
 * `toLocaleString("en-IN")` so the text is the same on every device, whatever locale data its
 * JavaScript engine ships.
 */
export function formatRupeesExact(amount: number): string {
  const fixed = (Math.round(Math.abs(amount) * 100) / 100).toFixed(2);
  const [whole = "0", fraction = ""] = fixed.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  const paise = fraction.replace(/0+$/, "");
  return `₹${grouped}${paise ? `.${paise}` : ""}`;
}

/** The exact rupee amount (paise kept), signed by the server's `kind`, never recomputed. */
export function earningAmountText(line: PartnerEarningLine): string {
  const rupees = formatRupeesExact(line.amount);
  if (line.kind === "debit") return `− ${rupees}`;
  if (line.kind === "credit") return `+ ${rupees}`;
  return rupees;
}
