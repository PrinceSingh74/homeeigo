import prisma from "../lib/prisma";
import { isRetryablePrismaError } from "../lib/prisma-errors";
import { createWsEnvelope, pushToUser } from "./notification-hub";
import { pushDeliveryService } from "./push-delivery.service";
import { logger } from "../lib/logger";
import { recordNotificationFailed } from "../lib/notification-metrics";

/**
 * Notification kinds emitted by services like booking-live and earnings-live.
 * Kept as a string-union (vs. enum) so it can also be passed transparently to
 * the existing `createForUser({ type })` API, which already stores arbitrary
 * type strings in the DB.
 */
export type NotificationKind =
  | "BOOKING_REQUEST"
  | "BOOKING_ACCEPTED"
  | "BOOKING_REJECTED"
  | "BOOKING_CANCELLED"
  | "BOOKING_STARTED"
  | "BOOKING_COMPLETED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED"
  | "RATING_RECEIVED"
  | "MESSAGE"
  | "PROMOTION"
  | "SYSTEM";

export const NotificationType = {
  BOOKING_REQUEST: "BOOKING_REQUEST",
  BOOKING_ACCEPTED: "BOOKING_ACCEPTED",
  BOOKING_REJECTED: "BOOKING_REJECTED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_STARTED: "BOOKING_STARTED",
  BOOKING_COMPLETED: "BOOKING_COMPLETED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  RATING_RECEIVED: "RATING_RECEIVED",
  MESSAGE: "MESSAGE",
  PROMOTION: "PROMOTION",
  SYSTEM: "SYSTEM",
} as const satisfies Record<NotificationKind, NotificationKind>;

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  sound?: string;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  data?: Record<string, unknown>;
  /** Optional reference id (e.g. bookingId) for cross-table joins. */
  referenceId?: string;
  referenceType?: string;
}

/**
 * Bounded pool-aware insert. P2024 retries use exponential backoff (not tight loops) so
 * retries do not amplify connection pressure under connection_limit=8 soak load.
 */
