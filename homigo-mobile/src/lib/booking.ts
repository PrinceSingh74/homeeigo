import { promoDiscount } from "./services";

export function generateBookingId() {
  return `HMG-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function calculateTotal(
  packagePrice: number,
  addonTotal: number,
  promoCode: string | null,
) {
  const subtotal = packagePrice + addonTotal;
  const discount = promoDiscount(promoCode, packagePrice);
  const afterDiscount = Math.max(0, subtotal - discount);
  const platformFee = 20;
  const gst = +((afterDiscount + platformFee) * 0.18).toFixed(2);
  const total = +(afterDiscount + platformFee + gst).toFixed(2);
  return { subtotal, discount, platformFee, gst, total, saved: discount + 120 };
}

export type BookParams = {
  service?: string;
  package?: string;
  promo?: string;
};
