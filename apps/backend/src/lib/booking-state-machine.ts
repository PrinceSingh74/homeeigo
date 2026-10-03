import { BookingStatus } from "@prisma/client";

/**
 * The booking lifecycle — ONE table, read by every writer of `bookings.status`.
 *
 * Status is the *work* lifecycle only. Money has its own axis (`bookings.payment_status`) and a
 * payment event never moves this one: payment success used to write ACCEPTED/PENDING directly,
 * which resurrected cancelled bookings and "accepted" direct-provider jobs nobody had accepted.
 *
 *   PENDING      created; unclaimed (or tentatively held by a direct/offered provider)
 *   ACCEPTED     a partner accepted (bookingService.accept — the only writer)
 *   ASSIGNED     an admin assigned a partner (adminBookingOperations.reassignProvider)
 *   EN_ROUTE     partner travelling (markEnRoute / first GPS ping)
 *   IN_PROGRESS  customer PIN verified, work started (bookingService.start)
 *   COMPLETED    work done (bookingService.complete) — terminal
 *   CANCELLED_*  bookingService.cancel — terminal
 *   REJECTED     legacy terminal value; no current writer
 *   EXPIRED      payment not settled within PAYMENT_PENDING_TTL; capacity released — terminal
 *   *_NO_SHOW    nobody was served; who failed to appear decides the money — terminal
 *
 * Arrival is a fact on the row (`arrivedAt`), not a status (ADR-018).
 */

export const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
] as const;

/** Held by a partner — the slot trigger and capacity count these as the partner's work. */
export const CLAIMED_BOOKING_STATUSES = [
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
  BookingStatus.IN_PROGRESS,
] as const;

export const CANCELLED_BOOKING_STATUSES = [
  BookingStatus.CANCELLED_BY_USER,
  BookingStatus.CANCELLED_BY_PROVIDER,
] as const;

export const TERMINAL_BOOKING_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.REJECTED,
  // The payment window closed and the capacity was released; nothing resumes from here.
  BookingStatus.EXPIRED,
  // Nobody was served. Both are settled outcomes with their own money (lib/no-show-policy).
  BookingStatus.CUSTOMER_NO_SHOW,
  BookingStatus.PROVIDER_NO_SHOW,
  ...CANCELLED_BOOKING_STATUSES,
] as const;

/** Cancellable by customer, assigned partner or admin (IN_PROGRESS carries the 50% policy tier). */
export const CANCELLABLE_BOOKING_STATUSES = ACTIVE_BOOKING_STATUSES;

/** An admin may move the job to another partner until work has started. */
export const REASSIGNABLE_BOOKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
] as const;

/**
 * Statuses whose appointment can still be moved. Work that has started, finished or been cancelled
 * has no future slot to move: rescheduling it would rewrite history and reserve a window for a job
 * that is already over. Same set as reassignment today, kept separate because the two questions are
 * different ("who does it" vs "when") and are expected to diverge.
 */
export const RESCHEDULABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.ASSIGNED,
  BookingStatus.EN_ROUTE,
];

