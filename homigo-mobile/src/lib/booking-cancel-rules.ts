/**
 * Whether the app should OFFER self-serve cancellation — pure domain logic, no React.
 *
 * O3b (owner decision 2026-09-23): once the professional has STARTED the work, the customer may no
 * longer cancel on their own. The server refuses it with `SERVICE_IN_PROGRESS` and routes to a
 * controlled stop through support, so offering the button here would only hand the customer a 409.
 *
 * The trap this module exists to avoid: the UI's `in_progress` presentation state covers BOTH
 * `EN_ROUTE` and `IN_PROGRESS`. Cancelling while the professional is travelling is still allowed —
 * only a started job is not. So the rule reads the BACKEND status, never the collapsed one.
 *
 * The SERVER remains the judge: this only decides whether to show the button.
 */

/** Backend statuses `bookingService.cancel` accepts, minus the one O3b removed for customers. */
const CUSTOMER_CANCELLABLE = new Set([
  "pending",
  "accepted",
  "assigned",
  "en_route",
  "arrived",
]);

export function canCancelBooking(backendStatus: string | undefined): boolean {
  const s = (backendStatus ?? "").toLowerCase().replace(/-/g, "_");
  if (!s) return false;
  return CUSTOMER_CANCELLABLE.has(s);
}

/** What to tell a customer who is looking at a started job instead of a Cancel button. */
export function cancelBlockedReason(backendStatus: string | undefined): string | null {
  const s = (backendStatus ?? "").toLowerCase().replace(/-/g, "_");
  if (s === "in_progress") {
    return "Your professional has started work. Contact support to stop the service and settle what was done.";
  }
  return null;
}

/**
 * §53 — whether to offer "my professional never arrived".
 *
 * Only while the booking is still waiting on the professional. Once the job is IN_PROGRESS
 * somebody clearly did arrive, and the server refuses it as INVALID_STATUS. Deliberately NOT
 * offered before a partner is assigned: there is nobody to be absent yet.
 */
const PROVIDER_NO_SHOW_REPORTABLE = new Set(["accepted", "assigned", "en_route", "arrived"]);

export function canReportProviderNoShow(backendStatus: string | undefined): boolean {
  const s = (backendStatus ?? "").toLowerCase().replace(/-/g, "_");
  return PROVIDER_NO_SHOW_REPORTABLE.has(s);
}
