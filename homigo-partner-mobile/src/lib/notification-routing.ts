/**
 * Where a tapped notification should land.
 *
 * Deliberately free of any React Native / Expo import so it stays pure, trivially testable in a
 * plain Node context, and reusable from anywhere. Routing is derived ONLY from the notification's
 * own payload, which the server builds from authoritative assignment state — never from anything
 * the device chooses.
 *
 * Works for both shapes the app sees:
 *  - a push payload's `data` (may carry `bookingId`, `type`, `referenceId`);
 *  - an in-app row from `GET /api/notifications` — pass the row itself: it carries `type` and
 *    `referenceId` (there is no `bookingId` or `data` key on a row).
 *
 * The destination follows the notification's SUBJECT, so a push and the in-app row of the same
 * notification land on the same screen: a payment opens earnings and a rating opens reviews even
 * though their push `data` also names the booking they came from.
 *
 * Otherwise a notification that names a booking opens that job (`/job/<id>` — the job screen handles
 * every stage, including an offer and "no longer assigned to you"). `referenceId` is a booking id
 * when the payload says so (`referenceType: "booking"`) or, when it says nothing, on booking
 * notifications only: the server also stores document ids and withdrawal ids in it.
 */
type NotificationPayload = Record<string, unknown> | null | undefined;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Notifications whose subject is not the job itself, and the screen that subject lives on. */
const SUBJECT_SCREENS: Record<string, string> = {
  PAYMENT_RECEIVED: "/hq/earnings-hq",
  RATING_RECEIVED: "/hq/performance-reviews",
};

const subjectScreen = (type: string | null): string | null =>
  type && Object.prototype.hasOwnProperty.call(SUBJECT_SCREENS, type) ? (SUBJECT_SCREENS[type] ?? null) : null;

/** The job a notification should open, or null when it is not about a job. */
export function notificationBookingId(data: NotificationPayload): string | null {
  const type = text(data?.type);
  if (subjectScreen(type)) return null;
  const explicit = text(data?.bookingId);
  if (explicit) return explicit;
  const referenceType = text(data?.referenceType);
  if (referenceType) return referenceType.toLowerCase() === "booking" ? text(data?.referenceId) : null;
  return type && /^booking/i.test(type) ? text(data?.referenceId) : null;
}

export function resolveNotificationHref(data: NotificationPayload): string {
  const subject = subjectScreen(text(data?.type));
  if (subject) return subject;

  const bookingId = notificationBookingId(data);
  if (bookingId) return `/job/${encodeURIComponent(bookingId)}`;
  return "/(tabs)/requests";
}
