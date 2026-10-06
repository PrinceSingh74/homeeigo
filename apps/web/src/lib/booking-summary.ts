import type { ServiceSelectionSnapshot } from "@/types/backend";

export type BookingSummaryLine = {
  /**
   * What the summary prints under the service name, and what the saved booking carries as its
   * selection. A finished label, printed as is. Null when there is nothing to add to the service
   * name (a single-price service) or while the server has not answered.
   */
  label: string | null;
  /** The server's price for the service part of the selection (before add-ons, discounts, tax). */
  amount: number | null;
};

/**
 * The line in the booking summary that names what is being bought.
 *
 * With a carried selection (variant / quantity) the server prices that selection, so the line is
 * the server's snapshot of it and the server's figure; the price option on the page is not what is
 * being charged and is never named. Without one, the line is the chosen price's own name ("Base
 * price") when the service has several prices, and nothing when it has one — never a "package":
 * the server describes no package contents.
 */
export function bookingSummaryLine(input: {
  /** A variant / quantity selection is what is sent to the server (not `packagePrice`). */
  hasSelection: boolean;
  /** `quote.selection` from the price quote. */
  selection: ServiceSelectionSnapshot | null | undefined;
  /** `quote.packagePrice`: the server's price for the service part of this selection. */
  serverPrice: number | null | undefined;
  /** The price option chosen on the page (unnamed for a single-price service); null when unpriced. */
  tier: { name: string; price: number } | null;
}): BookingSummaryLine {
  const { hasSelection, selection, tier } = input;
  const serverPrice = input.serverPrice ?? null;
  if (!hasSelection) {
    if (!tier) return { label: null, amount: serverPrice };
    return { label: tier.name.trim() || null, amount: serverPrice ?? tier.price };
  }
  if (!selection) return { label: null, amount: null };
  const parts = [
    selection.variant?.name ?? null,
    selection.quantityType ? `${selection.quantity} ${selection.unitLabel ?? ""}`.trim() : null,
  ].filter(Boolean);
  return { label: parts.length ? parts.join(" · ") : null, amount: serverPrice };
}