export function isReschedulableBookingStatus(status: BookingStatus): boolean {
  return RESCHEDULABLE_BOOKING_STATUSES.includes(status);
}

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: [
    BookingStatus.ACCEPTED,
    BookingStatus.ASSIGNED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    // PAYMENT_PENDING_TTL: the window closed with nothing captured (owner decision 2026-09-23).
    // Only from PENDING — a booking a partner already accepted is not expired by the sweep.
    BookingStatus.EXPIRED,
  ],
  ACCEPTED: [
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    // §52/§53. Reachable from every state in which the appointment is still ahead of the work:
    // the partner can fail to appear from any of them, and the customer can fail to answer the
    // door once the partner has arrived (which `evaluateCustomerNoShow` requires evidence of).
    BookingStatus.CUSTOMER_NO_SHOW,
    BookingStatus.PROVIDER_NO_SHOW,
  ],
  ASSIGNED: [
    BookingStatus.ASSIGNED,
    BookingStatus.EN_ROUTE,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    BookingStatus.CUSTOMER_NO_SHOW,
    BookingStatus.PROVIDER_NO_SHOW,
  ],
  EN_ROUTE: [
    BookingStatus.ASSIGNED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
    BookingStatus.CUSTOMER_NO_SHOW,
    BookingStatus.PROVIDER_NO_SHOW,
  ],
  IN_PROGRESS: [
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED_BY_USER,
    BookingStatus.CANCELLED_BY_PROVIDER,
  ],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED_BY_USER: [],
  CANCELLED_BY_PROVIDER: [],
  /**
   * Terminal. An expired booking is not resumed: its capacity was released and the slot may already
   * belong to someone else, so "un-expiring" it would risk double-booking a partner. A customer who
   * still wants the service places a new booking.
   */
  EXPIRED: [],
  /**
   * Terminal, and deliberately NOT convertible into one another. §53 exists because a partner's
   * absence must never be recorded as the customer's: a transition between them would let one
   * become the other with a single update, which is exactly the mistake to make impossible.
   */
  CUSTOMER_NO_SHOW: [],
  PROVIDER_NO_SHOW: [],
};

const has = (set: readonly BookingStatus[], s: BookingStatus | string): boolean =>
  (set as readonly string[]).includes(s);

export function isBookingTransitionAllowed(current: BookingStatus, next: BookingStatus): boolean {
  return has(TRANSITIONS[current] ?? [], next);
}

/** Every status `next` may be reached from — the `where: { status: { in } }` of a guarded write. */
export function predecessorsOf(next: BookingStatus): BookingStatus[] {
  return (Object.keys(TRANSITIONS) as BookingStatus[]).filter((s) => has(TRANSITIONS[s], next));
}

export const isTerminalBookingStatus = (s: BookingStatus | string) => has(TERMINAL_BOOKING_STATUSES, s);
export const isCancelledBookingStatus = (s: BookingStatus | string) => has(CANCELLED_BOOKING_STATUSES, s);
export const isClaimedBookingStatus = (s: BookingStatus | string) => has(CLAIMED_BOOKING_STATUSES, s);
export const isReassignableBookingStatus = (s: BookingStatus | string) => has(REASSIGNABLE_BOOKING_STATUSES, s);

/**
 * What a captured payment may do to a booking in `status`.
 *
 *   APPLY   record the money; lifecycle untouched (dispatch follows if the job is unclaimed)
 *   REFUND  the booking can no longer be served (cancelled/rejected) — record the money,
 *           keep the booking terminal, and return it in full. Never revive.
 *
 * COMPLETED is APPLY: an admin can let an unpaid job start (audited override), and its later
 * payment is simply owed money arriving.
 *
 * EXPIRED is REFUND for the same reason cancellations are: PAYMENT_PENDING_TTL released the slot, so
 * the job can no longer be served and a capture arriving afterwards is money owed back, never a
 * confirmation. `reconcileFromWebhook` refuses such a capture explicitly; this table is the second
 * place that says so, so a future writer cannot reach a different conclusion.
 */
export function paymentDispositionFor(status: BookingStatus | string): "APPLY" | "REFUND" {
  return status === BookingStatus.REJECTED ||
    status === BookingStatus.EXPIRED ||
    // §53: the partner did not appear, so nothing is owed and a capture arriving now goes back.
    status === BookingStatus.PROVIDER_NO_SHOW ||
    isCancelledBookingStatus(status)
    ? "REFUND"
    : "APPLY";
  /**
   * CUSTOMER_NO_SHOW is deliberately APPLY, not REFUND: the partner travelled and waited, so a
   * capped fee IS owed (lib/no-show-policy). The money is recorded, and the no-show settlement
   * returns whatever exceeds the fee — refunding the whole capture here would hand back money the
   * policy says the customer forfeited.
   */
}

/** Customer checkout may open for these (an unpaid admin-overridden COMPLETED job may still settle). */
export const isPayableBookingStatus = (s: BookingStatus | string) => paymentDispositionFor(s) === "APPLY";
