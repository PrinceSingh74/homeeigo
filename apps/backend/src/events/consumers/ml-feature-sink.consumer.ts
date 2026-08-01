import { logger } from "../../lib/logger";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";
import type { PartnerArrivedPayload } from "../catalog/partner.events";

/**
 * ML feature sink boundary — Phase 1 ETL will consume these structured logs / future queue.
 * No BigQuery coupling in Phase 0.
 */
export async function mlFeatureSinkConsumer(event: HomigoEvent): Promise<void> {
  if (event.type !== EVENT_TYPES.PARTNER_ARRIVED) return;

  const data = event.data as PartnerArrivedPayload;
  logger.info("ml_feature_sink", {
    sink: "eta_labels",
    bookingId: data.bookingId,
    providerId: data.providerId,
    travelDurationMin: data.travelDurationMin,
    distanceKm: data.distanceKm,
    googleEtaMin: data.googleEtaMin,
    hourOfDay: data.hourOfDay,
    dayOfWeek: data.dayOfWeek,
    city: data.city,
    serviceCategory: data.serviceCategory,
    eventId: event.id,
  });
}

export const ML_FEATURE_SINK_CONSUMER_NAME = "ml-feature-sink.v1";
