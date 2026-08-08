import prisma from "../../lib/prisma";

/** Resolve providerId from userId for partner-scoped tools. */
export async function resolveProviderId(userId: string): Promise<string | null> {
  const provider = await prisma.provider.findFirst({
    where: { userId },
    select: { id: true },
  });
  return provider?.id ?? null;
}

/** Verify customer owns a booking. */
export async function verifyBookingOwnership(userId: string, bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: { id: true },
  });
  return Boolean(booking);
}

/** Verify partner is assigned to booking. */
export async function verifyPartnerBookingAccess(providerId: string, bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, providerId },
    select: { id: true },
  });
  return Boolean(booking);
}

/** Verify booking access for tracking (customer, partner, or admin). */
export async function verifyBookingAccess(
  bookingId: string,
  actorId: string,
  actorRole: string,
  providerId?: string | null,
): Promise<boolean> {
  if (actorRole === "ADMIN" || actorRole === "SUPPORT") return true;
  if (actorRole === "PARTNER" && providerId) {
    return verifyPartnerBookingAccess(providerId, bookingId);
  }
  return verifyBookingOwnership(actorId, bookingId);
}
