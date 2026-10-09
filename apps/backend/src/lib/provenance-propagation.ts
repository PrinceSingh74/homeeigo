import type { PrismaClient } from "@prisma/client";
import { analyticsSqlPredicate } from "./analytics-scope";

/**
 * Carries a non-business label from a parent to the children created before the parent was
 * labelled — the same parent → child rule `bookingService.createBooking` applies at creation.
 *
 * Creation-time stamping covers every booking and analytics row written after its customer was
 * labelled. It cannot cover the ones written before: `provenance-report --apply` labels a customer
 * by evidence found later, and without this their bookings stayed NULL — UNKNOWN, counted as
 * business — while the customer who made them was excluded. The analytics rows attached to those
 * bookings (stamped from the booking at projection time) kept NULL the same way.
 *
 * Only NULL children are written, so a declared label (REAL included) is never overwritten and a
 * re-run changes nothing. A business parent writes nothing: NULL stays NULL.
 */
export async function propagateNonBusinessOrigins(db: Pick<PrismaClient, "$executeRawUnsafe">): Promise<{
  bookings: number;
  analyticsEventsFromBooking: number;
  analyticsEventsFromActor: number;
}> {
  const nonBusiness = (alias: string) => analyticsSqlPredicate(alias, "NON_BUSINESS");
  // Booking first: the analytics step below reads the label this writes.
  const bookings = await db.$executeRawUnsafe(
    `UPDATE bookings b SET data_origin = u.data_origin
       FROM users u
      WHERE b.user_id = u.id AND b.data_origin IS NULL AND ${nonBusiness("u")}`,
  );
  // A booking-attached event takes the booking's label (the projection's own precedence).
  const analyticsEventsFromBooking = await db.$executeRawUnsafe(
    `UPDATE analytics_events ae SET data_origin = b.data_origin
       FROM bookings b
      WHERE ae.booking_id = b.id AND ae.data_origin IS NULL AND ${nonBusiness("b")}`,
  );
  // Only events with no booking fall back to the actor, again matching the write-time precedence.
  const analyticsEventsFromActor = await db.$executeRawUnsafe(
    `UPDATE analytics_events ae SET data_origin = u.data_origin
       FROM users u
      WHERE ae.actor_user_id = u.id AND ae.booking_id IS NULL AND ae.data_origin IS NULL AND ${nonBusiness("u")}`,
  );
  return { bookings, analyticsEventsFromBooking, analyticsEventsFromActor };
}
