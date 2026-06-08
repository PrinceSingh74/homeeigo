import prisma from "./prisma";

/** Returns true when the authenticated user is the customer or assigned provider for a booking. */
export async function canAccessBookingWs(
  userId: string,
  bookingId: string,
  userType?: string,
): Promise<boolean> {
  if (userType === "admin" || userType === "ADMIN") return true;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      userId: true,
      provider: { select: { userId: true } },
    },
  });
  if (!booking) return false;
  if (booking.userId === userId) return true;
  if (booking.provider?.userId === userId) return true;
  return false;
}
