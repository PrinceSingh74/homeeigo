import { EVENT_TYPES } from "./event-types";

/**
 * Section 09 — canonical partner event catalog.
 *
 * Maps product-facing event names to the homigo.* types the platform actually publishes.
 * Prefer extending an existing type over introducing a parallel producer.
 */

export type PartnerEventDomain =
  | "acquisition"
  | "operations"
  | "execution"
  | "finance"
  | "trust"
  | "growth"
  | "network"
  | "intelligence";

export type CanonicalPartnerEvent = {
  /** Product name: partner.<domain>.<action> */
  canonical: string;
  /** Runtime homigo.* type (source of truth) */
  runtimeType: string;
  domain: PartnerEventDomain;
  version: string;
  producer: string;
  /**
   * ACTIVE — a domain service actually emits this.
   * POLICY_PENDING — type and workflow exist; no producer until business policy is set.
   * Omit for ACTIVE (the default).
   */
  producerStatus?: "ACTIVE" | "POLICY_PENDING";
  /** When canonical differs from runtime, explains the mapping */
  notes?: string;
};

/** Section 09 canonical catalog — every partner-facing lifecycle event. */
export const CANONICAL_PARTNER_EVENTS: readonly CanonicalPartnerEvent[] = [
  {
    canonical: "partner.created",
    runtimeType: EVENT_TYPES.PARTNER_CREATED,
    domain: "acquisition",
    version: "1.0",
    producer: "partner-acquisition-events.service",
    notes: "Emitted when a partner record becomes operational (alongside partner.activated).",
  },
  {
    canonical: "partner.application.created",
    runtimeType: EVENT_TYPES.PARTNER_APPLICATION_CREATED,
    domain: "acquisition",
    version: "1.0",
    producer: "partner-acquisition-events.service",
  },
  {
    canonical: "partner.application.updated",
    runtimeType: EVENT_TYPES.PARTNER_APPLICATION_UPDATED,
    domain: "acquisition",
    version: "1.0",
    producer: "partner-acquisition-events.service",
  },
  {
    canonical: "partner.verified",
    runtimeType: EVENT_TYPES.PARTNER_KYC_VERIFIED,
    domain: "trust",
    version: "1.0",
    producer: "partner-acquisition-events.service",
    notes: "Canonical alias for homigo.partner.kyc.verified.",
  },
  {
    canonical: "partner.activated",
    runtimeType: EVENT_TYPES.PARTNER_ACTIVATED,
    domain: "growth",
    version: "1.0",
    producer: "partner-acquisition-events.service / partner-lifecycle.service",
  },
  {
    canonical: "partner.online",
    runtimeType: EVENT_TYPES.PARTNER_ONLINE,
    domain: "operations",
    version: "1.0",
    producer: "partner-operations.service",
  },
  {
    canonical: "partner.offline",
    runtimeType: EVENT_TYPES.PARTNER_OFFLINE,
    domain: "operations",
    version: "1.0",
    producer: "partner-operations.service",
  },
  {
    canonical: "partner.job.offered",
    runtimeType: EVENT_TYPES.PARTNER_DISPATCHED,
    domain: "execution",
    version: "1.0",
    producer: "assignment-engine.service",
    notes: "Paired with homigo.booking.assigned.",
  },
  {
    canonical: "partner.job.accepted",
    runtimeType: EVENT_TYPES.BOOKING_ASSIGNED,
    domain: "execution",
    version: "1.0",
    producer: "booking.service",
    notes: "Booking assigned to partner — canonical acceptance boundary.",
  },
  {
    canonical: "partner.job.arrived",
    runtimeType: EVENT_TYPES.PARTNER_ARRIVED,
    domain: "execution",
    version: "1.0",
    producer: "tracking.service",
  },
  {
    canonical: "partner.job.started",
    runtimeType: EVENT_TYPES.BOOKING_STARTED,
    domain: "execution",
    version: "1.0",
    producer: "booking.service",
  },
  {
    canonical: "partner.job.completed",
    runtimeType: EVENT_TYPES.BOOKING_COMPLETED,
    domain: "execution",
    version: "1.0",
    producer: "booking.service",
  },
  {
    canonical: "partner.job.cancelled",
    runtimeType: EVENT_TYPES.BOOKING_CANCELLED,
    domain: "execution",
    version: "1.0",
    producer: "booking.service",
  },
  {
    canonical: "partner.rating.received",
    runtimeType: EVENT_TYPES.PARTNER_RATING_RECEIVED,
    domain: "growth",
    version: "1.0",
    producer: "rating.service",
  },
  {
    canonical: "partner.performance.changed",
    runtimeType: EVENT_TYPES.PARTNER_SCORE_UPDATED,
    domain: "growth",
    version: "1.0",
    producer: "partner-score.service",
    notes: "Canonical alias for homigo.partner.score.updated.",
  },
  {
    canonical: "partner.earnings.posted",
    runtimeType: EVENT_TYPES.PARTNER_EARNINGS_POSTED,
    domain: "finance",
    version: "1.0",
    producer: "booking.service",
  },
  {
    canonical: "partner.payout.created",
    runtimeType: EVENT_TYPES.PARTNER_PAYOUT_CREATED,
    domain: "finance",
    version: "1.0",
    producer: "provider-wallet-reservation.service",
  },
  {
    canonical: "partner.payout.processing",
    runtimeType: EVENT_TYPES.PARTNER_PAYOUT_PROCESSING,
    domain: "finance",
    version: "1.0",
    producer: "earnings.service",
  },
  {
    canonical: "partner.payout.paid",
    runtimeType: EVENT_TYPES.PARTNER_PAYOUT_PAID,
    domain: "finance",
    version: "1.0",
    producer: "earnings.service",
  },
  {
    canonical: "partner.payout.failed",
    runtimeType: EVENT_TYPES.PARTNER_PAYOUT_FAILED,
    domain: "finance",
    version: "1.0",
    producer: "earnings.service",
  },
  {
    canonical: "partner.kyc.expiring",
    runtimeType: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRING,
    domain: "trust",
    version: "1.0",
    producer: "compliance-expiry.service",
    notes: "Canonical alias for homigo.partner.compliance.expiring.",
  },
  {
    canonical: "partner.kyc.expired",
    runtimeType: EVENT_TYPES.PARTNER_COMPLIANCE_EXPIRED,
    domain: "trust",
    version: "1.0",
    producer: "compliance-expiry.service",
  },
  {
    canonical: "partner.incentive.qualified",
    runtimeType: EVENT_TYPES.PARTNER_INCENTIVE_QUALIFIED,
    domain: "finance",
    version: "1.0",
    producer: "partner-incentive-payout.service",
  },
  {
    canonical: "partner.incentive.paid",
    runtimeType: EVENT_TYPES.PARTNER_INCENTIVE_PAID,
    domain: "finance",
    version: "1.0",
    producer: "partner-incentive-payout.service",
  },
  {
    canonical: "partner.referral.created",
    runtimeType: EVENT_TYPES.PARTNER_REFERRAL_INVITED,
    domain: "network",
    version: "1.0",
    producer: "partner-referral consumer chain",
  },
  {
    canonical: "partner.referral.qualified",
    runtimeType: EVENT_TYPES.PARTNER_REFERRAL_QUALIFIED,
    domain: "network",
    version: "1.0",
    producer: "partner-referral consumer",
  },
  {
    canonical: "partner.referral.rewarded",
    runtimeType: EVENT_TYPES.PARTNER_REFERRAL_REWARDED,
    domain: "network",
    version: "1.0",
    producer: "partner-referral consumer",
  },
  {
    canonical: "partner.suspended",
    runtimeType: EVENT_TYPES.PARTNER_SUSPENDED,
    domain: "growth",
    version: "1.0",
    producer: "partner-lifecycle.service",
    notes: "Emitted when lifecycle transitions to SUSPENDED.",
  },
  {
    canonical: "partner.reactivated",
    runtimeType: EVENT_TYPES.PARTNER_REACTIVATED,
    domain: "growth",
    version: "1.0",
    producer: "partner-lifecycle.service",
    notes: "Emitted when lifecycle returns to ACTIVE from SUSPENDED.",
  },
  {
    canonical: "partner.sos.created",
    runtimeType: EVENT_TYPES.PARTNER_SOS_CREATED,
    domain: "trust",
    version: "1.0",
    producer: "partner-safety.service",
  },
  {
    canonical: "partner.safety.incident.created",
    runtimeType: EVENT_TYPES.PARTNER_SAFETY_INCIDENT_CREATED,
    domain: "trust",
    version: "1.0",
    producer: "partner-safety.service",
  },
  {
    canonical: "demand.spike",
    runtimeType: EVENT_TYPES.PARTNER_ZONE_SURGE_DETECTED,
    domain: "intelligence",
    version: "1.0",
    producer: "declared — no producer until surge policy approved",
    producerStatus: "POLICY_PENDING",
    notes: "Maps to homigo.partner.zone_surge.detected when threshold policy is set. Do not invent a producer.",
  },
] as const;

export function lookupCanonicalEvent(canonical: string): CanonicalPartnerEvent | undefined {
  return CANONICAL_PARTNER_EVENTS.find((e) => e.canonical === canonical);
}

export function runtimeTypeForCanonical(canonical: string): string | undefined {
  return lookupCanonicalEvent(canonical)?.runtimeType;
}

export function listCanonicalPartnerEvents(): Array<CanonicalPartnerEvent & { producerStatus: "ACTIVE" | "POLICY_PENDING" }> {
  return CANONICAL_PARTNER_EVENTS.map((e) => ({
    ...e,
    producerStatus: e.producerStatus ?? "ACTIVE",
  }));
}
