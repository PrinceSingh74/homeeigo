/** Phase 0 domain event type constants — homigo.{domain}.{action} */
export const EVENT_TYPES = {
  BOOKING_CREATED: "homigo.booking.created",
  BOOKING_ASSIGNED: "homigo.booking.assigned",
  BOOKING_STARTED: "homigo.booking.started",
  BOOKING_COMPLETED: "homigo.booking.completed",
  BOOKING_CANCELLED: "homigo.booking.cancelled",
  PAYMENT_SUCCESS: "homigo.payment.success",
  PAYMENT_FAILED: "homigo.payment.failed",
  PARTNER_ONLINE: "homigo.partner.online",
  PARTNER_OFFLINE: "homigo.partner.offline",
  PARTNER_DISPATCHED: "homigo.partner.dispatched",
  PARTNER_EN_ROUTE: "homigo.partner.en_route",
  PARTNER_ARRIVED: "homigo.partner.arrived",
  ETA_LABEL_CREATED: "eta.label.created",
  ETA_TRIP_COMPLETED: "eta.trip.completed",
  ETA_FEATURE_UPDATED: "eta.feature.updated",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const EVENT_VERSION = "1.0";

export const EVENT_SOURCES = {
  BOOKING: "homigo/booking-service",
  PAYMENT: "homigo/payment-service",
  ASSIGNMENT: "homigo/assignment-engine",
  PROVIDER: "homigo/provider-service",
  TRACKING: "homigo/tracking-service",
  ETA_INTELLIGENCE: "homigo/eta-intelligence",
} as const;
