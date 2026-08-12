export function generateBookingId() {
  return `HMG-${Math.floor(100000 + Math.random() * 900000)}`;
}

/**
 * Booking charge — mirrors the backend exactly so the shown total equals what is
 * charged. The server prices `baseAmount = packagePrice + addonTotal`, then
 * `taxes = round(baseAmount * TAX_RATE)` and `finalAmount = baseAmount + taxes`
 * (TAX_RATE = 0.10; see apps/backend/src/services/booking-pricing.service.ts).
 * Packages AND add-ons ARE modelled server-side, so the caller must pass the
 * selected package price plus the chosen add-on total as `baseAmount`. The
 * backend still ignores any client-sent amount (it re-prices from its own
 * catalog), but the UI total must match to avoid a charge > shown surprise.
 */
export function calculateTotal(baseAmount: number) {
  const taxes = Math.round(baseAmount * 0.1);
  const total = baseAmount + taxes;
  return { subtotal: baseAmount, taxes, total };
}

export type BookParams = {
  service?: string;
  package?: string;
  promo?: string;
  providerId?: string;
};
