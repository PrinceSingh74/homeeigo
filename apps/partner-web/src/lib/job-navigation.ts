/**
 * Navigation is bound to ONE job. `/navigation?booking=<id>` routes to that job's address and to no
 * other; without the parameter it keeps the old behaviour (the first active job with coordinates).
 */
export type NavigableBooking = {
  id: string;
  customer?: { firstName?: string | null; lastName?: string | null } | null;
  address?: { fullAddress?: string | null; latitude?: number | null; longitude?: number | null } | null;
};

export type NavDestination = { lat: number; lng: number };

/** The job's coordinates as the payload carries them, or `null`. Never a guessed point. */
export function jobDestination(booking: NavigableBooking | null | undefined): NavDestination | null {
  const lat = booking?.address?.latitude;
  const lng = booking?.address?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * The booking to navigate to. A requested id is honoured exactly: when that job is not in the list
 * or carries no coordinates the answer is `null` — falling back to another job would send the
 * partner to the wrong customer.
 */
export function pickNavigationBooking<T extends NavigableBooking>(bookings: readonly T[], bookingId?: string | null): T | null {
  if (bookingId) {
    const requested = bookings.find((b) => b.id === bookingId);
    return requested && jobDestination(requested) ? requested : null;
  }
  return bookings.find((b) => jobDestination(b) !== null) ?? null;
}

/** The customer's name as the API sends it (`firstName` / `lastName`), or `null` — never a placeholder. */
export function navigationCustomerLabel(booking: NavigableBooking | null | undefined): string | null {
  const name = `${booking?.customer?.firstName ?? ""} ${booking?.customer?.lastName ?? ""}`.trim();
  return name || null;
}

export function navigationHref(bookingId: string): string {
  return `/navigation?booking=${encodeURIComponent(bookingId)}`;
}

/** External turn-by-turn. Works without a Maps key, so navigation never depends on the in-app map. */
export function googleDirectionsUrl(d: NavDestination): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
}
