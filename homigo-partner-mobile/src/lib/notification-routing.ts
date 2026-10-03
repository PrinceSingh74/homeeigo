/**
 * Where a tapped notification should land.
 *
 * Deliberately free of any React Native / Expo import so it stays pure, trivially testable in a
 * plain Node context, and reusable from anywhere. Routing is derived ONLY from the notification's
 * own data payload, which the server builds from authoritative assignment state — never from
 * anything the device chooses. An unrecognised payload falls back to the requests list rather
 * than guessing a job id.
 */
export function resolveNotificationHref(data: Record<string, unknown> | undefined): string {
  const type = typeof data?.type === "string" ? data.type : undefined;
  const bookingId = typeof data?.bookingId === "string" ? data.bookingId : undefined;
  const referenceId = typeof data?.referenceId === "string" ? data.referenceId : undefined;
  const jobId = bookingId ?? referenceId;

  if (type === "BOOKING_REQUEST") return "/(tabs)/requests";
  if (jobId && (type === "BOOKING_ACCEPTED" || type === "BOOKING_STARTED" || type === "BOOKING_CANCELLED")) {
    return "/(tabs)";
  }
  if (type === "PAYMENT_RECEIVED") return "/hq/earnings-hq";
  if (type === "RATING_RECEIVED") return "/hq/performance-reviews";
  return "/(tabs)/requests";
}
