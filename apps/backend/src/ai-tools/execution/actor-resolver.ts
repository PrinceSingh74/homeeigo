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

/**
 * Bind client-supplied AI context IDs to the authenticated actor.
 * PARTNER/CUSTOMER cannot attach another party's partnerId, customerId, or bookingId.
 * ADMIN/SUPPORT keep the requested IDs (console investigation).
 */
export async function bindAiContextToActor<
  T extends {
    partnerId?: string;
    customerId?: string;
    userId?: string;
    bookingId?: string;
  },
>(actor: { actorId: string; actorRole: string }, context?: T): Promise<T | undefined> {
  if (!context) return context;
  const next = { ...context };
  if (actor.actorRole === "PARTNER") {
    const providerId = await resolveProviderId(actor.actorId);
    next.partnerId = providerId ?? undefined;
    next.userId = actor.actorId;
    next.customerId = undefined;
    if (next.bookingId && providerId) {
      const ok = await verifyPartnerBookingAccess(providerId, next.bookingId);
      if (!ok) next.bookingId = undefined;
    } else if (next.bookingId && !providerId) {
      next.bookingId = undefined;
    }
    return next;
  }
  if (actor.actorRole === "CUSTOMER") {
    next.customerId = actor.actorId;
    next.userId = actor.actorId;
    next.partnerId = undefined;
    if (next.bookingId) {
      const ok = await verifyBookingOwnership(actor.actorId, next.bookingId);
      if (!ok) next.bookingId = undefined;
    }
    return next;
  }
  return next;
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
