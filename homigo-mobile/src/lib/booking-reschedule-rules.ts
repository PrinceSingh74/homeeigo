/**
 * Whether the app should OFFER reschedule for a booking — pure domain logic, no React.
 *
 * It lived inside `use-reschedule-booking.ts`, which imports react-query and the API client, so the
 * rule could not be unit-tested without pulling the whole client graph. The rule is the interesting
 * part and the hook is plumbing, so the rule moved out; the hook re-exports it and nothing else
 * changed for callers.
 *
 * The SERVER remains the judge: this only decides whether to show the button, and the server's
 * refusal is still shown verbatim when it disagrees.
 */

/** Backend statuses `bookingService.update` refuses to reschedule (INVALID_STATUS). */
const NOT_RESCHEDULABLE = new Set([
  "in_progress",
  "completed",
  "cancelled_by_user",
  "cancelled_by_provider",
  "cancelled",
  "rejected",
  // PAYMENT_PENDING_TTL released the slot; there is nothing left to move, and offering the button
  // would only send the customer into a request the server refuses.
  "expired",
  // Nobody was served and the outcome is settled; there is no appointment left to move.
  "customer_no_show",
  "provider_no_show",
]);

export function canRescheduleBooking(backendStatus: string | undefined): boolean {
  const s = (backendStatus ?? "").toLowerCase().replace(/-/g, "_");
  if (!s) return false;
  if (NOT_RESCHEDULABLE.has(s) || s.includes("cancel")) return false;
  // A partner already travelling or at the door: moving the slot makes no sense, and the web app
  // does not offer it either.
  if (s === "en_route" || s === "arrived") return false;
  return true;
}
