/**
 * Booking route params. There is deliberately NO client-side price function here any more:
 * the old `calculateTotal` (base + 10% tax) ignored weather surge, membership discounts and
 * coupons, so the total it showed differed from what the backend charged. Every checkout total
 * now comes from the server quote — see src/lib/booking-quote.ts (POST /api/bookings/price-quote).
 */
export type BookParams = {
  service?: string;
  package?: string;
  promo?: string;
  providerId?: string;
};
