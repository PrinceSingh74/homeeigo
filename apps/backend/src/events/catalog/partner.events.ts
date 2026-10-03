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

export function buildPartnerComplianceExpiringEvent(input: {
  providerId: string;
  documentId: string;
  documentType: string;
  window: string;
  daysToExpiry: number;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    EVENT_SOURCES.COMPLIANCE,
    input.providerId,
    {
      providerId: input.providerId,
      documentId: input.documentId,
      documentType: input.documentType,
      window: input.window,
      daysToExpiry: input.daysToExpiry,
    },
  );
}

export function buildPartnerComplianceExpiredEvent(input: {
  providerId: string;
  documentId: string;
  documentType: string;
  expiredAt: Date;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRED,
    EVENT_SOURCES.COMPLIANCE,
    input.providerId,
    {
      providerId: input.providerId,
      documentId: input.documentId,
      documentType: input.documentType,
      expiredAt: input.expiredAt.toISOString(),
    },
  );
}

export function buildPartnerRestrictedEvent(input: {
  providerId: string;
  reason: string;
  source: string;
  documentId?: string;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_RESTRICTED,
    EVENT_SOURCES.COMPLIANCE,
    input.providerId,
    {
      providerId: input.providerId,
      reason: input.reason,
      source: input.source,
      documentId: input.documentId ?? null,
    },
  );
}

export function buildPartnerUnrestrictedEvent(input: {
  providerId: string;
  reason: string;
  actorId: string;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_UNRESTRICTED,
    EVENT_SOURCES.COMPLIANCE,
    input.providerId,
    {
      providerId: input.providerId,
      reason: input.reason,
      actorId: input.actorId,
    },
  );
}

export function buildPartnerRiskUpdatedEvent(input: {
  providerId: string;
  riskLevel: string;
  reviewStatus: string;
  signalCount: number;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_RISK_UPDATED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    {
      providerId: input.providerId,
      riskLevel: input.riskLevel,
      reviewStatus: input.reviewStatus,
      signalCount: input.signalCount,
    },
  );
}

export function buildPartnerSosCreatedEvent(input: {
  providerId: string;
  incidentId: string;
  bookingId: string | null;
  hasLocation: boolean;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_SOS_CREATED,
    EVENT_SOURCES.SAFETY,
    input.providerId,
    {
      providerId: input.providerId,
      incidentId: input.incidentId,
      bookingId: input.bookingId,
      hasLocation: input.hasLocation,
    },
    input.bookingId ?? undefined,
  );
}

export function buildPartnerSafetyIncidentCreatedEvent(input: {
  providerId: string;
  incidentId: string;
  type: string;
  severity: string;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_SAFETY_INCIDENT_CREATED,
    EVENT_SOURCES.SAFETY,
    input.providerId,
    {
      providerId: input.providerId,
      incidentId: input.incidentId,
      incidentType: input.type,
      severity: input.severity,
    },
  );
}

export function buildPartnerSafetyIncidentResolvedEvent(input: {
  providerId: string;
  incidentId: string;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_SAFETY_INCIDENT_RESOLVED,
    EVENT_SOURCES.SAFETY,
    input.providerId,
    {
      providerId: input.providerId,
      incidentId: input.incidentId,
    },
  );
}

export function buildPartnerReferralEvent(input: {
  type: string;
  referralId: string;
  referrerProviderId: string;
  referredProviderId: string | null;
  status: string;
}) {
  return partnerEnvelope(input.type, EVENT_SOURCES.PARTNER_ACQUISITION, input.referrerProviderId, {
    referralId: input.referralId,
    referrerProviderId: input.referrerProviderId,
    referredProviderId: input.referredProviderId,
    status: input.status,
  });
}

export function buildPartnerScoreUpdatedEvent(input: {
  providerId: string;
  previousScore: number | null;
  newScore: number | null;
  band: string;
  policyVersion: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_SCORE_UPDATED, EVENT_SOURCES.PROVIDER, input.providerId, {
    providerId: input.providerId,
    previousScore: input.previousScore,
    newScore: input.newScore,
    band: input.band,
    policyVersion: input.policyVersion,
  });
}

export function buildPartnerLevelChangedEvent(input: {
  providerId: string;
  previousLevel: string;
  newLevel: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_LEVEL_CHANGED, EVENT_SOURCES.PROVIDER, input.providerId, {
    providerId: input.providerId,
    previousLevel: input.previousLevel,
    newLevel: input.newLevel,
  });
}

export function buildPartnerLifecycleChangedEvent(input: {
  providerId: string;
  previousState: string;
  newState: string;
  reasonCode: string;
  actorType: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_LIFECYCLE_CHANGED, EVENT_SOURCES.PROVIDER, input.providerId, {
    providerId: input.providerId,
    previousState: input.previousState,
    newState: input.newState,
    reasonCode: input.reasonCode,
    actorType: input.actorType,
  });
}

export function buildPartnerCreatedEvent(input: { providerId: string; leadId?: string | null }) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_CREATED, EVENT_SOURCES.PARTNER_ACQUISITION, input.providerId, {
    providerId: input.providerId,
    leadId: input.leadId ?? null,
  });
}

export function buildPartnerApplicationUpdatedEvent(input: {
  providerId: string;
  field: string;
  previousValue?: string | null;
  newValue?: string | null;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_APPLICATION_UPDATED, EVENT_SOURCES.PARTNER_ACQUISITION, input.providerId, {
    providerId: input.providerId,
    field: input.field,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
  });
}

