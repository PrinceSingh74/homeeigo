import prisma from "@/lib/prisma";
import { roomManager, MessageType, WSMessage } from "@/lib/websocket";
import { notificationService } from "@/services/notification.service";
import { BookingStatus } from "@prisma/client";
import { assignmentEngine } from "@/services/assignment-engine.service";
import { bookingService } from "@/services/booking.service";
import { resolveProviderIdFromUserId } from "@/lib/provider-resolve";

export class BookingLiveService {
  private async broadcastBookingUpdate(
    bookingId: string,
    status: BookingStatus | string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const message: WSMessage = {
      type: MessageType.BOOKING_STATUS,
      data: {
        bookingId,
        status: status.toLowerCase(),
        ...data,
        timestamp: new Date(),
      },
      timestamp: new Date(),
    };

    roomManager.broadcast(`booking:${bookingId}`, message);
  }

  async acceptBooking(bookingId: string, providerUserId: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          providerId,
        },
        include: {
          user: true,
          provider: { include: { user: true } },
          service: true,
        },
      });

      await this.broadcastBookingUpdate(bookingId, booking.status, {
        providerId,
        providerName: booking.provider?.user.firstName,
        acceptedAt: booking.acceptedAt,
      });

      await notificationService.sendNotification(booking.userId, "BOOKING_ACCEPTED", {
        title: "Booking Accepted",
        body: `${booking.provider?.user.firstName || "Provider"} accepted your ${booking.service.name} booking`,
        data: { bookingId, type: "booking_accepted" },
      });

      void assignmentEngine.onProviderAccepted(bookingId, providerId).catch(() => undefined);

      console.log(`[Booking] Accepted: ${bookingId} by ${providerId}`);
      return booking;
    } catch (error) {
      console.error("Accept booking error:", error);
      throw error;
    }
  }

  async rejectBooking(bookingId: string, providerUserId: string, reason?: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "REJECTED" },
        include: { user: true, service: true },
      });

      await this.broadcastBookingUpdate(bookingId, booking.status, { providerId, reason });

      void assignmentEngine.onProviderRejected(bookingId, providerId, reason).catch(() => undefined);

      await notificationService.sendNotification(booking.userId, "BOOKING_REJECTED", {
        title: "Booking Rejected",
        body: `Provider rejected your ${booking.service.name} booking request`,
        data: { bookingId, reason },
      });

      console.log(`[Booking] Rejected: ${bookingId} by ${providerId}`);
      return booking;
    } catch (error) {
      console.error("Reject booking error:", error);
      throw error;
    }
  }

  async cancelBooking(bookingId: string, userId: string, reason?: string): Promise<unknown> {
    try {
      const prior = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!prior) throw new Error("NOT_FOUND");

      const result = await bookingService.cancel({ userId }, bookingId, reason ?? "Cancelled via app");
      if ("error" in result) throw new Error(result.error);

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { user: true, provider: { include: { user: true } }, service: true },
      });
      if (!booking) throw new Error("NOT_FOUND");

      await this.broadcastBookingUpdate(bookingId, booking.status, {
        cancelledBy: userId,
        reason,
        refundAmount: result.refundAmount,
      });

      if (booking.provider?.userId) {
        await notificationService.sendNotification(booking.provider.userId, "BOOKING_CANCELLED", {
          title: "Booking Cancelled",
          body: `Customer cancelled the ${booking.service.name} booking`,
          data: { bookingId, reason },
        });
      }

      console.log(`[Booking] Cancelled: ${bookingId}`);
      return booking;
    } catch (error) {
      console.error("Cancel booking error:", error);
      throw error;
    }
  }

  async startService(bookingId: string, providerUserId: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const booking = await bookingService.start(providerId, bookingId, 0, 0);

      await this.broadcastBookingUpdate(bookingId, booking.status, {
        startedAt: booking.startedAt,
      });

      await notificationService.sendNotification(booking.userId, "SYSTEM", {
        title: "Service Started",
        body: "Provider has started your service",
        data: { bookingId },
      });

      console.log(`[Booking] Service started: ${bookingId}`);
      return booking;
    } catch (error) {
      console.error("Start service error:", error);
      throw error;
    }
  }

  /** Delegates to booking.service.complete — single source of truth for earnings + ledger. */
  async completeBooking(bookingId: string, providerUserId: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const result = await bookingService.complete(providerId, bookingId, 0, 0);
      if (!result) throw new Error("FORBIDDEN");

      const booking = result.booking;

      await this.broadcastBookingUpdate(bookingId, booking.status, {
        completedAt: booking.completedAt,
      });

      await notificationService.sendNotification(booking.userId, "SYSTEM", {
        title: "Service Complete",
        body: `Please rate your experience`,
        data: { bookingId, action: "rate" },
      });

      console.log(`[Booking] Completed: ${bookingId}`);
      return booking;
    } catch (error) {
      console.error("Complete booking error:", error);
      throw error;
    }
  }
}

export const bookingLiveService = new BookingLiveService();
