import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { notificationService, NotificationType } from "../../services/notification.service";
import type { ScheduledJobContext } from "../core/job-registry";

export const REVIEW_REQUEST_JOB_TYPE = "automation.review_request";

type ReviewRequestPayload = {
  bookingId?: unknown;
  userId?: unknown;
  providerId?: unknown;
};

/**
 * Asks a customer to review a completed booking.
 *
 * Every precondition is re-checked at execution time rather than trusted from the
 * payload: the job was enqueued hours earlier and the world may have moved on —
 * the booking could have been cancelled, or the customer may have already reviewed.
 */
export async function reviewRequestJobHandler(
  payload: Record<string, unknown>,
  ctx: ScheduledJobContext,
): Promise<void> {
  const { bookingId, userId } = payload as ReviewRequestPayload;

  if (typeof bookingId !== "string" || typeof userId !== "string") {
    throw new Error("review_request payload missing bookingId or userId");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, bookingNumber: true, userId: true },
  });

  // Booking vanished or never completed — nothing to review. Not an error.
  if (!booking || booking.status !== "COMPLETED") {
    logger.info("review_request_skipped", {
      jobId: ctx.jobId,
      bookingId,
      reason: booking ? `status=${booking.status}` : "booking_not_found",
    });
    return;
  }

  // Customer already reviewed — asking again would be noise.
  const existingRating = await prisma.rating.findUnique({
    where: { bookingId },
    select: { id: true },
  });
  if (existingRating) {
    logger.info("review_request_skipped", { jobId: ctx.jobId, bookingId, reason: "already_rated" });
    return;
  }

  await notificationService.sendNotification(booking.userId, NotificationType.SYSTEM, {
    title: "How was your service?",
    body: `Tell us about your recent booking ${booking.bookingNumber}. Your feedback helps other customers.`,
    data: { bookingId, action: "review" },
    referenceId: bookingId,
    referenceType: "booking",
  });

  logger.info("review_request_sent", { jobId: ctx.jobId, bookingId });
}
