import prisma from "../lib/prisma";
import { createWsEnvelope, pushToUser } from "./notification-hub";
import { pushDeliveryService } from "./push-delivery.service";

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
    const n = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        imageUrl: input.imageUrl,
        priority: input.priority ?? "normal",
      },
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
  async sendNotification(
    userId: string,
    type: NotificationKind | string,
    payload: NotificationPayload,
  ): Promise<string> {
    const n = await prisma.notification.create({
      data: {
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
      },
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

    void pushDeliveryService
      .sendToUser(userId, {
        title: payload.title,
        body: payload.body,
        notificationId: n.id,
        data: {
          referenceId: payload.referenceId,
          type,
          ...(payload.data ?? {}),
        },
      })
      .catch(() => undefined);

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

  /** Bulk send used for promotions/announcements. */
  async broadcastNotification(
    userIds: string[],
    type: NotificationKind | string,
    payload: NotificationPayload,
  ): Promise<void> {
    await Promise.all(
      userIds.map((userId) =>
        this.sendNotification(userId, type, payload).catch((error) => {
          console.error(`[Broadcast] Failed for ${userId}:`, error);
        }),
      ),
    );
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
