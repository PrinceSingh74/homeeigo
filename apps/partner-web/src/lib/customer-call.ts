/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number. There is no masked-call relay, so the backend withholds partner → customer calls
 * (409 CALL_RELAY_UNAVAILABLE, no number) and the app sends the partner to in-app chat.
 * Mirrors apps/backend/src/services/booking-contact.service.ts `PARTNER_CALL_RELAY_AVAILABLE` and homigo-partner-mobile/src/lib/customer-call.ts.
 */
export const CUSTOMER_CALL_AVAILABLE = false;

export const CUSTOMER_CALL_UNAVAILABLE_NOTE = "Calling the customer isn't available yet — message them in Chat.";

/** The call control's label: the masked number only, marked unavailable. */
export function customerCallLabel(phoneMasked: string | null | undefined): string {
  return `${phoneMasked ? `Call ${phoneMasked}` : "Call"} · unavailable`;
}
