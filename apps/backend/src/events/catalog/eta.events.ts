import crypto from "crypto";
import { EVENT_SOURCES, EVENT_TYPES, EVENT_VERSION } from "./event-types";
import type { HomigoEvent } from "../core/homigo-event";
import { mergeEventContext } from "../core/event-context";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../core/pii";

export type EtaLabelCreatedPayload = {
  bookingId: string;
  partnerHash: string;
  city: string | null;
  actualTravelDurationSec: number | null;
  googleEtaSeconds: number | null;
  qualityScore: number;
  status: string;
};

export type EtaTripCompletedPayload = {
  bookingId: string;
  partnerHash: string;
  actualTravelDurationMin: number | null;
  googleEtaMinutes: number | null;
  gapMinutes: number | null;
  city: string | null;
};

export type EtaFeatureUpdatedPayload = {
  bookingId: string;
  featureGroup: string;
  versionTag: string;
  rowCount: number;
};

function etaEnvelope<T extends Record<string, unknown>>(
  type: string,
  aggregateId: string,
  data: T,
  bookingId: string,
): HomigoEvent<T> {
  const trace = mergeEventContext();
  const safe = sanitizeEventPayload(data);
  assertNoProhibitedPii(safe);
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type,
    source: EVENT_SOURCES.ETA_INTELLIGENCE,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: safe,
    homigo: {
      version: EVENT_VERSION,
      aggregateType: "eta",
      aggregateId,
      actorType: trace.actorType ?? "system",
      actorId: trace.actorId ?? "eta-intelligence",
      traceId: trace.traceId,
      correlationId: bookingId,
      causationId: trace.causationId,
    },
  };
}

export function buildEtaLabelCreatedEvent(input: EtaLabelCreatedPayload): HomigoEvent<EtaLabelCreatedPayload> {
  return etaEnvelope(EVENT_TYPES.ETA_LABEL_CREATED, input.bookingId, input, input.bookingId);
}

export function buildEtaTripCompletedEvent(input: EtaTripCompletedPayload): HomigoEvent<EtaTripCompletedPayload> {
  return etaEnvelope(EVENT_TYPES.ETA_TRIP_COMPLETED, input.bookingId, input, input.bookingId);
}

export function buildEtaFeatureUpdatedEvent(input: EtaFeatureUpdatedPayload): HomigoEvent<EtaFeatureUpdatedPayload> {
  return etaEnvelope(EVENT_TYPES.ETA_FEATURE_UPDATED, input.bookingId, input, input.bookingId);
}
