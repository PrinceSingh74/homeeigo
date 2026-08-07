import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import type { HomigoEvent } from "../core/homigo-event";
import { EVENT_TYPES } from "../catalog/event-types";
import type { PartnerArrivedPayload } from "../catalog/partner.events";
import { hashPii } from "../../../analytics/etl/pii";
import { loadRows } from "../../../analytics/etl/bq-client";
import { triggerEventEtl } from "../../../analytics/scheduler/etl-scheduler";

/**
 * ML feature sink — Phase 1: persists ETA labels to staging + BigQuery feature layer.
 * Extends Phase 0 boundary; no duplicate event system.
 */
export async function mlFeatureSinkConsumer(event: HomigoEvent): Promise<void> {
  if (event.type !== EVENT_TYPES.PARTNER_ARRIVED) return;

  const data = event.data as PartnerArrivedPayload;
  const payload = {
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
  };

  await prisma.mlFeatureStaging.create({
    data: { sinkType: "eta_labels", eventId: event.id, bookingId: data.bookingId, payload },
  });

  try {
    await loadRows("feature", "ml_eta_labels", [{
      event_id: event.id,
      booking_id: data.bookingId,
      provider_hash: hashPii(data.providerId),
      travel_duration_min: data.travelDurationMin,
      distance_km: data.distanceKm,
      google_eta_min: data.googleEtaMin,
      hour_of_day: data.hourOfDay,
      day_of_week: data.dayOfWeek,
      city: data.city,
      service_category: data.serviceCategory,
      ingested_at: new Date().toISOString(),
    }]);
    await prisma.mlFeatureStaging.updateMany({
      where: { eventId: event.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (err) {
    logger.warn("ml_feature_sink_bq_deferred", {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("ml_feature_sink", payload);

  void triggerEventEtl(event.type, data.bookingId).catch(() => undefined);
}

export const ML_FEATURE_SINK_CONSUMER_NAME = "ml-feature-sink.v1";
