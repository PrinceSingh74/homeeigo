/**
 * Dispatch-offer logic, pure (unit-tested under Node; no RN imports).
 *
 * An offer is a PENDING booking returned by `GET /api/providers/me/bookings?status=pending`, which
 * the backend only returns while the offer is live, with `offer: { dispatchedAt, expiresAt }`
 * (apps/backend/src/services/provider.service.ts → myBookings). Mirrors
 * apps/partner-web/src/hooks/use-offer-countdown.ts and JobOfferCard.tsx.
 *
 * The countdown is a display, never an authority: the server re-checks the window inside the accept
 * transaction. `nowMs` should be the SERVER-time estimate (lib/server-clock.ts), so a phone whose
 * clock is wrong does not show a wrong deadline.
 */

export type OfferWindow = { dispatchedAt: string; expiresAt: string };

export type OfferCountdown = {
  /** Whole seconds left, clamped at 0. */
  secondsLeft: number;
  /** 1 at dispatch → 0 at the deadline. */
  fraction: number;
  expired: boolean;
  urgency: "calm" | "warning" | "critical";
};

export function computeOfferCountdown(
  offer: OfferWindow | null | undefined,
  nowMs: number,
  thresholds: { warning: number; critical: number } = { warning: 0.5, critical: 0.2 },
): OfferCountdown | null {
  if (!offer) return null;
  const expiresMs = Date.parse(offer.expiresAt);
  const dispatchedMs = Date.parse(offer.dispatchedAt);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(dispatchedMs)) return null;

  const windowMs = Math.max(1000, expiresMs - dispatchedMs);
  const remainingMs = expiresMs - nowMs;
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const fraction = Math.min(1, Math.max(0, 1 - (nowMs - dispatchedMs) / windowMs));
  return {
    secondsLeft,
    fraction,
    expired: remainingMs <= 0,
    urgency: fraction <= thresholds.critical ? "critical" : fraction <= thresholds.warning ? "warning" : "calm",
  };
}

/** True only for an offer whose window is still open at `nowMs`. No window = not a live offer. */
export function isOfferLive(offer: OfferWindow | null | undefined, nowMs: number): boolean {
  const c = computeOfferCountdown(offer, nowMs);
  return c != null && !c.expired;
}

/** `4:05` / `0:09`. */
export function formatCountdown(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export type AcceptFailure = {
  message: string;
  /** The offer is gone for good (claimed / expired / not yours): drop it from the list. */
  offerGone: boolean;
};

/**
 * Accept-error codes from `POST /api/bookings/:id/accept` (apps/backend/src/routes/bookings.ts)
 * → what the partner should understand and do next.
 */
export function describeAcceptFailure(code: string | null | undefined, serverMessage?: string | null): AcceptFailure {
  switch (code) {
    case "ALREADY_CLAIMED":
      return { message: "Another professional already accepted this job.", offerGone: true };
    case "NOT_FOUND":
      return {
        message: "This request expired or is no longer assigned to you. Your list has been refreshed.",
        offerGone: true,
      };
    case "INVALID_STATUS":
      return { message: "This booking can no longer be accepted.", offerGone: true };
    case "PAYMENT_NOT_SETTLED":
      return {
        message: "The customer's payment hasn't been confirmed yet. Try again in a moment.",
        offerGone: false,
      };
    case "CAPACITY_LIMIT":
      return {
        message: "You already have the maximum number of active jobs. Finish a job before accepting another.",
        offerGone: false,
      };
    case "STALE_PRESENCE":
      return {
        message: "You look offline to dispatch. Make sure you're online, wait a few seconds, then try again.",
        offerGone: false,
      };
    case "STALE_LOCATION":
      return {
        message: "Your GPS location is out of date. Turn on location, then try Accept again.",
        offerGone: false,
      };
    case "PROVIDER_UNAVAILABLE":
      return {
        message: "You're not available for new jobs right now (offline or paused). Go online to accept.",
        offerGone: false,
      };
    case "ACCOUNT_RESTRICTED":
      return { message: "Your account is currently unavailable for job assignments.", offerGone: false };
    case "NETWORK_ERROR":
      return { message: "Couldn't reach HOMEEIGO. Check your connection and try again.", offerGone: false };
    default:
      return { message: serverMessage || "Couldn't accept this job. Please try again.", offerGone: false };
  }
}
