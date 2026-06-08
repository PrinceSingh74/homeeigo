/** Derive who may cancel a booking — never trust client-supplied cancelledBy. */
export function resolveBookingCancelActor(
  actorUserId: string,
  actorProviderId: string | undefined,
  booking: { userId: string; providerId: string | null },
): { allowed: true; cancelledBy: "user" | "provider" } | { allowed: false } {
  if (booking.userId === actorUserId) {
    return { allowed: true, cancelledBy: "user" };
  }
  if (actorProviderId && booking.providerId === actorProviderId) {
    return { allowed: true, cancelledBy: "provider" };
  }
  return { allowed: false };
}
