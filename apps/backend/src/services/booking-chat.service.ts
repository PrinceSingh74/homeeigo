import prisma from "../lib/prisma";
import { ACTIVE_FULFILMENT_STATUSES } from "../lib/privacy-policy.engine";
import { sanitizeUserInput } from "../utils/sanitizer";
import { notificationService } from "./notification.service";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";

export type ChatActor = {
  userId: string;
  providerId?: string | null;
};

const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW_MS = 60_000;

class BookingChatService {
  private async loadBookingParticipants(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        providerId: true,
        status: true,
        acceptedAt: true,
        provider: { select: { userId: true } },
      },
    });
  }

  private assertParticipant(
    booking: {
      userId: string;
      providerId: string | null;
      provider: { userId: string } | null;
    },
    actorUserId: string,
  ) {
    const providerUserId = booking.provider?.userId ?? null;
    if (booking.userId === actorUserId || providerUserId === actorUserId) return;
    throw new Error("FORBIDDEN");
  }

  /**
   * Chat is the contact channel of a job in hand, like the masked phone and the visit note: it is
   * open while the booking is in an active fulfilment status and closed outside it. After the job a
   * problem goes through a case, not a message to someone who no longer holds the job.
   */
  private assertOpen(booking: { status: unknown }) {
    if (!ACTIVE_FULFILMENT_STATUSES.has(String(booking.status))) throw new Error("CHAT_CLOSED");
  }

  async ensureConversation(bookingId: string) {
    const existing = await prisma.bookingConversation.findUnique({
      where: { bookingId },
    });
    if (existing) return existing;
    try {
      return await prisma.bookingConversation.create({
        data: { bookingId },
      });
    } catch {
      const raced = await prisma.bookingConversation.findUnique({ where: { bookingId } });
      if (raced) return raced;
      throw new Error("NOT_FOUND");
    }
  }

  async listMessages(
    bookingId: string,
    actor: ChatActor,
    opts?: { cursor?: string; limit?: number },
  ) {
    const booking = await this.loadBookingParticipants(bookingId);
    if (!booking) throw new Error("NOT_FOUND");
    this.assertParticipant(booking, actor.userId);
    if (booking.userId !== actor.userId) this.assertOpen(booking);

    const conversation = await this.ensureConversation(bookingId);
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);

    // The conversation belongs to the booking, not to a partner. A partner reads what they wrote and
    // what the customer wrote since they took the job; what was said to an earlier partner stays there.
    const isCustomer = booking.userId === actor.userId;
    const partnerScope = isCustomer
      ? {}
      : {
          OR: [
            { senderUserId: actor.userId },
            ...(booking.acceptedAt ? [{ senderUserId: booking.userId, createdAt: { gte: booking.acceptedAt } }] : []),
          ],
        };
    const messages = await prisma.bookingMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(opts?.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}),
        ...partnerScope,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        senderUserId: true,
        body: true,
        clientMessageId: true,
        deliveredAt: true,
        readAt: true,
        createdAt: true,
      },
    });

    const nextCursor =
      messages.length === limit
        ? messages[messages.length - 1]!.createdAt.toISOString()
        : null;

    return {
      conversationId: conversation.id,
      messages: messages.reverse(),
      nextCursor,
    };
  }

  async sendMessage(
    bookingId: string,
    actorUserId: string,
    body: string,
    clientMessageId?: string,
  ) {
    const booking = await this.loadBookingParticipants(bookingId);
    if (!booking) throw new Error("NOT_FOUND");
    this.assertParticipant(booking, actorUserId);
    this.assertOpen(booking);

    const cleaned = sanitizeUserInput(body, 2000).trim();
    if (!cleaned) throw new Error("VALIDATION_ERROR");

    const rate = await consumeRateLimitSmart(
      `booking-chat:${bookingId}:${actorUserId}`,
      CHAT_RATE_LIMIT,
      CHAT_RATE_WINDOW_MS,
    );
    if (!rate.allowed) throw new Error("RATE_LIMITED");

    const conversation = await this.ensureConversation(bookingId);
    const clientId = clientMessageId?.trim() || null;

    if (clientId) {
      const existing = await prisma.bookingMessage.findUnique({
        where: {
          conversationId_clientMessageId: {
            conversationId: conversation.id,
            clientMessageId: clientId,
          },
        },
      });
      if (existing) return { message: existing, created: false as const };
    }

    let message;
    try {
      message = await prisma.bookingMessage.create({
        data: {
          conversationId: conversation.id,
          senderUserId: actorUserId,
          body: cleaned,
          clientMessageId: clientId,
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      if (clientId) {
        const raced = await prisma.bookingMessage.findUnique({
          where: {
            conversationId_clientMessageId: {
              conversationId: conversation.id,
              clientMessageId: clientId,
            },
          },
        });
        if (raced) return { message: raced, created: false as const };
      }
      throw err;
    }

    await prisma.bookingConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        bookingId,
        userId: actorUserId,
        providerId: booking.providerId,
        action: "BOOKING_CHAT_MESSAGE",
        description: `Chat message sent (${message.id})`,
      },
    });

    const providerUserId = booking.provider?.userId ?? null;
    const recipientUserId =
      actorUserId === booking.userId ? providerUserId : booking.userId;
    if (recipientUserId) {
      // Detached: the message row is already persisted. A throw reported a delivered message as
    // failed and skipped emitChatEvent; a retry with the same clientMessageId returns the existing
    // row before reaching here, so the recipient would never have been notified at all.
    await notificationService.createForUserDetached({
        userId: recipientUserId,
        type: "booking_chat_message",
        title: "New message",
        // The text stays in the conversation, which closes with the job; a notification outlives it.
        message: actorUserId === booking.userId ? "Your customer sent a message about this job." : "Your professional sent a message about your booking.",
        referenceId: bookingId,
        referenceType: "booking",
      });
    }

    void this.emitChatEvent(bookingId, message.id, actorUserId, message.createdAt);

    return { message, created: true as const };
  }

  private async emitChatEvent(bookingId: string, messageId: string, senderUserId: string, createdAt: Date) {
    try {
      const { eventPlatformConfig } = await import("../events/core/config");
      if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.bookingEventsEnabled) return;
      const { emitStandalone } = await import("../events/core/event-publisher");
      const { buildBookingChatMessageSentEvent } = await import("../events/catalog/booking.events");
      await emitStandalone(
        prisma,
        buildBookingChatMessageSentEvent({
          bookingId,
          messageId,
          senderUserId,
          createdAt,
        }),
      );
    } catch {
      /* event emit must not break chat */
    }
  }

  async markRead(bookingId: string, actorUserId: string) {
    const booking = await this.loadBookingParticipants(bookingId);
    if (!booking) throw new Error("NOT_FOUND");
    this.assertParticipant(booking, actorUserId);
    if (booking.userId !== actorUserId) this.assertOpen(booking);

    const conversation = await this.ensureConversation(bookingId);
    const result = await prisma.bookingMessage.updateMany({
      where: {
        conversationId: conversation.id,
        senderUserId: { not: actorUserId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}

export const bookingChatService = new BookingChatService();
