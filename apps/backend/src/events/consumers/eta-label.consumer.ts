import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";
import type { BookingCompletedPayload } from "../catalog/booking.events";
import type { PartnerArrivedPayload } from "../catalog/partner.events";
import { etaIntelligenceService } from "../../services/eta-intelligence.service";
import { triggerEventEtl } from "../../../analytics/scheduler/etl-scheduler";
import { logger } from "../../lib/logger";

/**
 * Phase 2 ETA label consumer — creates training labels on booking completion.
 * Extends Phase 1 ml-feature-sink; does NOT replace it (backward compatible).
 * NO ML inference — label collection only.
 */
export async function etaLabelConsumer(event: HomigoEvent): Promise<void> {
  if (event.type === EVENT_TYPES.BOOKING_COMPLETED) {
    const data = event.data as BookingCompletedPayload;
    if (!data.bookingId) return;

    const summary = await etaIntelligenceService.collectLabelFromBooking(data.bookingId, event.id);
    if (summary) {
      logger.info("eta_label_collected", {
        bookingId: data.bookingId,
        status: summary.status,
        qualityScore: summary.qualityScore,
      });
    }

    void triggerEventEtl(event.type, data.bookingId).catch(() => undefined);
    return;
  }

  if (event.type === EVENT_TYPES.PARTNER_ARRIVED) {
    const data = event.data as PartnerArrivedPayload;
    // Intermediate capture — full label created on booking.completed
    logger.info("eta_trip_arrived", {
      bookingId: data.bookingId,
      travelDurationMin: data.travelDurationMin,
      googleEtaMin: data.googleEtaMin,
    });
  }
}

export const ETA_LABEL_CONSUMER_NAME = "eta-label.v1";
