import { notificationService } from "../../services/notification.service";
import type { NotificationChannelAdapter } from "../types";

/**
 * The in-app inbox, as a channel the router can name.
 *
 * This surface always existed — every call to `notificationService.sendNotification` writes a
 * Notification row whether or not the recipient owns a device — but the router had no vocabulary for
 * it. Push was the only thing resembling "in the app", and push requires a device token, so a
 * customer without one resolved to no channel at all. Of the nine customers currently holding a
 * completed, unrated booking, none has an active device: the review request reached nobody.
 *
 * Kept strictly separate from PUSH. A row in someone's inbox and a notification on their lock screen
 * are different promises, and labelling the first as the second would make the shadow evidence lie
 * about which one an automation intended.
 *
 * Writes nothing of its own: `createInAppOnly` delegates to the single
 * `prisma.notification.create` the whole platform shares, so this adapter is a boundary rather than
 * a second notification store.
 */
export const inAppAdapter: NotificationChannelAdapter = {
  channel: "IN_APP",

  /**
   * Always available for a resolved recipient.
   *
   * There is no token to expire and no address to be wrong — the inbox belongs to the account. The
   * recipient resolver has already established the person exists, and that is the whole eligibility
   * test.
   *
   * Because it never declines, where this channel sits in a policy decides whether anything after it
   * is reachable at all: the router returns on the first channel that succeeds. Listing IN_APP ahead
   * of PUSH makes PUSH unreachable, which is how review requests briefly stopped reaching anyone's
   * lock screen. It belongs after every channel that can genuinely be unavailable.
   */
  canSend: (recipient) => recipient.targets.some((t) => t.channel === "IN_APP"),

  async send(recipient, message, ctx) {
    try {
      const id = await notificationService.createInAppOnly(recipient.userId, ctx.notificationType, {
        title: message.title ?? "HOMEEIGO",
        body: message.body,
        data: { notificationType: ctx.notificationType, traceId: ctx.traceId },
      });
      /**
       * SENT, not QUEUED — and the distinction is real rather than pedantic.
       *
       * Push reports QUEUED because the device hand-off is fire-and-forget and nothing has been
       * confirmed. Here the row is committed before this returns: the notification is in the
       * recipient's inbox and will be there when they next open the app.
       */
      return { status: "SENT", providerRef: id };
    } catch (err) {
      return {
        status: "FAILED",
        reasonCode: err instanceof Error ? err.message.slice(0, 120) : "in_app_failed",
      };
    }
  },
};
