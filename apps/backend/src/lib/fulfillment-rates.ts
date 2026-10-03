/**
 * One definition of completion and cancellation.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `geo-intelligence.executiveKpis` computed completion and cancellation as
 * `finished ? completed / finished : 0`, where `finished = completed + cancelled`. The ratio is
 * right; the fallback is not. A platform, or a city, with no finished bookings has an UNKNOWN
 * completion rate — reporting 0% asserts that nothing that started ever finished, which is a much
 * stronger claim than the data supports and reads as catastrophic failure on a dashboard.
 *
 * `hyperlocal-coverage` published its own `completionRate`, `cancellationRate` and `fulfillmentRate`
 * from `seeded()` — numbers with no connection to any booking — on a page customers read.
 *
 * Both now resolve here, so a city page and an executive dashboard cannot disagree about what
 * "completion rate" means, and neither can invent one.
 */
import { BookingStatus } from "@prisma/client";

/**
 * Bookings that ended in a cancellation. REJECTED is excluded deliberately: a provider declining an
 * offer is a dispatch outcome, not a booking the customer cancelled, and folding it in here would
 * double-count it against the acceptance rate that already measures it.
 */
export const CANCELLED_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CANCELLED_BY_USER,
  BookingStatus.CANCELLED_BY_PROVIDER,
];

/** Bookings that reached a terminal outcome — the only ones a rate can be computed over. */
export function finishedBookings(completed: number, cancelled: number): number {
  return completed + cancelled;
}

/**
 * Completed over finished, as a percentage to one decimal — or `null` when nothing has finished.
 *
 * `null` means UNMEASURED and must never be rendered as a number. It is not 0 (nothing finished
 * successfully) and not 100 (everything did).
 */
export function completionRatePct(completed: number, cancelled: number): number | null {
  return ratio(completed, finishedBookings(completed, cancelled));
}

/** Cancelled over finished. The complement of the above, from the same denominator. */
export function cancellationRatePct(completed: number, cancelled: number): number | null {
  return ratio(cancelled, finishedBookings(completed, cancelled));
}

function ratio(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return null;
  if (whole <= 0) return null;
  if (part < 0 || part > whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}
