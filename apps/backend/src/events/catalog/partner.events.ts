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

export type PartnerPausedPayload = {
  providerId: string;
  pausedAt: string;
  reason: string;
};

export type PartnerResumedPayload = {
  providerId: string;
  resumedAt: string;
};

export type PartnerAvailabilityUpdatedPayload = {
  providerId: string;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
};

export type PartnerServiceAreaUpdatedPayload = {
  providerId: string;
  serviceRegions: string[];
  serviceRadiusKm: number | null;
};

export type PartnerCapacityChangedPayload = {
  providerId: string;
  currentJobs: number;
  availableSlots: number;
  utilization: number;
};

export type PartnerDispatchedPayload = {
  providerId: string;
  bookingId: string;
  jobId: string;
  dispatchedAt: string;
  serviceId: string;
};

/**
 * How the travel-start timestamp was established. `explicit_partner_action` is the
 * partner tapping "I'm on my way"; `gps_geofence` is inferred from the GPS stream.
 * The ETA label's duration anchors on this timestamp, so a trainer must be able to
 * tell a declared departure from an inferred one.
 */
export type EnRouteSource = "explicit_partner_action" | "gps_geofence";

export type PartnerEnRoutePayload = {
  providerId: string;
  bookingId: string;
  enRouteAt: string;
  distanceKm: number | null;
  googleEtaMin: number | null;
  enRouteSource: EnRouteSource;
};

/**
 * How the arrival was established. ML training must be able to tell a GPS-geofenced
 * arrival (precise) from one inferred at job start (includes idle time before the
 * partner began work), so the provenance travels with the event.
 *
 * `explicit_partner_action` — the partner tapped "I've arrived". Authoritative.
 * `gps_geofence`            — inferred from the GPS stream clearing the arrival radius.
 * `job_start`               — inferred at job start; later than true arrival by however
 *                             long the partner idled before beginning work.
 */
export type ArrivalSource = "explicit_partner_action" | "gps_geofence" | "job_start";

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
  arrivalSource: ArrivalSource;
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

export function buildPartnerPausedEvent(input: {
  providerId: string;
  pausedAt: Date;
  reason: string;
}): HomigoEvent<PartnerPausedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_PAUSED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    { providerId: input.providerId, pausedAt: input.pausedAt.toISOString(), reason: input.reason },
  );
}

export function buildPartnerResumedEvent(input: {
  providerId: string;
  resumedAt: Date;
}): HomigoEvent<PartnerResumedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_RESUMED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    { providerId: input.providerId, resumedAt: input.resumedAt.toISOString() },
  );
}

export function buildPartnerAvailabilityUpdatedEvent(input: {
  providerId: string;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}): HomigoEvent<PartnerAvailabilityUpdatedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    {
      providerId: input.providerId,
      workingDays: input.workingDays,
      workingHoursStart: input.workingHoursStart,
      workingHoursEnd: input.workingHoursEnd,
    },
  );
}

export function buildPartnerServiceAreaUpdatedEvent(input: {
  providerId: string;
  serviceRegions: string[];
  serviceRadiusKm: number | null;
}): HomigoEvent<PartnerServiceAreaUpdatedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    {
      providerId: input.providerId,
      serviceRegions: input.serviceRegions,
      serviceRadiusKm: input.serviceRadiusKm,
    },
  );
}

export function buildPartnerCapacityChangedEvent(input: {
  providerId: string;
  currentJobs: number;
  availableSlots: number;
  utilization: number;
}): HomigoEvent<PartnerCapacityChangedPayload> {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_CAPACITY_CHANGED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    {
      providerId: input.providerId,
      currentJobs: input.currentJobs,
      availableSlots: input.availableSlots,
      utilization: input.utilization,
    },
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
  enRouteSource?: EnRouteSource;
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
      // Defaults to the GPS path: the only pre-existing producer is the geofence.
      enRouteSource: input.enRouteSource ?? "gps_geofence",
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
  arrivalSource?: ArrivalSource;
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
      arrivalSource: input.arrivalSource ?? "gps_geofence",
      hourOfDay: arrivedAt.getHours(),
      dayOfWeek: arrivedAt.getDay(),
    },
    input.bookingId,
  );
}
