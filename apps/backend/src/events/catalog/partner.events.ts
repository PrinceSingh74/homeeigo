import crypto from "crypto";
import { EVENT_SOURCES, EVENT_TYPES, EVENT_VERSION } from "./event-types";
import type { HomigoEvent } from "../core/homigo-event";
import { mergeEventContext } from "../core/event-context";
import { assertNoProhibitedPii, sanitizeEventPayload } from "../core/pii";

export type PartnerOnlinePayload = {
  providerId: string;
  onlineSince: string;
};

export type PartnerOfflinePayload = {
  providerId: string;
  offlineAt: string;
};

export type PartnerDispatchedPayload = {
  providerId: string;
  bookingId: string;
  jobId: string;
  dispatchedAt: string;
  serviceId: string;
};

export type PartnerEnRoutePayload = {
  providerId: string;
  bookingId: string;
  enRouteAt: string;
  distanceKm: number | null;
  googleEtaMin: number | null;
};

export type PartnerArrivedPayload = {
  providerId: string;
  bookingId: string;
  arrivedAt: string;
  dispatchedAt: string | null;
  enRouteAt: string | null;
  travelDurationMin: number | null;
  city: string | null;
  serviceCategory: string | null;
  distanceKm: number | null;
  googleEtaMin: number | null;
  hourOfDay: number;
  dayOfWeek: number;
};

function partnerEnvelope<T extends Record<string, unknown>>(
  type: string,
  source: string,
  aggregateId: string,
  data: T,
  bookingId?: string,
): HomigoEvent<T> {
  const trace = mergeEventContext();
  const safe = sanitizeEventPayload(data);
  assertNoProhibitedPii(safe);
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type,
    source,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: safe,
    homigo: {
      version: EVENT_VERSION,
      aggregateType: "partner",
      aggregateId,
      actorType: trace.actorType ?? "partner",
      actorId: trace.actorId ?? aggregateId,
      traceId: trace.traceId,
      correlationId: bookingId ?? trace.correlationId,
      causationId: trace.causationId,
    },
  };
}

export function buildPartnerOnlineEvent(input: {
  providerId: string;
  onlineSince: Date;
}): HomigoEvent<PartnerOnlinePayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_ONLINE,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    { providerId: input.providerId, onlineSince: input.onlineSince.toISOString() },
  );
}

export function buildPartnerOfflineEvent(input: {
  providerId: string;
  offlineAt: Date;
}): HomigoEvent<PartnerOfflinePayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_OFFLINE,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    { providerId: input.providerId, offlineAt: input.offlineAt.toISOString() },
  );
}

export function buildPartnerDispatchedEvent(input: {
  providerId: string;
  bookingId: string;
  jobId: string;
  dispatchedAt: Date;
  serviceId: string;
}): HomigoEvent<PartnerDispatchedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_DISPATCHED,
    EVENT_SOURCES.ASSIGNMENT,
    input.providerId,
    {
      providerId: input.providerId,
      bookingId: input.bookingId,
      jobId: input.jobId,
      dispatchedAt: input.dispatchedAt.toISOString(),
      serviceId: input.serviceId,
    },
    input.bookingId,
  );
}

export function buildPartnerEnRouteEvent(input: {
  providerId: string;
  bookingId: string;
  enRouteAt: Date;
  distanceKm: number | null;
  googleEtaMin: number | null;
}): HomigoEvent<PartnerEnRoutePayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_EN_ROUTE,
    EVENT_SOURCES.TRACKING,
    input.providerId,
    {
      providerId: input.providerId,
      bookingId: input.bookingId,
      enRouteAt: input.enRouteAt.toISOString(),
      distanceKm: input.distanceKm,
      googleEtaMin: input.googleEtaMin,
    },
    input.bookingId,
  );
}

export function buildPartnerArrivedEvent(input: {
  providerId: string;
  bookingId: string;
  arrivedAt: Date;
  dispatchedAt: Date | null;
  enRouteAt: Date | null;
  travelDurationMin: number | null;
  city: string | null;
  serviceCategory: string | null;
  distanceKm: number | null;
  googleEtaMin: number | null;
}): HomigoEvent<PartnerArrivedPayload> {
  const arrivedAt = input.arrivedAt;
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_ARRIVED,
    EVENT_SOURCES.TRACKING,
    input.providerId,
    {
      providerId: input.providerId,
      bookingId: input.bookingId,
      arrivedAt: arrivedAt.toISOString(),
      dispatchedAt: input.dispatchedAt?.toISOString() ?? null,
      enRouteAt: input.enRouteAt?.toISOString() ?? null,
      travelDurationMin: input.travelDurationMin,
      city: input.city,
      serviceCategory: input.serviceCategory,
      distanceKm: input.distanceKm,
      googleEtaMin: input.googleEtaMin,
      hourOfDay: arrivedAt.getHours(),
      dayOfWeek: arrivedAt.getDay(),
    },
    input.bookingId,
  );
}
