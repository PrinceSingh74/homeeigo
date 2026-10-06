/**
 * Wallet offers as GET /api/wallet/offers sends them: an id, a title, a description and a discount
 * percentage or an amount. The server sends no promo code.
 *
 * The wallet used to fill every gap — "Special Offer", "Limited period offer", and a code made up
 * from the row number ("HMG100") that no checkout would accept — and showed demo offers when the
 * request had not answered. Here an offer is the server's words and figures or it is not shown; a
 * code appears only if the server ever sends one.
 */
export type WalletOfferView = {
  id: string;
  title: string;
  description: string;
  /** "20% off" / "₹200", from the server's discount / amount; null when it sent neither. */
  badge: string | null;
  code: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function walletOffersFromServer(raw: unknown): WalletOfferView[] {
  if (!Array.isArray(raw)) return [];
  const out: WalletOfferView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = text(o.title);
    if (!title || o.isActive === false) continue;
    const code = text(o.code);
    const discount = positive(o.discount);
    const amount = positive(o.amount);
    out.push({
      id: text(o.id) ?? code ?? title,
      title,
      description: text(o.description) ?? "",
      badge: discount != null ? `${discount}% off` : amount != null ? `₹${amount}` : null,
      code,
    });
  }
  return out;
}
