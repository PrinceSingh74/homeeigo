/**
 * When the customer may be offered "confirm the professional is at the door".
 *
 * Arrival is normally established by the professional's device. When that device cannot give a
 * location, the professional may ask the customer to confirm it in their app
 * (POST /api/bookings/:id/confirm-arrival). That is the exception, so it is offered only where the
 * server would accept it — a professional holds the job and it has not started (accepted /
 * assigned / en_route) — and only while it is still useful: arrival not yet recorded, and not
 * already confirmed for this booking in this session.
 */
const OFFER_STATUSES: ReadonlySet<string> = new Set(["accepted", "assigned", "en_route"]);

export function canOfferArrivalConfirmation(input: {
  /** The booking's status as the server sends it (any case). */
  backendStatus: string | null | undefined;
  /** A professional is on the booking (the customer payload's provider is present). */
  hasProfessional: boolean;
  /** `arrivedAt` from the customer payload; set once the server has recorded the arrival. */
  arrivedAt: string | null | undefined;
  /** The customer already confirmed for this booking in this session. */
  confirmedThisSession: boolean;
}): boolean {
  if (input.confirmedThisSession || input.arrivedAt) return false;
  if (!input.hasProfessional) return false;
  return OFFER_STATUSES.has((input.backendStatus ?? "").toLowerCase());
}

/** What the page remembers of a confirmation the server accepted. */
export type RememberedConfirmation = {
  /** The professional on the booking when the customer confirmed. */
  professionalId: string | null;
  /** Until when the server says the confirmation vouches (ISO), or null if it gave no end. */
  validUntil: string | null;
};

/**
 * Does a remembered confirmation still cover this booking as it is now?
 *
 * The server's confirmation vouches for one professional and for a limited time. If the job has
 * passed to someone else, or the time has run out, it no longer stands and the customer must be
 * able to confirm again.
 */
export function confirmationStillStands(
  remembered: RememberedConfirmation | undefined,
  current: { professionalId: string | null; now: number },
): boolean {
  if (!remembered) return false;
  if (remembered.professionalId !== current.professionalId) return false;
  if (!remembered.validUntil) return true;
  const until = Date.parse(remembered.validUntil);
  return !Number.isFinite(until) || current.now <= until;
}
