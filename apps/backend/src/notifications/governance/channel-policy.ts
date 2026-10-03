import type { NotificationChannel } from "@prisma/client";

/**
 * Which channels one notification type may use, when its category alone is too blunt an answer.
 *
 * OPTIONAL traffic is push-only by default, and for most of it that is right: a promotion nobody
 * opened does not deserve an email. Payment recovery is the exception that proved the rule — the
 * first real observation skipped with NO_CHANNEL_TARGET because the customer had no registered
 * device, and customers who abandon a payment on the web are precisely the ones who never will.
 * Push-only meant the automation could not reach the people it exists for.
 *
 * Widening OPTIONAL platform-wide would have fixed payment recovery by changing every other
 * OPTIONAL notification too, so the exception is recorded per type instead. Anything absent from
 * this table keeps its category's behaviour exactly as before.
 *
 * What this deliberately does NOT do is change the category. Payment recovery stays OPTIONAL, which
 * is what keeps the daily cap, the workflow cooldown, quiet hours and the recipient's own
 * preference applying to it. Reclassifying it as TRANSACTIONAL would have granted email for free
 * and silently bought exemption from all four.
 */
const TYPE_CHANNEL_ORDER: Record<string, NotificationChannel[]> = {
  /**
   * Push first, email only as a fallback — a customer with a live device should get the in-app
   * nudge, not both. SMS is deliberately absent: it costs money per message, and an OPTIONAL nudge
   * is not worth a per-send charge.
   */
  "payment.recovery_nudge": ["PUSH", "EMAIL"],
  /**
   * The same order, and for the same measured reason: someone who abandoned a checkout on the web
   * is precisely the person least likely to have the app installed, so push alone could not reach
   * the audience this exists for. Push first so a customer with a live device gets one message
   * rather than two; SMS stays absent because an OPTIONAL nudge is not worth a per-send charge.
   */
  "checkout.recovery_nudge": ["PUSH", "EMAIL"],
  /**
   * Push first, then the inbox, then email — which reproduces exactly what the legacy job did.
   *
   * The order matters more than it looks. `pushAdapter` sends through `notificationService
   * .sendNotification`, which writes the inbox row *and* pushes the WebSocket envelope *and* hands
   * off to the device: one channel, three surfaces, exactly as the legacy handler produced them. So
   * a customer with a device gets push + inbox + realtime from the PUSH branch alone, and a customer
   * without one falls through to IN_APP and gets inbox + realtime.
   *
   * Putting IN_APP first — the first attempt at this — was technically valid and behaviourally
   * wrong. IN_APP is always eligible, so it always won, and PUSH became dead code: device-owning
   * customers silently lost their lock-screen notification. The router returns after the first
   * channel that succeeds, so "always eligible" and "listed first" together mean "the only one".
   *
   * Measured context for the fallbacks: of the nine customers currently holding a completed unrated
   * booking, none has an active device and all nine have an email address.
   */
  "booking.review_request": ["PUSH", "IN_APP", "EMAIL"],
  "partner.welcome": ["PUSH", "IN_APP", "EMAIL"],
  "partner.application_approved": ["PUSH", "IN_APP", "EMAIL"],
  "partner.onboarding_resume": ["PUSH", "IN_APP", "EMAIL"],
  "partner.kyc_reminder": ["PUSH", "IN_APP", "EMAIL"],
  "partner.training_reminder": ["PUSH", "IN_APP", "EMAIL"],
  /**
   * Morning Intelligence deliberately omits EMAIL.
   *
   * The other partner types list it as a last resort because they carry account-critical news that
   * must reach someone who has lost their device — an approval, a KYC block. A daily brief is not
   * that: it is useful in the app, beside the zones and windows it refers to, and an email arriving
   * every morning is a subscription nobody asked for. PUSH then IN_APP means a partner with a device
   * gets the lock-screen prompt and the inbox copy, and one without still finds the brief in-app.
   */
  "partner.morning_intelligence": ["PUSH", "IN_APP"],
  /**
   * Same reasoning as the morning brief, and one more: a surge reading is perishable. The source
   * recomputes every 120 s, so an email landing minutes later would describe a zone state that has
   * already moved. PUSH reaches a working partner now; IN_APP is where it belongs afterwards.
   */
  "partner.surge_alert": ["PUSH", "IN_APP"],
  "partner.kyc_expiring_d30": ["PUSH", "IN_APP", "EMAIL"],
  "partner.kyc_expiring_d7": ["PUSH", "IN_APP", "EMAIL"],
  "partner.kyc_expired": ["PUSH", "IN_APP", "EMAIL"],
  "partner.payout_failed": ["PUSH", "IN_APP", "EMAIL"],
  "partner.sos_acknowledged": ["PUSH", "IN_APP"],
  "partner.rating_coaching": ["PUSH", "IN_APP"],
  "partner.reengagement": ["PUSH", "IN_APP"],
  "partner.dispatch_stall": ["PUSH", "IN_APP"],
};

/**
 * The channels to try, in order, for a notification of this type.
 *
 * `categoryOrder` is what the category would have chosen; a type without its own entry gets it back
 * untouched, so adding this table changed nothing for anything already working.
 */
export function channelOrderFor(
  notificationType: string,
  categoryOrder: NotificationChannel[],
): NotificationChannel[] {
  return TYPE_CHANNEL_ORDER[notificationType] ?? categoryOrder;
}

/**
 * Whether a type's own policy permits a channel its category would not.
 *
 * Consulted only after an explicit recipient preference has been read, never before: this widens
 * what the platform is willing to offer, and must never overrule what the recipient asked for.
 */
export function typePermitsChannel(notificationType: string, channel: NotificationChannel): boolean {
  return TYPE_CHANNEL_ORDER[notificationType]?.includes(channel) ?? false;
}

/** Exposed so a test can assert the policy rather than restate it. */
export function typeChannelPolicy(notificationType: string): NotificationChannel[] | undefined {
  return TYPE_CHANNEL_ORDER[notificationType];
}
