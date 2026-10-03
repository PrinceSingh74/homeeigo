import prisma from "@/lib/prisma";
import { assignmentEngine } from "@/services/assignment-engine.service";
import { bookingService } from "@/services/booking.service";
import { bookingStartOtpService } from "@/services/booking-start-otp.service";
import { resolveProviderIdFromUserId } from "@/lib/provider-resolve";
import { logger } from "@/lib/logger";

/**
 * WebSocket command adapter for `/ws/booking/:id`.
 *
 * Every method delegates to `bookingService`, which is the single owner of the state machine AND
 * of the realtime `BOOKING_STATUS` frame (see lib/booking-realtime.ts). This class used to
 * broadcast its own copy of the frame and send its own copy of the customer notification, which
 * meant an action taken over WS double-notified while the same action over HTTP emitted nothing.
 */
export class BookingLiveService {
  async acceptBooking(bookingId: string, providerUserId: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const result = await bookingService.accept(providerId, bookingId);
      if (!result.ok) throw new Error(result.error);

      const booking = result.booking;

      void assignmentEngine.onProviderAccepted(bookingId, providerId).catch(() => undefined);

      logger.info("booking_ws_accepted", { bookingId, providerId });
      return booking;
    } catch (error) {
      logger.error("booking_ws_accept_failed", {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async rejectBooking(bookingId: string, providerUserId: string, reason?: string): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const result = await bookingService.reject(providerId, bookingId, reason ?? "Declined");
      if (result && "error" in result) throw new Error(result.error);

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { user: true, service: true },
      });
      if (!booking) throw new Error("NOT_FOUND");

      logger.info("booking_ws_declined", { bookingId, providerId });
      return booking;
    } catch (error) {
      logger.error("booking_ws_reject_failed", {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
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

      // Partner notification is owned by bookingService.cancel (notifyBookingCancelled).
      logger.info("booking_ws_cancelled", { bookingId, userId });
      return booking;
    } catch (error) {
      logger.error("booking_ws_cancel_failed", {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * WS start must honour the same OTP + payment gates as HTTP.
   * Coords come from the client message when present; never invent 0,0 as presence proof.
   */
  async startService(
    bookingId: string,
    providerUserId: string,
    opts?: { otp?: string; latitude?: number; longitude?: number },
  ): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      const lat = opts?.latitude;
      const lng = opts?.longitude;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        throw new Error("LOCATION_REQUIRED");
      }

      const gate = await bookingStartOtpService.ensureCanStart(providerId, bookingId, opts?.otp);
      if (!gate.ok) throw new Error(gate.error);

      const booking = await bookingService.start(providerId, bookingId, lat, lng);

      logger.info("booking_ws_started", { bookingId, providerId });
      return booking;
    } catch (error) {
      logger.error("booking_ws_start_failed", {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Delegates to booking.service.complete — single source of truth for earnings + ledger. */
  async completeBooking(
    bookingId: string,
    providerUserId: string,
    opts?: { latitude?: number; longitude?: number; notes?: string },
  ): Promise<unknown> {
    try {
      const providerId = await resolveProviderIdFromUserId(providerUserId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");

      // Absent coordinates stay absent (UNKNOWN) — never coerced to 0,0.
      const lat = opts?.latitude ?? null;
      const lng = opts?.longitude ?? null;
      const result = await bookingService.complete(providerId, bookingId, lat, lng, opts?.notes);
      const booking = result.booking;

      // "Please rate your experience" is already sent by bookingService.complete
      // (type booking_completed); a second SYSTEM copy here was a duplicate.
      logger.info("booking_ws_completed", { bookingId, providerId, newlyCompleted: result.newlyCompleted });
      return booking;
    } catch (error) {
      logger.error("booking_ws_complete_failed", {
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const bookingLiveService = new BookingLiveService();
