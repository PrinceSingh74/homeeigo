import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { eventPlatformConfig } from "../core/config";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";
import type { BookingCompletedPayload } from "../catalog/booking.events";

/** Durable delayed job scheduling — execution engine deferred to Phase 6. */
export async function automationSchedulerConsumer(event: HomigoEvent): Promise<void> {
  if (event.type !== EVENT_TYPES.BOOKING_COMPLETED) return;

  const data = event.data as BookingCompletedPayload;
  const runAt = new Date(Date.now() + eventPlatformConfig.reviewRequestDelayMs);
  const jobType = "automation.review_request";

  const existing = await prisma.scheduledJob.findFirst({
    where: { jobType, triggerEventId: event.id },
    select: { id: true },
  });
  if (existing) return;

  await prisma.scheduledJob.create({
    data: {
      jobType,
      triggerEventId: event.id,
      payload: {
        bookingId: data.bookingId,
        userId: data.userId,
        providerId: data.providerId,
        scheduledBy: "automation-scheduler.v1",
      },
      runAt,
      status: "pending",
    },
  });

  logger.info("scheduled_job_created", {
    jobType,
    bookingId: data.bookingId,
    runAt: runAt.toISOString(),
    triggerEventId: event.id,
  });
}

export const AUTOMATION_SCHEDULER_CONSUMER_NAME = "automation-scheduler.v1";
