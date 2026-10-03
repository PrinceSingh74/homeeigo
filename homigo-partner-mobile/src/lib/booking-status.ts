/**
 * ONE source of truth for booking statuses on the partner app.
 *
 * Mirrors the backend exactly — do not add values the server cannot send:
 *   - Prisma enum `BookingStatus` (apps/backend/prisma/schema.prisma)
 *   - Wire form: `bookingStatusApi()` in apps/backend/src/lib/format.ts, which LOWERCASES the enum
 *     (`IN_PROGRESS` → `"in_progress"`). Every booking payload the app reads carries that form.
 *   - List filters: `STATUS_MAP` in apps/backend/src/services/provider.service.ts (`myBookings`).
 *
 * "Arrived" is NOT a status. Arrival is the `arrivedAt` timestamp on an EN_ROUTE / ACCEPTED booking
 * (ADR-018); reading it as a status would make an arrived job look unknown.
 *
 * This module is intentionally import-free so it can be unit-tested without React Native.
 */

export const BOOKING_STATUS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  ASSIGNED: "ASSIGNED",
  EN_ROUTE: "EN_ROUTE",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED_BY_USER: "CANCELLED_BY_USER",
  CANCELLED_BY_PROVIDER: "CANCELLED_BY_PROVIDER",
  REJECTED: "REJECTED",
} as const;

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

const ALL_STATUSES = new Set<string>(Object.values(BOOKING_STATUS));

/**
 * The `status` query values `GET /api/providers/me/bookings` understands (backend STATUS_MAP).
 *
 * Pick by MEANING, not by the word:
 *  - `ACTIVE_WORK` ("active")  = ACCEPTED | ASSIGNED | EN_ROUTE | IN_PROGRESS — everything the
 *    partner is committed to. This is what "Active", "Today's schedule" and "Upcoming jobs" mean.
 *  - `NOT_STARTED` ("accepted") = ACCEPTED | ASSIGNED | EN_ROUTE only. It EXCLUDES IN_PROGRESS;
 *    using it for "active work" is exactly the defect that made started jobs vanish from the
 *    Active tab (and stopped GPS publishing for them).
 *  - `OFFERS` ("pending") is special-cased server-side: only LIVE dispatch offers (window open,
 *    job still DISPATCHED, booking still PENDING), each carrying `offer: { dispatchedAt, expiresAt }`.
 * A comma-separated list is NOT supported (the server 500s on it).
 */
export const BOOKING_LIST_FILTER = {
  OFFERS: "pending",
  ACTIVE_WORK: "active",
  NOT_STARTED: "accepted",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  ALL: "all",
} as const;

export type BookingListFilter = (typeof BOOKING_LIST_FILTER)[keyof typeof BOOKING_LIST_FILTER];

/** Committed, unfinished work — identical to the backend's `ACCEPTED_TAB_STATUSES` / `active`. */
export const ACTIVE_WORK_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUS.ACCEPTED,
  BOOKING_STATUS.ASSIGNED,
  BOOKING_STATUS.EN_ROUTE,
  BOOKING_STATUS.IN_PROGRESS,
];

export const CANCELLED_STATUSES: readonly BookingStatus[] = [
  BOOKING_STATUS.CANCELLED_BY_USER,
  BOOKING_STATUS.CANCELLED_BY_PROVIDER,
  BOOKING_STATUS.REJECTED,
];

/**
 * Wire (`"in_progress"`), enum (`"IN_PROGRESS"`) or a hyphenated variant → the enum value.
 * Anything the backend cannot send returns `null` rather than being guessed into a known state.
 */
export function normalizeBookingStatus(raw: unknown): BookingStatus | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase().replace(/-/g, "_");
  return ALL_STATUSES.has(upper) ? (upper as BookingStatus) : null;
}

export function isActiveWorkStatus(raw: unknown): boolean {
  const s = normalizeBookingStatus(raw);
  return s != null && ACTIVE_WORK_STATUSES.includes(s);
}

export function isPendingStatus(raw: unknown): boolean {
  return normalizeBookingStatus(raw) === BOOKING_STATUS.PENDING;
}

export function isCancelledStatus(raw: unknown): boolean {
  const s = normalizeBookingStatus(raw);
  return s != null && CANCELLED_STATUSES.includes(s);
}

export function isTerminalStatus(raw: unknown): boolean {
  const s = normalizeBookingStatus(raw);
  return s === BOOKING_STATUS.COMPLETED || (s != null && CANCELLED_STATUSES.includes(s));
}

/**
 * Lifecycle progress used to pick the most-advanced copy of a booking across list caches.
 * Unknown statuses rank 0 so they never win over a real one.
 */
export function bookingStatusRank(raw: unknown): number {
  switch (normalizeBookingStatus(raw)) {
    case BOOKING_STATUS.COMPLETED:
      return 60;
    case BOOKING_STATUS.IN_PROGRESS:
      return 50;
    case BOOKING_STATUS.EN_ROUTE:
      return 40;
    case BOOKING_STATUS.ACCEPTED:
    case BOOKING_STATUS.ASSIGNED:
      return 30;
    case BOOKING_STATUS.PENDING:
      return 10;
    default:
      return 0;
  }
}

const LABELS: Record<BookingStatus, string> = {
  PENDING: "New request",
  ACCEPTED: "Accepted",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED_BY_USER: "Cancelled by customer",
  CANCELLED_BY_PROVIDER: "Cancelled by you",
  REJECTED: "Declined",
};

/**
 * Human label. `arrivedAt` refines EN_ROUTE/ACCEPTED to "Arrived" because arrival is a timestamp,
 * not a status. An unrecognised status is shown verbatim rather than mislabelled.
 */
export function bookingStatusLabel(raw: unknown, arrivedAt?: string | null): string {
  const s = normalizeBookingStatus(raw);
  if (!s) return typeof raw === "string" && raw ? raw.replace(/_/g, " ") : "Unknown";
  if (arrivedAt && (s === BOOKING_STATUS.EN_ROUTE || s === BOOKING_STATUS.ACCEPTED || s === BOOKING_STATUS.ASSIGNED)) {
    return "Arrived";
  }
  return LABELS[s];
}
