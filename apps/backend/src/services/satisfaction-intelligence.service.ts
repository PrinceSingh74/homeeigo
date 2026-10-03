import prisma from "../lib/prisma";

/**
 * Phase 7, Step 7C — satisfaction intelligence.
 *
 * Every field here is read from a real row: a star rating, a completed-booking count, a support
 * ticket outcome. There is no sentiment model, no LLM call and no derived "happiness score" —
 * discovery for this phase found no licensed sentiment provider and no labelled training data, and
 * inventing either would mean reporting an emotion nobody measured. What this module computes is
 * arithmetic over facts that already exist, and `UNKNOWN` is a legitimate answer wherever a fact
 * does not.
 */

export type SatisfactionSignal = {
  bookingId: string;
  customerId: string;
  serviceId: string;
  /** Null when the booking has no rating yet — not assumed neutral, not assumed absent forever. */
  rating: number | null;
  /** How many times this customer has completed this exact service, this booking included. */
  completedCount: number;
  isRepeatCustomer: boolean;
  /** Support tickets raised against this specific booking. */
  supportTicketCount: number;
  supportTicketsUnresolved: number;
  /**
   * Whether a follow-up is worth sending, from facts alone: rated 3+ stars, or a repeat customer
   * with no open support issue. A 1-2 star rating or an unresolved ticket suppresses it — chasing a
   * customer for more contact right after either would be tone-deaf, not intelligent.
   */
  followupEligible: boolean;
  generatedAt: Date;
};

export async function satisfactionSignalFor(bookingId: string): Promise<SatisfactionSignal | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, userId: true, serviceId: true, status: true },
  });
  if (!booking) return null;

  const [rating, completedCount, tickets] = await Promise.all([
    prisma.rating.findUnique({
      where: { bookingId },
      select: { stars: true },
    }),
    prisma.booking.count({
      where: { userId: booking.userId, serviceId: booking.serviceId, status: "COMPLETED" },
    }),
    prisma.supportTicket.findMany({
      where: { bookingId },
      select: { status: true },
    }),
  ]);

  const supportTicketCount = tickets.length;
  const supportTicketsUnresolved = tickets.filter(
    (t) => t.status !== "RESOLVED" && t.status !== "CLOSED",
  ).length;

  const isRepeatCustomer = completedCount > 1;
  const stars = rating?.stars ?? null;

  const followupEligible =
    supportTicketsUnresolved === 0 &&
    (stars === null ? isRepeatCustomer : stars >= 3);

  return {
    bookingId: booking.id,
    customerId: booking.userId,
    serviceId: booking.serviceId,
    rating: stars,
    completedCount,
    isRepeatCustomer,
    supportTicketCount,
    supportTicketsUnresolved,
    followupEligible,
    generatedAt: new Date(),
  };
}
