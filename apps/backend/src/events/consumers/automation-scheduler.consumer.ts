import prisma from "../../lib/prisma";
import { getPrismaErrorCode } from "../../lib/prisma-errors";
import { logger } from "../../lib/logger";
import { eventPlatformConfig } from "../core/config";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";
import type { BookingCompletedPayload } from "../catalog/booking.events";
import { isSupersededByLiveWorkflow } from "../../automation/registry/legacy-path-guard";

/** Durable delayed job scheduling — execution engine deferred to Phase 6. */
export async function automationSchedulerConsumer(event: HomigoEvent): Promise<void> {
  if (event.type !== EVENT_TYPES.BOOKING_COMPLETED) return;

  const data = event.data as BookingCompletedPayload;
  const runAt = new Date(Date.now() + eventPlatformConfig.reviewRequestDelayMs);
  const jobType = "automation.review_request";

  /**
   * Stand down once the replacing workflow is actually sending.
   *
   * The `review_request` workflow does this same job through the notification router. While it is
   * SHADOW it sends nothing and this legacy path is the only one asking for a review, which is why
   * it is still here. The instant that workflow is certified LIVE, leaving this enabled would give
   * every completed booking two review requests — and the ungoverned one would ignore quiet hours,
   * cooldown and the customer's own preferences.
   */
  if (isSupersededByLiveWorkflow(jobType)) {
    logger.info("scheduled_job_skipped_superseded", {
      jobType,
      bookingId: data.bookingId,
      triggerEventId: event.id,
    });
    return;
  }

  // Claim by inserting. The partial unique index scheduled_jobs_review_request_trigger_event_id_key
  // makes the database the arbiter: a redelivered event (crash before the consumer receipt, or a
  // lease lapse with the first handler still running) gets P2002 here instead of a second job —
  // and a second "How was your service?" push. A read-then-write check was only advisory.
  try {
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
  } catch (err) {
    if (getPrismaErrorCode(err) === "P2002") {
      logger.info("scheduled_job_already_claimed", { jobType, triggerEventId: event.id });
      return;
    }
    throw err;
  }

  logger.info("scheduled_job_created", {
    jobType,
    bookingId: data.bookingId,
    runAt: runAt.toISOString(),
    triggerEventId: event.id,
  });
}

export const AUTOMATION_SCHEDULER_CONSUMER_NAME = "automation-scheduler.v1";
