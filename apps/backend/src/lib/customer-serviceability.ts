/**
 * The customer-facing answer to "can I book this service here, on this date?".
 *
 * Five statuses and one sentence each. The inputs are facts other parts of the platform already
 * decide (the service is bookable, the address is inside the configured coverage, a service zone
 * contains it, how many of the day's times are free); this module only names the outcome. It
 * returns nothing about which rule, zone or professional produced the answer.
 */
export const CUSTOMER_SERVICEABILITY_STATUSES = ["AVAILABLE", "LIMITED", "NOT_AVAILABLE", "NEEDS_CONFIRMATION", "TEMPORARILY_UNAVAILABLE"] as const;
export type CustomerServiceabilityStatus = (typeof CUSTOMER_SERVICEABILITY_STATUSES)[number];

export type CustomerServiceability = { status: CustomerServiceabilityStatus; message: string };

export function customerServiceability(input: {
  /** The service is live and bookable right now. */
  bookable: boolean;
  /** The address has a map pin. Without one the zone check cannot run. */
  hasCoordinates: boolean;
  /** A service zone contains the address. `null`: the check did not or could not run. */
  inServiceArea: boolean | null;
  /** The address passes the service's own city / PIN-code coverage. */
  coverageAllowed: boolean;
  /** The chosen date's times, when a date was given. */
  slots: { total: number; available: number } | null;
}): CustomerServiceability {
  if (!input.bookable) return { status: "TEMPORARILY_UNAVAILABLE", message: "This service is temporarily unavailable." };
  // A known "no" is said before an unknown: the wrong city is not a matter for confirmation.
  if (!input.coverageAllowed || input.inServiceArea === false) {
    return { status: "NOT_AVAILABLE", message: "This service is not currently available in your area" };
  }
  if (!input.hasCoordinates || input.inServiceArea === null) {
    return { status: "NEEDS_CONFIRMATION", message: "We need to confirm that we can serve this address." };
  }
  if (input.slots) {
    if (input.slots.available <= 0) return { status: "LIMITED", message: "No times are left on this date. Try another date." };
    // Presentation only: "limited" is fewer than half of the day's times still free.
    if (input.slots.available * 2 < input.slots.total) return { status: "LIMITED", message: "Limited availability for this date" };
  }
  return { status: "AVAILABLE", message: "Available for your location" };
}
