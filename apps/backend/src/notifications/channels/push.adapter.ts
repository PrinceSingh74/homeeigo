import { notificationService } from "../../services/notification.service";
import type { NotificationChannelAdapter } from "../types";

/**
 * Push, over the existing notification service.
 *
 * Deliberately a wrapper, not a reimplementation: `notificationService.sendNotification` already
 * writes the in-app row, pushes the live WebSocket envelope and hands off to `pushDeliveryService`
 * for device delivery. Rebuilding any of that would give HOMEEIGO two push paths that drift.
 *
 * It reports QUEUED rather than SENT. The underlying device dispatch is fire-and-forget, so all
 * that is truthfully known at this point is that the notification was accepted — claiming SENT
 * would be asserting something the provider has not confirmed.
 */
export const pushAdapter: NotificationChannelAdapter = {
  channel: "PUSH",

  canSend: (recipient) => recipient.targets.some((t) => t.channel === "PUSH"),

  async send(recipient, message, ctx) {
    try {
      const id = await notificationService.sendNotification(recipient.userId, ctx.notificationType, {
        title: message.title ?? "HOMEEIGO",
        body: message.body,
        data: { notificationType: ctx.notificationType, traceId: ctx.traceId },
      });
      return { status: "QUEUED", providerRef: id };
    } catch (err) {
      return {
        status: "FAILED",
        reasonCode: err instanceof Error ? err.message.slice(0, 120) : "push_failed",
      };
    }
  },
};