async function createNotificationRow(
  data: Parameters<typeof prisma.notification.create>[0]["data"],
) {
  const MAX_ATTEMPTS = 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.notification.create({ data });
    } catch (err) {
      lastErr = err;
      if (isRetryablePrismaError(err) && attempt < MAX_ATTEMPTS - 1) {
        // 80ms, 160ms, 320ms — leave room for other transactions to release slots
        await new Promise((r) => setTimeout(r, 80 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export class NotificationService {
  async createForUser(input: {
    userId: string;
    type: string;
    title: string;
    message: string;
    referenceId?: string;
    referenceType?: string;
    imageUrl?: string;
    priority?: string;
  }) {
    const n = await createNotificationRow({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        imageUrl: input.imageUrl,
        priority: input.priority ?? "normal",
      });
    pushToUser(
      input.userId,
      createWsEnvelope(
        "notification.created",
        {
          id: n.id,
          title: input.title,
          message: input.message,
          notificationType: input.type,
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          priority: input.priority ?? "normal",
          isRead: n.isRead,
          createdAt: n.createdAt.toISOString(),
        },
        n.id,
      ),
    );
    void pushDeliveryService
      .sendToUser(input.userId, {
        title: input.title,
        body: input.message,
        notificationId: n.id,
        data: {
          referenceId: input.referenceId,
          type: input.type,
        },
      })
      .catch(() => undefined);
    return n;
  }

  /**
   * Notify about something that has ALREADY happened, without letting the telling fail the doing.
   *
   * ── The defect this exists to remove ─────────────────────────────────────────
   *
   * Three money paths did `await notificationService.createForUser(...)` immediately after their
   * transaction committed, with no catch:
   *
   *   payment.service.ts   — payment SUCCESS, ledger posted, `payment_success_total` incremented
   *   wallet.service.ts    — top-up settled via webhook
   *   wallet.service.ts    — top-up settled via customer verify
   *
   * A transient failure in `notification.create` (P2024 pool exhaustion is a documented mode in
   * this codebase) therefore turned a completed payment into a 500. That alone would be bad; what
   * made it permanent is the retry path. Re-verifying short-circuits on
   * `status === SUCCESS && same razorpayPaymentId`, and re-reconciling returns on `alreadySettled`
   * — so the second attempt never reaches the notification at all. The customer's money moved, the
   * customer was told it failed, and the notification (plus, in the payment case, the receipt and
   * invoice PDF queued on the lines below it) was lost for good.
   *
   * ── Why not just `.catch(() => undefined)` ───────────────────────────────────
   *
   * Because that is the opposite failure: a notification that silently never arrives, with nothing
   * anywhere to say so. `partner-referral.service.ts` does exactly that today. This keeps the
   * non-blocking behaviour and makes the failure visible — a log line naming the recipient and the
   * type, and `notification_failed_total{type,reason}`, which already has a counter and can carry
   * an alert.
   *
   * Use this after a committed operation. Use `createForUser` when the caller genuinely wants the
   * failure (a tool handler that must report it, a job that should retry).
   */
  async createForUserDetached(
    input: Parameters<NotificationService["createForUser"]>[0],
    context?: Record<string, unknown>,
  ): Promise<{ delivered: boolean }> {
    try {
      await this.createForUser(input);
      return { delivered: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      recordNotificationFailed(input.type, "create_failed");
      logger.error("notification_create_failed", {
        category: "APPLICATION",
        notificationType: input.type,
        userId: input.userId,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        reason,
        ...context,
      });
      return { delivered: false };
    }
  }

  async list(userId: string, opts: { page: number; limit: number; type?: string; unreadOnly?: boolean }) {
    const where: Record<string, unknown> = { userId };
    if (opts.type && opts.type !== "all") where.type = { contains: opts.type };
    if (opts.unreadOnly) where.isRead = false;

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        referenceId: n.referenceId,
        isRead: n.isRead,
        imageUrl: n.imageUrl,
        createdAt: n.createdAt,
      })),
      total,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Mark EVERY unread notification read in one statement — clients must not
   *  loop per-id (a page-limited loop leaves older unread rows keeping the
   *  badge lit forever). */
  async markAllRead(userId: string) {
    const res = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return res.count;
  }

  async delete(userId: string, id: string) {
    await prisma.notification.deleteMany({ where: { id, userId } });
  }

  /**
   * Unified "rich" notification API used by booking-live and earnings-live.
   *
   * Internally maps payload → existing schema:
   *   - `payload.body`            → Notification.body (was added in Part 6A)
   *   - `payload.body` (fallback) → Notification.message (legacy compat)
   *   - actions / data            → Notification.metadata (JSON)
   *   - referenceId               → Notification.referenceId
   *
   * Emits via the same realtime envelope as `createForUser` so existing
   * frontend subscribers keep working unchanged.
   */
  /**
   * The in-app inbox on its own: the persistent row and the live envelope, and no device dispatch.
   *
   * `sendNotification` does three things at once — writes the row, pushes the WebSocket envelope and
   * hands off to the device — which is fine for a caller that wants "tell this person", but it left
   * the notification router unable to distinguish two genuinely different surfaces. A customer with
   * no registered device still has an inbox; the router had no way to say so, so it resolved them to
   * no channel at all and the row was never written.
   *
   * Deliberately delegates rather than reimplementing: one `prisma.notification.create` for the
   * whole platform, and the same realtime envelope existing frontends already subscribe to.
   */
  async createInAppOnly(
    userId: string,
    type: NotificationKind | string,
    payload: NotificationPayload,
  ): Promise<string> {
    return this.sendNotification(userId, type, payload, { deviceDispatch: false });
  }

  async sendNotification(
    userId: string,
    type: NotificationKind | string,
    payload: NotificationPayload,
    /**
     * Whether to also hand this to the device. Defaults to true so every existing caller behaves
     * exactly as before; only the IN_APP adapter turns it off, because pushing to a device is what
     * the separate PUSH channel is for.
     */
    options: {
      deviceDispatch?: boolean;
      /** Set by the notification router's PUSH adapter, which has already applied preference. */
      preferenceAlreadyApplied?: boolean;
    } = {},
  ): Promise<string> {
    const n = await createNotificationRow({
        userId,
        type,
        title: payload.title,
        message: payload.body,
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge,
        sound: payload.sound,
        referenceId: payload.referenceId,
        referenceType: payload.referenceType,
        metadata:
          payload.actions || payload.data
            ? JSON.stringify({ actions: payload.actions, data: payload.data })
            : undefined,
        priority: "normal",
      });

    pushToUser(
      userId,
      createWsEnvelope(
        "notification.created",
        {
          id: n.id,
          title: payload.title,
          message: payload.body,
          body: payload.body,
          notificationType: type,
          referenceId: payload.referenceId,
          icon: payload.icon,
          sound: payload.sound,
          actions: payload.actions,
          data: payload.data,
          priority: "normal",
          isRead: n.isRead,
          createdAt: n.createdAt.toISOString(),
        },
        n.id,
      ),
    );

    if (options.deviceDispatch !== false) {
      void pushDeliveryService
        .sendToUser(userId, {
          title: payload.title,
          body: payload.body,
          notificationId: n.id,
          preferenceAlreadyApplied: options.preferenceAlreadyApplied,
          data: {
            referenceId: payload.referenceId,
            type,
            ...(payload.data ?? {}),
          },
        })
        .catch(() => undefined);
    }

    return n.id;
  }

  /** Provider gets a new booking request from a customer. */
  async notifyNewBookingRequest(
    providerId: string,
    bookingId: string,
    customerName: string,
    serviceName: string,
    price: number,
  ): Promise<void> {
    await this.sendNotification(providerId, NotificationType.BOOKING_REQUEST, {
      title: "New Booking Request",
      body: `${customerName} wants ${serviceName}`,
      sound: "notification_high",
      referenceId: bookingId,
      referenceType: "booking",
      actions: [
        { action: "accept", title: "Accept" },
        { action: "reject", title: "Reject" },
      ],
      data: { bookingId, price, customerName, serviceName },
    });
  }

  /** Customer learns the provider accepted. */
  async notifyBookingAccepted(
    customerId: string,
    bookingId: string,
    providerName: string,
    providerPhone?: string,
  ): Promise<void> {
    await this.sendNotification(customerId, NotificationType.BOOKING_ACCEPTED, {
      title: "Booking Accepted",
      body: `${providerName} accepted your booking`,
      sound: "notification_high",
      referenceId: bookingId,
      referenceType: "booking",
      actions: [
        { action: "track", title: "Track" },
        { action: "call", title: "Call" },
      ],
      data: { bookingId, providerName, providerPhone },
    });
  }

  /** Customer learns the provider rejected. */
  async notifyBookingRejected(
    customerId: string,
    bookingId: string,
    providerName: string,
    reason?: string,
  ): Promise<void> {
    await this.sendNotification(customerId, NotificationType.BOOKING_REJECTED, {
      title: "Booking Rejected",
      body: `${providerName} couldn't accept this booking`,
      referenceId: bookingId,
      referenceType: "booking",
      data: { bookingId, reason },
    });
  }

  /** Provider learns the customer cancelled. */
  async notifyBookingCancelled(
    providerId: string,
    bookingId: string,
    reason?: string,
  ): Promise<void> {
    await this.sendNotification(providerId, NotificationType.BOOKING_CANCELLED, {
      title: "Booking Cancelled",
      body: "Customer cancelled the booking",
      referenceId: bookingId,
      referenceType: "booking",
      data: { bookingId, reason },
    });
  }

  /** Provider gets paid after a completed booking. */
  async notifyPaymentReceived(
    providerId: string,
    amount: number,
    bookingId: string,
  ): Promise<void> {
    await this.sendNotification(providerId, NotificationType.PAYMENT_RECEIVED, {
      title: "Payment Received",
      body: `₹${amount} credited to your account`,
      sound: "notification_high",
      referenceId: bookingId,
      referenceType: "booking",
      data: { bookingId, amount },
    });
  }

  /** Provider gets a new rating. */
  async notifyRatingReceived(
    providerId: string,
    ratingValue: number,
    reviewerName: string,
    bookingId: string,
  ): Promise<void> {
    await this.sendNotification(providerId, NotificationType.RATING_RECEIVED, {
      title: "New Rating",
      body: `${reviewerName} rated you ${ratingValue}/5`,
      referenceId: bookingId,
      referenceType: "booking",
      data: { bookingId, rating: ratingValue, reviewerName },
    });
  }

  /**
   * Bulk send used for promotions/announcements.
   * Sequential writes (not Promise.all) — unbounded parallel create under connection_limit=8
   * reproduces the support-admin P2024 pool-storm failure mode.
   */
  async broadcastNotification(
    userIds: string[],
    type: NotificationKind | string,
    payload: NotificationPayload,
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.sendNotification(userId, type, payload);
      } catch (error) {
        console.error(`[Broadcast] Failed for ${userId}:`, error);
      }
    }
  }

  /** Convenience used by Part 6A WS routes that show unread on connect. */
  async getUnreadNotifications(userId: string, limit = 50) {
    return prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async markAsRead(notificationId: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async clearAllNotifications(userId: string): Promise<void> {
    await prisma.notification.deleteMany({ where: { userId } });
  }
}

export const notificationService = new NotificationService();
