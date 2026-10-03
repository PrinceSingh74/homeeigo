/** Phase 0 domain event type constants — homigo.{domain}.{action} */
export const EVENT_TYPES = {
  BOOKING_CREATED: "homigo.booking.created",
  BOOKING_ASSIGNED: "homigo.booking.assigned",
  BOOKING_STARTED: "homigo.booking.started",
  BOOKING_COMPLETED: "homigo.booking.completed",
  BOOKING_CANCELLED: "homigo.booking.cancelled",
  /**
   * A booking's appointment moved. The name is not new: the AI tool catalogue already declares
   * `eventMapping: "homigo.booking.rescheduled"` for `write.booking.rescheduleBooking`, an event
   * nothing emitted — so a schedule change reached no consumer at all.
   */
  BOOKING_RESCHEDULED: "homigo.booking.rescheduled",
  /** The payment window closed with nothing captured; the booking's capacity was released. */
  BOOKING_PAYMENT_EXPIRED: "homigo.booking.payment_expired",
  /** Phase 10 §11: a customer reported an issue with a completed booking (complaint / warranty claim case). */
  BOOKING_CASE_OPENED: "homigo.booking.case.opened",
  /** Phase 10 §11: a case was closed with a decision (rework, revisit, refund, rejection or no action). */
  BOOKING_CASE_RESOLVED: "homigo.booking.case.resolved",
  PAYMENT_SUCCESS: "homigo.payment.success",
  PAYMENT_FAILED: "homigo.payment.failed",
  /**
   * The customer asked the backend to open a gateway order for a booking they had not paid for.
   *
   * Deliberately not a page view: this fires from `paymentService.createOrder`, the authoritative
   * boundary where a real Razorpay order is created against a real booking. A UI rerender, a
   * revisit, or a customer merely looking at checkout produces nothing.
   */
  CHECKOUT_STARTED: "homigo.checkout.started",
  PARTNER_ONLINE: "homigo.partner.online",
  PARTNER_OFFLINE: "homigo.partner.offline",
  PARTNER_PAUSED: "homigo.partner.paused",
  PARTNER_RESUMED: "homigo.partner.resumed",
  PARTNER_AVAILABILITY_UPDATED: "homigo.partner.availability.updated",
  PARTNER_SERVICE_AREA_UPDATED: "homigo.partner.service_area.updated",
  PARTNER_CAPACITY_CHANGED: "homigo.partner.capacity.changed",
  PARTNER_DISPATCHED: "homigo.partner.dispatched",
  PARTNER_PRESENCE_STALE: "homigo.partner.presence.stale",
  PARTNER_PRESENCE_EXPIRED: "homigo.partner.presence.expired",
  PARTNER_LOCATION_STALE: "homigo.partner.location.stale",
  PARTNER_DISPATCH_ELIGIBILITY_CHANGED: "homigo.partner.dispatch_eligibility.changed",
  PARTNER_EN_ROUTE: "homigo.partner.en_route",
  PARTNER_ARRIVED: "homigo.partner.arrived",
  BOOKING_CHAT_MESSAGE_SENT: "homigo.booking.chat.message_sent",
  FIELD_EVIDENCE_CREATED: "homigo.field.evidence.created",
  PARTNER_LEAD_CREATED: "homigo.partner.lead.created",
  PARTNER_LEAD_CONTACTED: "homigo.partner.lead.contacted",
  PARTNER_LEAD_INTERESTED: "homigo.partner.lead.interested",
  PARTNER_LEAD_STATUS_CHANGED: "homigo.partner.lead.status_changed",
  PARTNER_LEAD_DUPLICATE_DETECTED: "homigo.partner.lead.duplicate_detected",
  PARTNER_LEAD_MERGED: "homigo.partner.lead.merged",
  PARTNER_APPLICATION_CREATED: "homigo.partner.application.created",
  PARTNER_APPLICATION_STARTED: "homigo.partner.application.started",
  PARTNER_APPLICATION_SUBMITTED: "homigo.partner.application.submitted",
  PARTNER_APPLICATION_APPROVED: "homigo.partner.application.approved",
  PARTNER_APPLICATION_REJECTED: "homigo.partner.application.rejected",
  PARTNER_APPLICATION_CHANGES_REQUESTED: "homigo.partner.application.changes_requested",
  PARTNER_KYC_SUBMITTED: "homigo.partner.kyc.submitted",
  PARTNER_KYC_VERIFIED: "homigo.partner.kyc.verified",
  PARTNER_KYC_REJECTED: "homigo.partner.kyc.rejected",
  PARTNER_ASSESSMENT_COMPLETED: "homigo.partner.assessment.completed",
  PARTNER_TRAINING_COMPLETED: "homigo.partner.training.completed",
  PARTNER_ACTIVATED: "homigo.partner.activated",
  /** Emitted once when a partner becomes operational — distinct from application.created. */
  PARTNER_CREATED: "homigo.partner.created",
  PARTNER_APPLICATION_UPDATED: "homigo.partner.application.updated",
  /**
   * Phase 16 — the two producers that were missing.
   *
   * Support tickets and operational alerts were written directly to their tables and never
   * published, so nothing downstream could react to them. Both are now emitted through the
   * transactional outbox from the authoritative write path.
   *
   * `OPS_ALERT_RAISED` fires only when a row is actually created: `opsAlertService.raise`
   * suppresses after 5 unresolved alerts of a type in an hour and returns null, and an event for
   * a suppressed alert would be an event for something that did not happen.
   */
  SUPPORT_TICKET_CREATED: "homigo.support.ticket.created",
  OPS_ALERT_RAISED: "homigo.ops.alert.raised",
  PARTNER_RATING_RECEIVED: "homigo.partner.rating.received",
  PARTNER_EARNINGS_POSTED: "homigo.partner.earnings.posted",
  PARTNER_PAYOUT_CREATED: "homigo.partner.payout.created",
  PARTNER_PAYOUT_PROCESSING: "homigo.partner.payout.processing",
  PARTNER_PAYOUT_PAID: "homigo.partner.payout.paid",
  PARTNER_PAYOUT_FAILED: "homigo.partner.payout.failed",
  PARTNER_INCENTIVE_QUALIFIED: "homigo.partner.incentive.qualified",
  PARTNER_INCENTIVE_PAID: "homigo.partner.incentive.paid",
  PARTNER_SUSPENDED: "homigo.partner.suspended",
  PARTNER_REACTIVATED: "homigo.partner.reactivated",
  PARTNER_COMPLIANCE_EXPIRING: "homigo.partner.compliance.expiring",
  PARTNER_COMPLIANCE_EXPIRED: "homigo.partner.compliance.expired",
  PARTNER_RESTRICTED: "homigo.partner.restricted",
  PARTNER_UNRESTRICTED: "homigo.partner.unrestricted",
  PARTNER_RISK_UPDATED: "homigo.partner.risk.updated",
  PARTNER_SAFETY_INCIDENT_CREATED: "homigo.partner.safety.incident.created",
  PARTNER_SOS_CREATED: "homigo.partner.sos.created",
  PARTNER_SAFETY_INCIDENT_RESOLVED: "homigo.partner.safety.incident.resolved",
  PARTNER_SCORE_UPDATED: "homigo.partner.score.updated",
  PARTNER_LEVEL_CHANGED: "homigo.partner.level.changed",
  PARTNER_LIFECYCLE_CHANGED: "homigo.partner.lifecycle.changed",
  PARTNER_REFERRAL_INVITED: "homigo.partner.referral.invited",
  PARTNER_REFERRAL_REGISTERED: "homigo.partner.referral.registered",
  PARTNER_REFERRAL_VERIFIED: "homigo.partner.referral.verified",
  PARTNER_REFERRAL_TRAINING: "homigo.partner.referral.training",
  PARTNER_REFERRAL_ACTIVATED: "homigo.partner.referral.activated",
  PARTNER_REFERRAL_FIRST_JOB: "homigo.partner.referral.first_job",
  PARTNER_REFERRAL_QUALIFIED: "homigo.partner.referral.qualified",
  PARTNER_REFERRAL_REWARDED: "homigo.partner.referral.rewarded",
  PARTNER_REFERRAL_FLAGGED: "homigo.partner.referral.flagged",
  /**
   * A partner's local morning has arrived and their brief is due.
   *
   * Declared, and deliberately emitted by nothing. Every other type in this catalog is published by
   * a business action that has already happened; this one would have to be published by a clock, and
   * no clock is allowed to publish it until a human sets `morningSchedule.localTime` — which is
   * currently UNSET, because no morning time has ever been decided for this platform.
   *
   * Registering the type now is what lets the workflow, its trigger and its tests be real rather
   * than hypothetical: `morning_intelligence.v1` is genuinely registered and genuinely inert, which
   * is a state the engine can prove. An unemitted event starts nothing.
   */
  PARTNER_MORNING_INTELLIGENCE_DUE: "homigo.partner.morning_intelligence.due",
  /**
   * A zone's demand pressure crossed the alert policy's threshold.
   *
   * Declared and published by nothing, for a different reason than the morning event above. There a
   * clock was missing; here the *semantics* are missing. Surge is derived state, not an action: no
   * single business event means "surge started". The candidates that move its inputs —
   * BOOKING_CREATED, PARTNER_ONLINE, PARTNER_OFFLINE — fire on ordinary traffic, so publishing a
   * surge event from any of them would turn a per-booking action into a per-booking zone evaluation
   * and make this the highest-frequency producer in the catalog.
   *
   * Deciding what constitutes a transition — and therefore what may publish this — needs the
   * threshold and hysteresis that `surgeAlertPolicy` records as UNSET. Until then the type exists so
   * the workflow and its trigger are real and inert, and no producer exists at all.
   */
  PARTNER_ZONE_SURGE_DETECTED: "homigo.partner.zone_surge.detected",
  ETA_LABEL_CREATED: "homigo.eta.label.created",
  ETA_TRIP_COMPLETED: "homigo.eta.trip.completed",
  ETA_FEATURE_UPDATED: "homigo.eta.feature.updated",
  /**
   * Phase 10 §10 — the customer-confirmation axis of a completed booking. Confirmed by the customer,
   * or auto-confirmed by the scheduler when the confirmation window closed (recorded, never silent).
   */
  BOOKING_COMPLETION_CONFIRMED: "homigo.booking.completion_confirmed",
  BOOKING_COMPLETION_AUTO_CONFIRMED: "homigo.booking.completion_auto_confirmed",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const EVENT_VERSION = "1.0";

export const EVENT_SOURCES = {
  BOOKING: "homigo/booking-service",
  PAYMENT: "homigo/payment-service",
  ASSIGNMENT: "homigo/assignment-engine",
  PROVIDER: "homigo/provider-service",
  PARTNER_ACQUISITION: "homigo/partner-acquisition-service",
  TRACKING: "homigo/tracking-service",
  ETA_INTELLIGENCE: "homigo/eta-intelligence",
  SAFETY: "homigo/safety-service",
  COMPLIANCE: "homigo/compliance-service",
  FINANCE: "homigo/finance-service",
  RATING: "homigo/rating-service",
  SUPPORT: "homigo/support-service",
  OPERATIONS: "homigo/operations-service",
} as const;
