import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { incCounter } from "../../lib/metrics";
import { notificationService } from "../../services/notification.service";
import { EVENT_TYPES } from "../catalog/event-types";
import type { HomigoEvent } from "../core/homigo-event";

export const BOOKING_LIFECYCLE_NOTIFY_CONSUMER_NAME = "booking-lifecycle-notify";

/**
 * §49 — the consumer for `homigo.booking.payment_expired`.
 *
 * Until now a booking could be released by PAYMENT_PENDING_TTL and the customer would learn about it
 * by opening the app and finding their slot gone. The expiry is emitted transactionally with the
 * release; this turns it into the one thing a customer actually needs: being told, with the reason,
 * so they can book again.
 *
 * Deliberately narrow. `booking.rescheduled` is NOT notified here: the reschedule path already
 * notifies the partner directly and the customer performed the action themselves, so a second
 * message would be noise. That event is consumed by the audit and metrics consumers, which is the
 * responsibility it actually needs — a no-op handler added only to satisfy a test would be worse
 * than none.
 *
 * Idempotent by CLAIM, not by lookup. The first version read "has a notification already been
 * written?" and then wrote one — under five concurrent deliveries all five read "no" and the
 * customer got five messages. The claim is now an INSERT into `event_consumer_receipts`, whose
 * unique (consumerName, eventId) is the platform's existing arbiter for exactly this question;
 * exactly one delivery can win it. A claim is released again if the send fails, so a retry is still
 * possible and a failed delivery is never silently swallowed.
 */
export async function bookingLifecycleNotifyConsumer(event: HomigoEvent): Promise<void> {
  if (event.type !== EVENT_TYPES.BOOKING_PAYMENT_EXPIRED) return;

  const data = event.data as { bookingId?: string; userId?: string; ttlMinutes?: number; scheduledAt?: string };
  if (!data.bookingId || !data.userId) {
    incCounter("booking_expiry_notify_total", { outcome: "missing_fields" });
    return;
  }

  // The claim. Exactly one concurrent delivery can create this row; the rest collide on P2002.
  try {
    await prisma.eventConsumerReceipt.create({
      data: { consumerName: BOOKING_LIFECYCLE_NOTIFY_CONSUMER_NAME, eventId: event.id, result: "claimed" },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      incCounter("booking_expiry_notify_total", { outcome: "already_sent" });
      return;
    }
    throw err;
  }

  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    select: { bookingNumber: true, service: { select: { name: true } } },
  });
  const serviceName = booking?.service?.name ?? "your service";
  const minutes = data.ttlMinutes ?? 15;

  try {
    await notificationService.createForUser({
      userId: data.userId,
      type: "BOOKING_PAYMENT_EXPIRED",
      title: "Booking released — payment wasn't completed",
      // States what happened and what to do, and never implies anyone cancelled it.
      message: `Payment for ${serviceName} wasn't completed within ${minutes} minutes, so the slot was released. You can book it again whenever you're ready.`,
      referenceId: data.bookingId,
      referenceType: "booking",
    });
    incCounter("booking_expiry_notify_total", { outcome: "sent" });
  } catch (err) {
    // The send failed, so the claim must not stand: releasing it lets the bus's retry try again
    // rather than recording a delivery that never happened.
    await prisma.eventConsumerReceipt
      .deleteMany({ where: { consumerName: BOOKING_LIFECYCLE_NOTIFY_CONSUMER_NAME, eventId: event.id, result: "claimed" } })
      .catch(() => undefined);
    incCounter("booking_expiry_notify_total", { outcome: "error" });
    logger.error("booking_expiry_notify_failed", {
      category: "APPLICATION",
      bookingId: data.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