export function buildPartnerRatingReceivedEvent(input: {
  providerId: string;
  bookingId: string;
  ratingId: string;
  stars: number;
  previousRating: number | null;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_RATING_RECEIVED,
    EVENT_SOURCES.RATING,
    input.providerId,
    {
      providerId: input.providerId,
      bookingId: input.bookingId,
      ratingId: input.ratingId,
      stars: input.stars,
      previousRating: input.previousRating,
    },
    input.bookingId,
  );
}

export function buildPartnerEarningsPostedEvent(input: {
  providerId: string;
  bookingId: string;
  earningId: string;
  netEarning: number;
  grossAmount: number;
}) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_EARNINGS_POSTED,
    EVENT_SOURCES.FINANCE,
    input.providerId,
    {
      providerId: input.providerId,
      bookingId: input.bookingId,
      earningId: input.earningId,
      netEarning: input.netEarning,
      grossAmount: input.grossAmount,
    },
    input.bookingId,
  );
}

export type PartnerPayoutPayload = {
  providerId: string;
  withdrawalId: string;
  withdrawalNumber: string;
  amount: number;
  netAmount: number;
  failureReason?: string | null;
};

export function buildPartnerPayoutCreatedEvent(input: PartnerPayoutPayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PAYOUT_CREATED, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    withdrawalId: input.withdrawalId,
    withdrawalNumber: input.withdrawalNumber,
    amount: input.amount,
    netAmount: input.netAmount,
  });
}

export function buildPartnerPayoutProcessingEvent(input: PartnerPayoutPayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PAYOUT_PROCESSING, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    withdrawalId: input.withdrawalId,
    withdrawalNumber: input.withdrawalNumber,
    amount: input.amount,
    netAmount: input.netAmount,
  });
}

export function buildPartnerPayoutPaidEvent(input: PartnerPayoutPayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PAYOUT_PAID, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    withdrawalId: input.withdrawalId,
    withdrawalNumber: input.withdrawalNumber,
    amount: input.amount,
    netAmount: input.netAmount,
  });
}

export function buildPartnerPayoutFailedEvent(input: PartnerPayoutPayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PAYOUT_FAILED, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    withdrawalId: input.withdrawalId,
    withdrawalNumber: input.withdrawalNumber,
    amount: input.amount,
    netAmount: input.netAmount,
    failureReason: input.failureReason ?? null,
  });
}

export function buildPartnerIncentiveQualifiedEvent(input: {
  providerId: string;
  ruleId: string;
  ruleCode: string;
  amount: number;
  periodKey: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_INCENTIVE_QUALIFIED, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    ruleId: input.ruleId,
    ruleCode: input.ruleCode,
    amount: input.amount,
    periodKey: input.periodKey,
  });
}

export function buildPartnerIncentivePaidEvent(input: {
  providerId: string;
  payoutId: string;
  ruleCode: string;
  amount: number;
  periodKey: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_INCENTIVE_PAID, EVENT_SOURCES.FINANCE, input.providerId, {
    providerId: input.providerId,
    payoutId: input.payoutId,
    ruleCode: input.ruleCode,
    amount: input.amount,
    periodKey: input.periodKey,
  });
}

export function buildPartnerSuspendedEvent(input: {
  providerId: string;
  previousState: string;
  reasonCode: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_SUSPENDED, EVENT_SOURCES.PROVIDER, input.providerId, {
    providerId: input.providerId,
    previousState: input.previousState,
    reasonCode: input.reasonCode,
  });
}

export function buildPartnerReactivatedEvent(input: {
  providerId: string;
  previousState: string;
  reasonCode: string;
}) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_REACTIVATED, EVENT_SOURCES.PROVIDER, input.providerId, {
    providerId: input.providerId,
    previousState: input.previousState,
    reasonCode: input.reasonCode,
  });
}

export type PartnerPresenceStalePayload = {
  providerId: string;
  detectedAt: string;
  lastHeartbeatAt: string | null;
};

export type PartnerLocationStalePayload = {
  providerId: string;
  detectedAt: string;
  lastLocationAt: string | null;
};

export type PartnerDispatchEligibilityChangedPayload = {
  providerId: string;
  eligible: boolean;
  reasons: string[];
  changedAt: string;
  bookingId?: string;
  correlationId?: string;
  requestId?: string;
  previousEligible?: boolean;
};

export function buildPartnerPresenceStaleEvent(input: PartnerPresenceStalePayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PRESENCE_STALE, EVENT_SOURCES.PROVIDER, input.providerId, input);
}

/**
 * Presence past the expiry threshold. Liveness evidence only — consumers must never treat
 * this as a lifecycle suspension or an availability change.
 */
export function buildPartnerPresenceExpiredEvent(input: PartnerPresenceStalePayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_PRESENCE_EXPIRED, EVENT_SOURCES.PROVIDER, input.providerId, input);
}

export function buildPartnerLocationStaleEvent(input: PartnerLocationStalePayload) {
  return partnerEnvelope(EVENT_TYPES.PARTNER_LOCATION_STALE, EVENT_SOURCES.PROVIDER, input.providerId, input);
}

export function buildPartnerDispatchEligibilityChangedEvent(input: PartnerDispatchEligibilityChangedPayload) {
  return partnerEnvelope(
    EVENT_TYPES.PARTNER_DISPATCH_ELIGIBILITY_CHANGED,
    EVENT_SOURCES.PROVIDER,
    input.providerId,
    input,
  );
}
