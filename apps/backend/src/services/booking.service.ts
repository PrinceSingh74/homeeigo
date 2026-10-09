import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  PaymentStatus,
  Prisma,
  TrackingStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { isBusinessRow } from "../lib/analytics-scope";
import { nextBookingNumber } from "../lib/booking-number";
import { bookingStatusApi, paymentStatusApi } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { notificationService } from "./notification.service";
import { emailDeliveryService } from "./email-delivery.service";
import { bookingValidationService, slotDurationFor } from "./booking-validation.service";
import { isReschedulableBookingStatus } from "../lib/booking-state-machine";
import { bookingIdempotencyService, bookingRequestFingerprint } from "./booking-idempotency.service";
import { BUSINESS_TIMEZONE, DEFAULT_MAX_ADVANCE_DAYS } from "../lib/service-availability";
import {
  evaluatePaymentGate,
  hasAuditedPaymentGateOverride,
  isNoPaymentFollowUp,
  isPaymentReturned,
  isSettled,
  PAYMENT_GATE_REASON,
  paymentExemptBookingIds,
} from "./booking-payment-gate";
import { partnerFollowUpFromSnapshot } from "../lib/booking-case-policy";
import { earningsService } from "./earnings.service";
import { referralService } from "./referral.service";
import { hcoinService } from "./hcoin.service";
import { entitlementService, BENEFIT } from "./entitlement.service";
import { bookingPriorityService } from "./booking-priority.service";
import { addressPiiService } from "./address-pii.service";
import { assignmentEngine } from "./assignment-engine.service";
import { partnerOperationsService } from "./partner-operations.service";
import { incCounter, observeHist } from "../lib/metrics";
import { getBookingKind, isFollowUpKind } from "../lib/booking-volume";
import { MATCHING_REJECTION_REASONS, type MatchingRejectionReason } from "../lib/provider-capability";
import { coverageAllowsAddress } from "../lib/service-catalog-config";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { bookingConfigSnapshot, partnerJobBrief } from "../lib/service-domain";
import { verifyQuote } from "../lib/quote-token";
import { customerPolicyService } from "./customer-policy.service";
import { blockingRequirementCodes, buildRequirementsSnapshot, customerRequirementsFromSnapshot, partnerRequirementsFromSnapshot } from "../lib/service-requirements";
import { bookingRequirementService } from "./booking-requirement.service";
import { bookingExecutionService } from "./booking-execution.service";
import { bookingSafetyService } from "./booking-safety.service";
import { buildExecutionSnapshot } from "../lib/service-execution";
import type { GateResult } from "../lib/requirement-gates";
import { partnerExecutionFromSnapshot, qualityBlocksCompletion, qualityFromSnapshot, warrantyWindow } from "../lib/service-runtime-policy";
import { resolveQualityEvidence } from "../lib/quality-evidence";
import { bookingQualityService, lockBookingRow } from "./booking-quality.service";
import { bookingCompletionService, warrantyTablePresent } from "./booking-completion.service";
import { QualityVerdictError, verdictAllowsCompletion } from "../lib/quality-verdict";
import { SafetyGateError } from "../lib/service-safety";
import { ExecutionGateError } from "../lib/service-execution";
import { publishBookingStatusBackground } from "../lib/booking-realtime";
import { knownCoords } from "../lib/geo-unknown";
import { membershipCouponService } from "./membership-coupon.service";
import { cashbackService } from "./cashback.service";
import { bookingPricingService } from "./booking-pricing.service";
import { isBookingTransitionAllowed } from "../middleware/conflict";
import { sanitizeUserInput } from "../utils/sanitizer";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { toWaitTimeMsBigInt } from "../lib/wait-time-ms";
import {
  ACTIVE_FULFILMENT_STATUSES,
  collectForbiddenPartnerKeys,
  partnerCancellationReason,
  partnerCustomerStage,
  partnerJobNote,
  stripForbiddenPartnerKeys,
  toCustomerSafePartner,
  toPartnerSafeAddress,
  toPartnerSafeCustomer,
  withoutCustomerMoney,
} from "../lib/privacy-policy.engine";

/** Partners may accept shortly after a dispatch timeout while the UI refreshes. */
const ASSIGN_ACCEPT_GRACE_MS = Number(process.env.ASSIGNMENT_ACCEPT_GRACE_MS || 5 * 60 * 1000);
import { resolveBookingCancelActor } from "../lib/booking-cancel-auth";
import { evictProviderFromBooking } from "../lib/ws-eviction";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import type { AdminRefundPolicy, CancellationActor } from "./cancellation-policy.service";
import { bookingRefundService, PAID_BOOKING_STATUSES, UNPAID_CANCEL_MESSAGE } from "./booking-refund.service";
import { refundTenderLabel } from "../lib/refund-tender";
import {
  cancellationPolicyService,
  cancellationPolicyFromSnapshot,
  CANCELLATION_POLICY,
} from "./cancellation-policy.service";
import { financialLedgerService } from "./financial-ledger.service";
import { earningsLiveService } from "./earnings-live.service";
import { partnerIncentivePayoutService } from "./partner-incentive-payout.service";
import { userPiiService } from "./user-pii.service";
import { trackingService } from "./tracking.service";
import { logger } from "../lib/logger";
import { getPrismaErrorCode } from "../lib/prisma-errors";
import {
  recordEtaJobStartFallback,
  recordEtaLifecycleTransition,
} from "../lib/eta-metrics";
import { distanceKm as distanceBetweenKm, etaMinutes } from "../lib/geo";
import { fraudContextForUser } from "../lib/fraud-context";
import { withTxRetry } from "../lib/db-retry";
import { withRescheduleGate } from "../lib/reschedule-gate";
import {
  RESCHEDULE_POLICY,
  evaluateReschedule,
  reschedulePolicyFromSnapshot,
} from "../lib/reschedule-policy";
import { isPrismaConnectionExhausted, isRetryablePrismaError } from "../lib/prisma-errors";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import {
  buildBookingAssignedEvent,
  buildBookingCancelledEvent,
  buildBookingCompletedEvent,
  buildBookingCreatedEvent,
  buildBookingRescheduledEvent,
  buildBookingStartedEvent,
} from "../events/catalog/booking.events";

/**
 * Every booking-create refusal reported to the customer as PROVIDER_UNAVAILABLE, labelled by its real
 * cause (2026-10-01). The slot grid does not consult live partner presence while create does, so a
 * slot shown as open can be refused; this counter is how often that — and each other cause — happens.
 */
function countCreateRefusal(reason: string): void {
  incCounter("booking_create_provider_unavailable_total", { reason: reason.slice(0, 64) });
}

/** Tail of the in-process accept queue per booking (see BookingService.accept). */
const acceptQueues = new Map<string, Promise<void>>();

/**
 * Run `fn` after every earlier accept of the same booking in this process has settled. A failure of
 * one accept never blocks the next; the entry is dropped once the queue drains, so the map holds only
 * bookings with an accept in flight.
 */
export function serializeBookingAccept<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
  const previous = acceptQueues.get(bookingId);
  if (previous) incCounter("booking_accept_serialized_total");
  const run = (previous ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  acceptQueues.set(bookingId, tail);
  void tail.then(() => {
    if (acceptQueues.get(bookingId) === tail) acceptQueues.delete(bookingId);
  });
  return run;
}

/** Persist a partner-supplied ETA, or derive one from last GPS + job address. Never write null. */
async function resolveStoredAcceptEta(
  tx: Prisma.TransactionClient,
  assignedProviderId: string,
  addressId: string,
  requested?: number,
): Promise<number | undefined> {
  if (typeof requested === "number" && Number.isFinite(requested)) {
    const n = Math.round(requested);
    if (n >= 1 && n <= 480) return n;
  }
  const [presence, address] = await Promise.all([
    tx.partnerPresence.findUnique({
      where: { providerId: assignedProviderId },
      select: { lastLocationLat: true, lastLocationLng: true },
    }),
    tx.address.findUnique({
      where: { id: addressId },
      select: { latitude: true, longitude: true },
    }),
  ]);
  const from = knownCoords(presence?.lastLocationLat, presence?.lastLocationLng);
  const to = knownCoords(address?.latitude, address?.longitude);
  if (!from || !to) return undefined;
  return Math.min(
    480,
    etaMinutes(distanceBetweenKm(from.latitude, from.longitude, to.latitude, to.longitude)),
  );
}

export class BookingService {
  /**
   * Phase 09 — idempotent entry point.
   *
   * Without an `Idempotency-Key` this is exactly `createBooking`, unchanged. With one, a retry of
   * the SAME request replays the booking the first attempt produced instead of creating a second
   * one, and the same key sent for a DIFFERENT request is refused rather than silently answered
   * with the wrong booking. The guard lives here, not in the route, so every caller is covered.
   */
  async create(
    userId: string,
    body: Parameters<BookingService["createBooking"]>[1] & { idempotencyKey?: string },
  ): Promise<
    | Awaited<ReturnType<BookingService["createBooking"]>>
    | { error: "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_IN_PROGRESS" | "INVALID_IDEMPOTENCY_KEY"; message?: string; booking?: undefined }
    | { booking: ReturnType<BookingService["summary"]>; replayed: true; error?: undefined }
  > {
    const key = body.idempotencyKey;
    if (!key) return this.createBooking(userId, body);

    const fingerprint = bookingRequestFingerprint({
      serviceId: body.serviceId,
      addressId: body.addressId,
      scheduledDate: body.scheduledDate,
      providerId: body.providerId ?? null,
      variantId: body.variantId ?? null,
      quantity: body.quantity ?? null,
      audience: body.audience ?? null,
      professionalPreference: body.professionalPreference ?? null,
      addonIds: body.addonIds ?? null,
      addonQuantities: body.addonQuantities ?? null,
      packagePrice: body.packagePrice ?? null,
      couponCode: body.couponCode ?? null,
      description: body.description ?? null,
    });

    const claim = await bookingIdempotencyService.begin(userId, key, fingerprint);
    if (claim.state === "INVALID_KEY") return { error: "INVALID_IDEMPOTENCY_KEY" as const, message: claim.reason };
    if (claim.state === "KEY_REUSED") return { error: "IDEMPOTENCY_KEY_REUSED" as const };
    // The code the deployed mobile client already understands: its offline queue treats any other
    // 409 as permanent and DROPS the queued booking (lib/offline/queue-core.ts isPermanentFailure).
    if (claim.state === "IN_FLIGHT") return { error: "IDEMPOTENCY_IN_PROGRESS" as const };
    if (claim.state === "REPLAY") {
      const existing = await prisma.booking.findFirst({
        where: { id: claim.bookingId, userId },
        include: { service: true, provider: { include: { user: true } } },
      });
      // The booking the key names is gone (deleted, or never the caller's): replaying it would be a
      // lie, and re-creating silently would defeat the key. Say the key cannot be replayed.
      if (!existing) return { error: "IDEMPOTENCY_KEY_REUSED" as const };
      return { booking: this.summary(existing), replayed: true };
    }

    let result: Awaited<ReturnType<BookingService["createBooking"]>>;
    try {
      result = await this.createBooking(userId, body);
    } catch (err) {
      // Nothing was created, so the key must not stay locked until it expires.
      await bookingIdempotencyService.release(claim.recordId).catch(() => undefined);
      throw err;
    }
    if ("booking" in result && result.booking) {
      await bookingIdempotencyService.complete(claim.recordId, result.booking.id);
    } else {
      await bookingIdempotencyService.release(claim.recordId).catch(() => undefined);
    }
    return result;
  }

  private async createBooking(
    userId: string,
    body: {
      serviceId: string;
      providerId?: string;
      scheduledDate: string;
      addressId: string;
      description?: string;
      paymentMethod?: string;
      couponCode?: string;
      packagePrice?: number;
      variantId?: string;
      quantity?: number;
      audience?: string;
      professionalPreference?: string;
      addonIds?: string[];
      addonQuantities?: Record<string, number>;
      serviceVersion?: number;
      /** Signed quote from POST /api/bookings/price-quote for exactly this selection. */
      quoteToken?: string;
      /** Phase 06: codes of blocking (REQUIRED_BEFORE_BOOKING) requirements the customer confirmed. */
      requirementAttestations?: string[];
      /** Phase D: the customer's statement that a parent/guardian confirms this booking. Recorded as an attestation, not proof. */
      guardianAttested?: boolean;
    },
  ) {
    /**
     * Three independent reads, one round trip.
     *
     * The service lookup, the address lookup (for weather-based surge) and the caller's
     * entitlements depend on nothing but the request, yet ran one after another — three sequential
     * pool acquisitions before any work started. Booking creation is the slowest customer-facing
     * call in the load profile, and this is pure serialisation, not computation.
     */
    // Phase timings (booking_create_phase_seconds{phase}): the create path is the slowest
    // customer-facing call in the load profile and its cost was being guessed at. Cheap: one
    // performance.now() per phase, no allocation on the hot path beyond the histogram sample.
    let phaseMark = performance.now();
    const phase = (name: string) => {
      const now = performance.now();
      observeHist("booking_create_phase_seconds", (now - phaseMark) / 1000, { phase: name });
      phaseMark = now;
    };
    const [serviceResult, addressResult, entitlementsResult, originResult] = await Promise.allSettled([
      prisma.service.findUnique({ where: { id: body.serviceId } }),
      prisma.address
        .findFirst({ where: { id: body.addressId, userId }, select: { latitude: true, longitude: true, city: true, zipCode: true } })
        .catch(() => null),
      entitlementService.resolve(userId),
      prisma.user.findUnique({ where: { id: userId }, select: { dataOrigin: true } }),
    ]);
    // Fail closed: an unreadable origin must not become a NULL — i.e. business — booking. The read
    // happens before any write, so refusing here leaves no booking, payment or event behind.
    if (originResult.status === "rejected") {
      incCounter("booking_provenance_unavailable_total");
      logger.error("booking_create_provenance_unavailable", { userId, error: String(originResult.reason) });
      return { error: "PROVENANCE_UNAVAILABLE" as const };
    }
    /**
     * A booking inherits its customer's provenance when the customer is NOT business.
     *
     * Bookings created through this path never set `data_origin`, so a certification customer's
     * booking read as UNKNOWN — i.e. business — in every report, and a fixture account that cannot
     * be classified by e-mail (phone-only suite accounts have none) left no trace at all. Parent →
     * child is the sound direction: the customer is the booking's owner. Business customers are left
     * alone (NULL stays NULL), so real bookings are unaffected. Part of the 4th parallel read above,
     * so it costs no extra round trip.
     */
    const customerOrigin = originResult.value?.dataOrigin ?? null;
    const inheritedOrigin = customerOrigin && !isBusinessRow(customerOrigin) ? customerOrigin : undefined;
    // Validate the request BEFORE surfacing an entitlements failure, so an invalid serviceId is
    // still a VALIDATION_ERROR rather than a 500 from a parallel call it never needed.
    const service = serviceResult.status === "fulfilled" ? serviceResult.value : null;
    if (!service) return { error: "VALIDATION_ERROR" as const };
    if (entitlementsResult.status === "rejected") throw entitlementsResult.reason;
    const bookingAddress = addressResult.status === "fulfilled" ? addressResult.value : null;
    const entitlements = entitlementsResult.value;
    phase("reads");

    const catalog = await loadHydratedCatalog(service);
    if (bookingAddress) {
      const cov = coverageAllowsAddress(service, catalog, {
        city: bookingAddress.city,
        zipCode: bookingAddress.zipCode,
      });
      if (!cov.ok) return { error: "SERVICE_NOT_AVAILABLE" as const };
    }

    const scheduled = new Date(body.scheduledDate);
    phase("catalog");

    const priced = await bookingPricingService.quote({
      userId,
      serviceId: body.serviceId,
      couponCode: body.couponCode,
      packagePrice: body.packagePrice,
      variantId: body.variantId,
      quantity: body.quantity,
      audience: body.audience,
      professionalPreference: body.professionalPreference,
      addonIds: body.addonIds,
      addonQuantities: body.addonQuantities,
      serviceVersion: body.serviceVersion,
      addressId: body.addressId,
      lat: bookingAddress?.latitude,
      lng: bookingAddress?.longitude,
    });
    if (!priced.ok) {
      return {
        error: priced.error as typeof priced.error,
        issues: priced.issues,
        currentVersion: priced.currentVersion,
      };
    }
    // The booking always charges the amount just computed from current server data — never the
    // quote's. A quote only proves what the customer was shown: if it is stale or the price moved,
    // refuse with the new price instead of silently charging a different amount.
    if (body.quoteToken) {
      const q = verifyQuote(body.quoteToken);
      if (!q.ok) {
        incCounter(q.error === "QUOTE_EXPIRED" ? "quote_expired" : "quote_failures_total", { reason: q.error });
        return { error: q.error, quote: priced.breakdown };
      }
      if (q.payload.uid !== userId || q.payload.sid !== body.serviceId || q.payload.sel !== priced.breakdown.selectionFingerprint) {
        incCounter("quote_failures_total", { reason: "QUOTE_MISMATCH" });
        return { error: "QUOTE_MISMATCH" as const, quote: priced.breakdown };
      }
      // A quote priced by an older formula can never be honoured, even if the total happens to match.
      if (q.payload.pv !== priced.breakdown.pricingVersion) {
        incCounter("quote_expired", { reason: "PRICING_VERSION" });
        return { error: "QUOTE_EXPIRED" as const, quote: priced.breakdown };
      }
      // The service configuration was republished since the quote (price, duration, options).
      if (q.payload.sv !== priced.breakdown.serviceVersion) {
        incCounter("quote_failures_total", { reason: "SERVICE_VERSION_CHANGED" });
        return { error: "PRICE_CHANGED" as const, quote: priced.breakdown };
      }
      if (q.payload.fp !== priced.breakdown.finalAmountPaise) {
        incCounter("quote_failures_total", { reason: "PRICE_CHANGED" });
        return { error: "PRICE_CHANGED" as const, quote: priced.breakdown };
      }
    } else {
      incCounter("quote_token_absent_total");
      return { error: "QUOTE_REQUIRED" as const, quote: priced.breakdown };
    }
    phase("quote");

    // Phase 06: a requirement the service marks REQUIRED_BEFORE_BOOKING is enforced HERE, not by the
    // client. Missing confirmations refuse the booking and name exactly what to confirm.
    const blocking = blockingRequirementCodes(priced.resolvedRequirements);
    const confirmed = new Set(body.requirementAttestations ?? []);
    const unconfirmed = blocking.filter((c) => !confirmed.has(c));
    if (unconfirmed.length) {
      incCounter("requirement_attestation_missing_total");
      const labels = priced.resolvedRequirements.filter((r) => unconfirmed.includes(r.code)).map((r) => ({ code: r.code, label: r.customerLabel ?? r.name }));
      return { error: "REQUIREMENTS_NOT_CONFIRMED" as const, requirements: labels, quote: priced.breakdown };
    }
    // Phase D: the service's customer age policy, evaluated from the recorded date of birth only.
    // A refusal is recorded now (no booking); an admission is recorded with the booking in the tx below.
    const agePolicy = await customerPolicyService.evaluateForBooking({
      customerId: userId,
      serviceId: body.serviceId,
      catalogConfig: catalog,
      guardianAttested: body.guardianAttested === true,
    });
    if (agePolicy.decision.outcome === "REFUSED") {
      return { error: agePolicy.decision.reasonCode, message: agePolicy.message };
    }
    const requirementsSnapshot = buildRequirementsSnapshot(priced.resolvedRequirements, service.version, blocking);
    const executionSnapshot = buildExecutionSnapshot(priced.resolvedExecution, service.version);

    const {
      campaignDiscount,
      membershipDiscount,
      freeDeliveryDiscount,
      weatherSurgeAmount,
      taxes,
      finalAmount,
      couponCode,
      campaignId,
      membershipCouponId,
    } = priced.breakdown;

    // Canonical money invariant: base + taxes − discount − campaign_discount + tip == total.
    // (1) Stored base must INCLUDE the weather-surge amount — surge has no column of
    //     its own, and an un-surged base makes the invariant drift by exactly the surge.
    // (2) Stored `discount` must EXCLUDE campaignDiscount — the invariant subtracts the
    //     campaign_discount column separately, so folding it in double-counts coupons.
    const baseAmount = priced.breakdown.baseAmount + weatherSurgeAmount;
    const discount = membershipDiscount + freeDeliveryDiscount;

    if (body.couponCode?.trim() && priced.breakdown.couponError) {
      return { error: priced.breakdown.couponError as string };
    }

    // Catalog snapshot of chosen add-ons — priced server-side above; stored on
    // the booking so history / partner / admin all see WHAT was bought, not
    // just a lump-sum baseAmount.
    // Resolved by bookingPricingService from the service's own add-on catalogue.
    // Single-unit add-ons keep the historical {id, name, price} shape; multi-unit ones add
    // quantity + unitPrice (price stays the line total, so every existing sum is still right).
    const addonsSnapshot = priced.breakdown.addons.map((a: { id: string; name: string; price: number; unitPrice: number; quantity: number }) =>
      a.quantity > 1
        ? { id: a.id, name: a.name, price: a.price, unitPrice: a.unitPrice, quantity: a.quantity }
        : { id: a.id, name: a.name, price: a.price },
    );
    const selection = priced.breakdown.selection;

    const queuePriority = bookingPriorityService.resolvePriority(userId, entitlements);
    const priorityScore = bookingPriorityService.resolvePriorityScore(entitlements);
    const revenueBefore = baseAmount - priced.breakdown.membershipDiscount + taxes;

    // Owner decision D1: the booking reserves its appointment duration (FIXED-policy services keep
    // the 60-minute block). Frozen on the row so later catalogue edits never re-slot it.
    const slotDurationMinutes = slotDurationFor(service.partnerSlotPolicy, selection.durationMinutes);
    const validation = await bookingValidationService.validateBooking({
      userId,
      providerId: body.providerId ?? null,
      serviceId: body.serviceId,
      addressId: body.addressId,
      scheduledDate: scheduled,
      amount: finalAmount,
      slotDurationMinutes,
    });
    phase("validate");
    if (!validation.isValid) {
      const codes = new Set(validation.errors.map((e) => e.code));
      if (codes.has("OVERLAPPING_BOOKING")) return { error: "OVERLAPPING_BOOKING" as const };
      if (codes.has("PROVIDER_UNAVAILABLE") || codes.has("PROVIDER_INVALID")) {
        const providerIssue = validation.errors.find((e) => e.code === "PROVIDER_UNAVAILABLE");
        countCreateRefusal(`validation:${providerIssue?.reason ?? (codes.has("PROVIDER_INVALID") ? "PROVIDER_INVALID" : "unspecified")}`);
        return { error: "PROVIDER_UNAVAILABLE" as const, reason: providerIssue?.reason, message: providerIssue?.message };
      }
      // Carry the specific, customer-actionable failure instead of collapsing every rule into one
      // generic message: "Invalid service or address" was shown for a lead-time or blackout refusal,
      // sending the customer to fix an address that was never the problem.
      const actionable = validation.errors.find((e) =>
        e.code === "SCHEDULE_NOT_ALLOWED" || e.code === "SERVICE_NOT_AVAILABLE" || e.code === "COVERAGE_INVALID",
      );
      return {
        error: "VALIDATION_ERROR" as const,
        code: actionable?.code,
        reason: actionable?.reason,
        message: actionable?.message,
      };
    }

    const MAX_BOOKING_TX_RETRIES = 8;
    let booking;
    // Phase 11 — the direct-assign capability gate runs BEFORE the transaction (base client):
    // inside it, its queries held the tx connection long enough to starve concurrent creates on a
    // small pool. Same request-time guarantee; the in-tx assertOfferEligible keeps every other gate.
    if (body.providerId) {
      const capBlocked = await partnerOperationsService.precheckOfferCapability(body.providerId, { serviceId: body.serviceId, customerId: userId });
      if (capBlocked) {
        incCounter("direct_assignment_rejections", { reason: capBlocked });
        return { error: `DIRECT_ASSIGN_BLOCKED:${capBlocked}` };
      }
    }
    try {
      for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
        const bookingNumber = await nextBookingNumber();
        try {
          booking = await prisma.$transaction(
        async (tx) => {
          await setBookingAuditContext(tx, { actorType: "customer", actorId: userId, reason: "booking created" });
          const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
            userId,
            providerId: body.providerId ?? null,
            scheduledDate: scheduled,
            slotDurationMinutes,
          });
          if (conflict) {
            throw new Error(conflict.code);
          }

          if (body.providerId) {
            const lat = bookingAddress?.latitude ?? 0;
            const lng = bookingAddress?.longitude ?? 0;
            const blocked = await partnerOperationsService.assertOfferEligible(tx, body.providerId, {
              latitude: lat,
              longitude: lng,
              scheduledDate: scheduled,
              // Phase 11: a customer-chosen partner passes the same provenance + capability gates dispatch applies.
            });
            if (blocked) {
              incCounter("direct_assignment_rejections", { reason: blocked });
              throw new Error(`DIRECT_ASSIGN_BLOCKED:${blocked}`);
            }
          }

          const created = await tx.booking.create({
        data: {
          bookingNumber,
          userId,
          dataOrigin: inheritedOrigin,
          providerId: body.providerId,
          serviceId: body.serviceId,
          addressId: body.addressId,
          scheduledDate: scheduled,
          description: body.description
            ? sanitizeUserInput(body.description, 1000)
            : undefined,
          baseAmount,
          discount,
          campaignDiscount,
          campaignId,
          couponCode,
          queuePriority,
          priorityScore,
          premiumMatched: entitlements.hasMembership,
          addons: addonsSnapshot.length ? addonsSnapshot : undefined,
          serviceSelection: selection,
          serviceConfigVersion: service.version,
          serviceConfigSnapshot: {
            ...bookingConfigSnapshot(service, catalog, {
              durationMinutes: selection.durationMinutes,
              variant: selection.variant,
              quantity: selection.quantity,
            }),
            // Immutable preparation record: what the customer was told and what the professional must bring.
            requirements: requirementsSnapshot,
            // Phase 10 §7: the work plan of this selection at this service version — frozen.
            execution: executionSnapshot,
            // Immutable commercial snapshot: formula + tax version, currency and every priced line.
            pricing: {
              version: priced.breakdown.pricingVersion,
              currency: priced.breakdown.currency,
              tax: priced.breakdown.tax,
              weatherSurgeMultiplier: priced.breakdown.weatherSurgeMultiplier,
              lines: priced.breakdown.lines,
              finalAmountPaise: priced.breakdown.finalAmountPaise,
            },
            /**
             * Phase 09: the terms this booking was sold under. Cancellation quotes against THIS copy,
             * so a later edit to the published policy cannot re-price a refund for a booking already
             * placed. Rows created before this existed carry none and fall back to the live policy.
             */
            // `boundary` is optional on a tier, and an optional property is not assignable to
            // Prisma's JSON input type; the value itself is plain JSON.
            policy: {
              cancellation: CANCELLATION_POLICY as unknown as Prisma.JsonObject,
              // O6: the reschedule terms are frozen for the same reason the cancellation terms
              // are. A later change to the late-fee percentage must not re-price a move on a
              // booking that was sold under the old one.
              reschedule: RESCHEDULE_POLICY as unknown as Prisma.JsonObject,
            },
            /**
             * Phase 07/08: the schedule and serviceability decision that admitted this booking —
             * the rules as they stood, not as they will stand when someone asks later why it was
             * allowed. `slotDurationMinutes` is already a column (owner decision D1); this records
             * the inputs around it.
             */
            schedule: {
              timeZone: BUSINESS_TIMEZONE,
              scheduledAt: scheduled.toISOString(),
              slotDurationMinutes,
              leadTimeMinutes: catalog?.availability?.minimumLeadTimeMinutes ?? null,
              maximumAdvanceDays: catalog?.availability?.maximumAdvanceDays ?? DEFAULT_MAX_ADVANCE_DAYS,
              sameDayAllowed: catalog?.availability?.sameDay ?? catalog?.sameDayAvailable ?? null,
              blackoutDates: catalog?.availability?.blackoutDates ?? [],
            },
          } as Prisma.InputJsonValue,
          taxes,
          finalAmount,
          totalAmount: finalAmount,
          paymentMethod: body.paymentMethod,
          // Hours / variant / add-on durations are reflected, not the catalogue default.
          estimatedDuration: selection.durationMinutes,
          slotDurationMinutes,
        },
        include: {
          provider: { include: { user: true } },
          service: true,
        },
      });

      if (membershipCouponId && campaignDiscount > 0) {
        await membershipCouponService.consumeInTransaction(
          tx,
          membershipCouponId,
          userId,
          created.id,
          campaignDiscount,
          revenueBefore,
          finalAmount,
        );
      } else if (campaignId && campaignDiscount > 0) {
        await tx.couponUsage.create({
          data: {
            campaignId,
            userId,
            bookingId: created.id,
            discountApplied: campaignDiscount,
            revenueBefore,
            revenueAfter: finalAmount,
          },
        });
        await tx.campaign.update({
          where: { id: campaignId },
          data: { redemptionCount: { increment: 1 } },
        });
      }

          // §6: the booking's gated requirements get their state rows in the same transaction, from the
          // snapshot written above — born with the booking, never derived from the catalogue later.
          await bookingExecutionService.materializeForNewBooking(tx, { bookingId: created.id, snapshot: { execution: executionSnapshot } });
          // Phase D: the age-policy decision that admitted this booking, committed with it (append-only).
          await customerPolicyService.recordInTransaction(tx, { customerId: userId, serviceId: body.serviceId, bookingId: created.id, evaluation: agePolicy });
          await bookingRequirementService.materializeForNewBooking(tx, {
            bookingId: created.id,
            customerId: userId,
            snapshot: { requirements: requirementsSnapshot },
          });

          if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
            await emitInTransaction(
              tx,
              buildBookingCreatedEvent({
                bookingId: created.id,
                bookingNumber: created.bookingNumber,
                userId: created.userId,
                serviceId: created.serviceId,
                serviceCategory: service.category,
                city: bookingAddress?.city ?? "unknown",
                providerId: created.providerId,
                status: created.status,
                finalAmount: created.finalAmount,
                finalAmountPaise: created.finalAmountPaise,
                paymentMethod: created.paymentMethod,
                scheduledAt: created.scheduledDate,
                actorType: "customer",
                actorId: userId,
              }),
            );
          }

          return created;
        },
        /**
         * READ COMMITTED, deliberately — measured on 2026-09-21 (docs/final-enterprise-release-matrix.md,
         * gate 23). Under SERIALIZABLE, 48% of first attempts aborted with P2034 at 10 concurrent
         * creators who shared no user, provider or slot: the conflict scan above runs as a bitmap heap
         * scan, whose SSI predicate locks are PAGE-granular, so every concurrent insert into
         * `bookings` conflicted with every other creator's read. Retries then ran 2–7 attempts with
         * 40 ms·2^n backoff — that ladder WAS the p99 (7.3 s under the mixed load profile).
         *
         * Nothing this transaction guarantees depended on SSI. One-booking-per-slot is enforced by
         * the GiST exclusion constraints (bookings_user_slot_excl / bookings_provider_slot_excl),
         * which are index-enforced at any isolation level, plus the FOR UPDATE scans and the
         * provider advisory lock in assertBookingConflictFree (see its comment); a concurrent
         * same-slot insert still surfaces as a typed OVERLAPPING_BOOKING / PROVIDER_UNAVAILABLE via
         * isBookingScheduleConflict. Coupon consumption is an atomic increment / CAS. The outbox row
         * is atomic with the booking because they share the transaction, not because of the level.
         */
        { isolationLevel: "ReadCommitted", maxWait: 30_000, timeout: 45_000 },
          );
          break;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
              // A retry is a full second pass over the transaction plus a 40–80 ms backoff. Under the
              // 2026-09-21 load benchmark 1.5–2 attempts per booking were happening and nothing
              // recorded it: Postgres logged no error (the failure is client-side), and this branch
              // logged nothing. A retry that cannot be seen cannot be tuned away.
              incCounter("booking_create_tx_retry_total", { code: error.code });
              logger.warn("booking_create_tx_retry", {
                attempt,
                code: error.code,
                message: error.message.slice(0, 300),
              });
              // Exponential backoff — tight 5ms loops amplify P2024 under connection_limit=8.
              await new Promise((r) => setTimeout(r, 40 * 2 ** attempt + Math.random() * 40));
              continue;
            }
          }
          if (this.isBookingScheduleConflict(error)) {
            throw new Error("PROVIDER_UNAVAILABLE", { cause: error });
          }
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "OVERLAPPING_BOOKING") {
          return { error: "OVERLAPPING_BOOKING" as const };
        }
        if (error.message === "PROVIDER_UNAVAILABLE") {
          countCreateRefusal("slot_conflict");
          return { error: "PROVIDER_UNAVAILABLE" as const };
        }
        if (error.message.startsWith("DIRECT_ASSIGN_BLOCKED:")) {
          countCreateRefusal(`direct_assign:${error.message.slice("DIRECT_ASSIGN_BLOCKED:".length) || "unspecified"}`);
          return { error: "PROVIDER_UNAVAILABLE" as const };
        }
      }
      if (this.isBookingScheduleConflict(error)) {
        countCreateRefusal("slot_conflict");
        return { error: "PROVIDER_UNAVAILABLE" as const };
      }
      if (isRetryablePrismaError(error) || isPrismaConnectionExhausted(error)) {
        return { error: "POOL_BUSY" as const };
      }
      throw error;
    }

    if (!booking) {
      countCreateRefusal("no_booking_after_retries");
      return { error: "PROVIDER_UNAVAILABLE" as const };
    }
    phase("tx"); // booking number + transaction, including any retries

    recordFinancialMetric("booking_created_total", 1);
    incCounter("service_booking_conversion_total");
    // Phase 06: one immutable requirements snapshot per committed booking (labels carry no ids, names or notes).
    incCounter("requirement_snapshot_created_total", { blocking: blocking.length ? "true" : "false", empty: requirementsSnapshot.items.length ? "false" : "true" });

    // Ledger the membership discount for quota/analytics (best-effort).
    if (membershipDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.DISCOUNT_PCT, { amount: membershipDiscount });
    }
    if (freeDeliveryDiscount > 0) {
      await entitlementService.recordUsage(userId, BENEFIT.FREE_DELIVERY, { amount: freeDeliveryDiscount });
    }

    // booking_created_total already recorded above via recordFinancialMetric (no duplicate).

    // Phase B — priority queue enqueue (server-side).
    await bookingPriorityService.enqueue(booking.id, queuePriority, priorityScore);

    // Phase 1 — assignment dispatch job (auto provider matching).
    // Job creation is awaited (must exist before we return), but the provider
    // fan-out itself must not block the customer's 201 — the assignment cron
    // re-dispatches PENDING jobs, so a failed inline dispatch self-heals.
    // The previous `.catch(() => undefined)` meant a broken dispatch left no trace anywhere:
    // the job stayed PENDING with dispatchAttempts still 0, and nothing recorded that this
    // path had thrown at all.
    if (!body.providerId) {
      await assignmentEngine.createJob(booking.id);
      assignmentEngine.dispatchBookingNowBackground(booking.id);
    }

    // Booking confirmation email (non-blocking)
    void this.notifyBookingConfirmation(booking.id).catch(() => undefined);
    phase("post"); // queue position + assignment job, awaited before the 201

    return { booking: this.summary(booking) };
  }

  private async notifyBookingConfirmation(bookingId: string) {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true, service: true },
    });
    if (!b?.userId) return;
    const email = await userPiiService.resolveEmail(b.user, { actorId: b.userId, authorized: true });
    if (!email) return;
    const date = b.scheduledDate ? new Date(b.scheduledDate) : new Date();
    emailDeliveryService.sendBookingConfirmation(
      email,
      {
        id: b.id,
        serviceTitle: b.service.name,
        dateLabel: date.toLocaleString("en-IN"),
        total: b.finalAmount,
      },
      b.user.firstName,
    );
  }

  private summary(b: {
    id: string;
    bookingNumber: string;
    status: BookingStatus;
    scheduledDate: Date;
    baseAmount: number;
    finalAmount: number;
    addons?: unknown;
    provider?: { id: string; rating: number; profileImage: string | null; user: { firstName: string; lastName: string } } | null;
    service: { name: string };
  }) {
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: bookingStatusApi(b.status),
      // Clients render the confirmation from this payload; without the slot they
      // fall back to "now" and tell the customer their service is today.
      scheduledDate: b.scheduledDate.toISOString(),
      amount: b.baseAmount,
      finalAmount: b.finalAmount,
      addons: b.addons ?? undefined,
      provider: b.provider
        ? {
            id: b.provider.id,
            name: `${b.provider.user.firstName} ${b.provider.user.lastName}`,
            rating: b.provider.rating,
            profileImage: b.provider.profileImage,
          }
        : undefined,
      service: { name: b.service.name },
    };
  }

  async getForUser(userId: string, bookingId: string) {
    const b = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        user: true,
        provider: { include: { user: true } },
        service: true,
        address: true,
        rating: true,
        tracking: true,
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      user: { id: b.user.id, firstName: b.user.firstName, profileImage: b.user.profileImage },
      provider: b.provider
        ? toCustomerSafePartner({
            id: b.provider.id,
            firstName: b.provider.user.firstName,
            lastName: b.provider.user.lastName,
            rating: b.provider.rating,
            profileImage: b.provider.profileImage,
            phone: b.provider.user.phoneNumber,
          })
        : null,
      service: { id: b.service.id, name: b.service.name, icon: b.service.icon },
      address: await addressPiiService.viewForFulfilment(b.address),
      status: bookingStatusApi(b.status),
      scheduledDate: b.scheduledDate,
      // Lifecycle anchors — the partner UI needs these to decide whether to offer
      // "On my way" or "I've arrived". Arrival does not change booking status, so
      // status alone cannot distinguish the two states.
      enRouteAt: b.enRouteAt,
      arrivedAt: b.arrivedAt,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      baseAmount: b.baseAmount,
      discount: b.discount,
      taxes: b.taxes,
      finalAmount: b.finalAmount,
      tipAmount: b.tipAmount,
      addons: b.addons ?? undefined,
      paymentStatus: paymentStatusApi(b.paymentStatus),
      paymentMethod: b.paymentMethod,
      description: b.description,
      rating: b.rating
        ? {
            rating: b.rating.stars,
            reviewText: b.rating.reviewText,
            createdAt: b.rating.createdAt,
          }
        : null,
      tracking: b.tracking
        ? {
            status: b.tracking.status.toLowerCase(),
            totalDistance: b.tracking.totalDistance,
            actualArrivalTime: b.tracking.actualArrivalTime,
          }
        : null,
    };
  }

  async getBookingAccess(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: { userId: true, providerId: true },
    });
  }

  /**
   * Offered jobs keep `booking.providerId` null until accept. The dispatched
   * partner must still be able to GET the booking (evidence, actions, OTP).
   * An attempt only opens the booking while nobody owns it: an admin reassignment leaves the
   * displaced partner's ACCEPTED attempt in place as history, and that must not keep a door open.
   */
  private partnerBookingAccessWhere(providerId: string): Prisma.BookingWhereInput {
    return {
      OR: [
        { providerId },
        { assignmentJob: { currentProviderId: providerId } },
        {
          providerId: null,
          assignmentJob: {
            attempts: {
              some: {
                providerId,
                status: {
                  in: [AssignmentAttemptStatus.SENT, AssignmentAttemptStatus.ACCEPTED],
                },
              },
            },
          },
        },
      ],
    };
  }

  async getById(bookingId: string, userId?: string, providerId?: string) {
    const b = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...(userId ? { userId } : {}),
        ...(providerId ? this.partnerBookingAccessWhere(providerId) : {}),
      },
      include: {
        provider: { include: { user: true } },
        user: true,
        service: true,
        address: true,
        tracking: true,
      },
    });
    if (!b) return null;

    const addressRaw = await addressPiiService.viewForFulfilment(b.address);
    const tracking = b.tracking
      ? {
          status: b.tracking.status.toLowerCase(),
          distance: b.tracking.totalDistance,
          eta: b.eta,
        }
      : null;
    const shared = {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: bookingStatusApi(b.status),
      service: {
        id: b.service.id,
        name: b.service.name,
        icon: b.service.icon,
        basePrice: b.service.basePrice,
      },
      scheduledDate: b.scheduledDate,
      completedAt: b.completedAt,
      enRouteAt: b.enRouteAt,
      arrivedAt: b.arrivedAt,
      startedAt: b.startedAt,
      eta: b.eta,
      amount: b.baseAmount,
      finalAmount: b.finalAmount,
      addons: b.addons ?? undefined,
      paymentStatus: paymentStatusApi(b.paymentStatus),
      refundAmount: b.refundAmount,
      refundStatus: b.refundStatus,
      cancelledAt: b.cancelledAt,
      cancellationReason: b.cancellationReason,
      tracking,
    };

    if (providerId) {
      const phone = await userPiiService.resolvePhone(b.user, { actorId: providerId, authorized: true });
      const privacyCtx = {
        audience: "partner" as const,
        purpose: ACTIVE_FULFILMENT_STATUSES.has(String(b.status))
          ? ("booking_fulfilment" as const)
          : ("booking_history" as const),
        bookingId: b.id,
        bookingStatus: String(b.status),
        authorizedPartnerId: providerId,
      };
      const payload = {
        // X-29: the customer's refund amount / status are not partner data.
        ...withoutCustomerMoney(shared),
        // Someone else's words about the cancellation (the customer's reason, an admin's note) stay with them.
        cancellationReason: partnerCancellationReason(b.cancellationReason, b.cancelledBy),
        customer: toPartnerSafeCustomer(
          {
            firstName: b.user.firstName,
            lastName: b.user.lastName,
            profileImage: b.user.profileImage,
            phone,
          },
          partnerCustomerStage({ isAssignee: b.providerId === providerId, status: String(b.status) }),
        ),
        address: toPartnerSafeAddress(addressRaw, privacyCtx),
        // The customer's note for the visit: the job list row carries it, and the job page reads this payload.
        description: partnerJobNote(b.description, partnerCustomerStage({ isAssignee: b.providerId === providerId, status: String(b.status) })),
        execution: partnerExecutionFromSnapshot(b.serviceConfigSnapshot),
        job: partnerJobBrief(b.serviceSelection, b.addons, b.estimatedDuration),
        // Phase 06: what THIS booking recorded at creation — never the service’s current configuration.
        requirements: partnerRequirementsFromSnapshot(b.serviceConfigSnapshot),
        // §11: the same two fields the partner list carries — the job screen prefers this row, so without
        // them a rework visit lost its "Rework visit" card and its payment exemption on the device.
        followUp: partnerFollowUpFromSnapshot(b.serviceConfigSnapshot),
        paymentExempt: (await paymentExemptBookingIds([{ id: b.id, paymentStatus: b.paymentStatus }])).has(b.id),
      };
      const leaked = collectForbiddenPartnerKeys(payload);
      if (leaked.length > 0) {
        logger.warn("partner_booking_payload_forbidden_keys", { bookingId: b.id, keys: leaked });
      }
      return stripForbiddenPartnerKeys(payload);
    }

    const partnerPhone = b.provider
      ? await userPiiService.resolvePhone(b.provider.user, { actorId: userId, authorized: true })
      : null;
    return {
      ...shared,
      provider: b.provider
        ? toCustomerSafePartner({
            id: b.provider.id,
            firstName: b.provider.user.firstName,
            lastName: b.provider.user.lastName,
            rating: b.provider.rating,
            profileImage: b.provider.profileImage,
            phone: partnerPhone,
          })
        : null,
      address: addressRaw,
      // Phase 06: what the customer was told when they booked (snapshot, not current config).
      requirements: customerRequirementsFromSnapshot(b.serviceConfigSnapshot),
    };
  }

  async listForUser(
    userId: string,
    query: { status?: string; page?: string | number; limit?: string | number; sortBy?: string },
  ) {
    const { page, limit, skip } = parsePagination(query);
    const where: { userId: string; status?: { in: BookingStatus[] } } = { userId };
    if (query.status && query.status !== "all") {
      const map: Record<string, BookingStatus[]> = {
        pending: ["PENDING"],
        accepted: ["ACCEPTED", "ASSIGNED", "EN_ROUTE"],
        completed: ["COMPLETED"],
        cancelled: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED"],
      };
      where.status = { in: map[query.status] ?? [query.status.toUpperCase() as BookingStatus] };
    }
    const orderBy =
      query.sortBy === "upcoming"
        ? { scheduledDate: "asc" as const }
        : { createdAt: "desc" as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          service: true,
          provider: { include: { user: true } },
          rating: true,
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        serviceId: b.serviceId,
        serviceName: b.service.name,
        serviceIcon: b.service.icon,
        providerId: b.providerId,
        providerName: b.provider ? `${b.provider.user.firstName} ${b.provider.user.lastName}` : null,
        providerImage: b.provider?.profileImage,
        providerRating: b.provider?.rating,
        status: bookingStatusApi(b.status),
        scheduledDate: b.scheduledDate,
        completedAt: b.completedAt,
        amount: b.baseAmount,
        finalAmount: b.finalAmount,
        addons: b.addons ?? undefined,
        paymentStatus: paymentStatusApi(b.paymentStatus),
        ratingGiven: Boolean(b.rating),
      })),
      total,
      page,
      limit,
    };
  }

  async update(userId: string, id: string, patch: { scheduledDate?: string; description?: string }) {
    if (!patch.scheduledDate) {
      const b = await prisma.booking.findFirst({ where: { id, userId } });
      if (!b) return { error: "NOT_FOUND" as const };
      if (["IN_PROGRESS", "COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"].includes(b.status)) {
        return { error: "INVALID_STATUS" as const };
      }
      if (patch.description !== undefined) {
        await prisma.booking.update({
          where: { id },
          data: { description: sanitizeUserInput(patch.description, 1000) },
        });
      }
      return { ok: true as const };
    }

    const scheduled = new Date(patch.scheduledDate);

    // A reschedule is a new appointment for an existing booking: it must clear the same service and
    // partner time rules a fresh booking would. Read-only, so it runs before the locking transaction.
    const existing = await prisma.booking.findFirst({
      where: { id, userId },
      select: {
        serviceId: true, providerId: true, slotDurationMinutes: true, status: true,
        scheduledDate: true, baseAmount: true, finalAmount: true, paymentStatus: true,
        serviceConfigSnapshot: true,
      },
    });
    if (!existing) return { error: "NOT_FOUND" as const };
    // Allow-list, not a deny-list: the old deny-list omitted REJECTED, so a booking the partner had
    // rejected could still be moved to a new slot and re-reserve the window.
    if (!isReschedulableBookingStatus(existing.status)) {
      return { error: "INVALID_STATUS" as const };
    }
    const scheduleIssue = await bookingValidationService.validateReschedule({
      userId,
      serviceId: existing.serviceId,
      providerId: existing.providerId,
      scheduledDate: scheduled,
      slotDurationMinutes: existing.slotDurationMinutes,
    });
    if (scheduleIssue) {
      return {
        error: (scheduleIssue.code === "PROVIDER_UNAVAILABLE"
          ? "PROVIDER_UNAVAILABLE"
          : "SCHEDULE_NOT_ALLOWED") as "PROVIDER_UNAVAILABLE" | "SCHEDULE_NOT_ALLOWED",
        reason: scheduleIssue.reason,
        message: scheduleIssue.message,
      };
    }

    /**
     * §45 / O6 — the late-reschedule fee.
     *
     * Decided by how close the EXISTING appointment is, never the slot the client asked for, and
     * priced by the policy FROZEN on this booking — so a later change to the percentage cannot
     * re-price a move on a booking sold under the old terms. Rows placed before the freeze existed
     * fall back to the published policy, which is the only honest answer available for them.
     *
     * The fee is COMPUTED and reported; no money moves here. Collecting it would mean either a
     * wallet debit or a gateway charge mid-reschedule, and neither is authorised — a reschedule
     * that fails because a wallet is short would be a product decision invented in this function.
     * What the customer owes is stated, in the response and in the event, rather than applied
     * silently or forgotten.
     */
    const frozenReschedulePolicy = reschedulePolicyFromSnapshot(existing.serviceConfigSnapshot);
    const capturedForFee =
      existing.paymentStatus === "SUCCESS"
        ? ((await bookingRefundService.refundableRemaining(id, userId)) ?? 0)
        : 0;
    const rescheduleDecision = evaluateReschedule({
      scheduledDate: existing.scheduledDate,
      bookingStatus: existing.status,
      subtotal: existing.baseAmount,
      capturedAmount: capturedForFee,
      policy: frozenReschedulePolicy,
    });
    if (rescheduleDecision.disposition === "LATE_FEE") {
      incCounter("reschedule_late_fee_total", {
        version: rescheduleDecision.version,
        chargeable: rescheduleDecision.feeAmountPaise > 0 ? "yes" : "no",
      });
      logger.warn("reschedule_late_fee_applied", {
        category: "APPLICATION",
        bookingId: id,
        policyVersion: rescheduleDecision.version,
        feeBps: rescheduleDecision.feeBps,
        feeAmountPaise: rescheduleDecision.feeAmountPaise,
        hoursUntilAppointment: rescheduleDecision.hoursUntilAppointment,
      });
    }

    try {
      const notifyProviderId = await this.runRescheduleWithRetry(async () => {
        return withRescheduleGate(() =>
          withTxRetry(async () => {
            let providerId: string | null = null;
            await prisma.$transaction(
              async (tx) => {
                await setBookingAuditContext(tx, { actorType: "customer", actorId: userId, reason: "rescheduled by customer" });
                const b = await tx.booking.findFirst({ where: { id, userId } });
                if (!b) throw new Error("NOT_FOUND");
                // Re-checked under the transaction: the status can change between the pre-check
                // above and this lock.
                if (!isReschedulableBookingStatus(b.status)) {
                  throw new Error("INVALID_STATUS");
                }

                const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
                  userId,
                  providerId: b.providerId,
                  scheduledDate: scheduled,
                  excludeBookingId: id,
                  slotDurationMinutes: b.slotDurationMinutes,
                });
                if (conflict) {
                  throw new Error(conflict.code);
                }

                await tx.booking.update({
                  where: { id },
                  data: {
                    scheduledDate: scheduled,
                    // As in an admin's reschedule: the arrival and the start PIN were for the old
                    // appointment. Re-sending the same time is not a move and clears nothing.
                    ...(scheduled.getTime() !== b.scheduledDate.getTime() ? { arrivedAt: null, startOtpVerifiedAt: null } : {}),
                    description:
                      patch.description !== undefined
                        ? sanitizeUserInput(patch.description, 1000)
                        : undefined,
                  },
                });

                // In the same transaction as the write: a consumer never sees a move that rolled
                // back, and never misses one that committed.
                if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
                  await emitInTransaction(
                    tx,
                    buildBookingRescheduledEvent({
                      bookingId: id,
                      userId,
                      providerId: b.providerId,
                      previousScheduledAt: b.scheduledDate,
                      scheduledAt: scheduled,
                      actorType: "customer",
                      actorId: userId,
                      // The terms this move was taken under, so support never has to guess later.
                      reschedulePolicy: {
                        version: rescheduleDecision.version,
                        disposition: rescheduleDecision.disposition,
                        feeBps: rescheduleDecision.feeBps,
                        feeAmountPaise: rescheduleDecision.feeAmountPaise,
                      },
                    }),
                  );
                }
                providerId = b.providerId;
              },
              { isolationLevel: "Serializable", maxWait: 15_000, timeout: 20_000 },
            );
            return providerId;
          }),
        );
      });

      if (notifyProviderId) {
        const provider = await prisma.provider.findUnique({
          where: { id: notifyProviderId },
          select: { userId: true },
        });
        if (provider?.userId) {
          // Detached: the reschedule is committed. A throw was mapped to POOL_BUSY by this
          // method's own catch, telling the customer their reschedule failed when it had not.
          await notificationService.createForUserDetached({
            userId: provider.userId,
            type: "SYSTEM",
            title: "Booking rescheduled",
            message: `Customer rescheduled to ${scheduled.toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}`,
            referenceId: id,
            referenceType: "booking",
          });
        }
      } else if (isSettled(existing.paymentStatus)) {
        // The search that already ran used the old slot. A customer who moves a paid, unassigned
        // booking into a partner's working window would otherwise sit on that empty result until
        // the 15-minute supply backoff — reschedule never started a new search.
        // Measured HOMIGO-20261003-00017: Sunday 17:30 IST → Monday 13:00 IST, Rahul matched, zero offers.
        await prisma.assignmentJob.updateMany({
          where: { bookingId: id },
          data: { lastDispatchedAt: null },
        });
        assignmentEngine.dispatchBookingNowBackground(id);
      }
      return { ok: true as const, reschedulePolicy: rescheduleDecision };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "NOT_FOUND") return { error: "NOT_FOUND" as const };
        if (error.message === "INVALID_STATUS") return { error: "INVALID_STATUS" as const };
        if (error.message === "OVERLAPPING_BOOKING") {
          return { error: "OVERLAPPING_BOOKING" as const };
        }
        if (error.message === "PROVIDER_UNAVAILABLE") {
          return { error: "PROVIDER_UNAVAILABLE" as const };
        }
      }
      if (isPrismaConnectionExhausted(error)) {
        return { error: "POOL_BUSY" as const };
      }
      if (this.isBookingScheduleConflict(error)) {
        return { error: "PROVIDER_UNAVAILABLE" as const };
      }
      if (isRetryablePrismaError(error)) {
        return { error: "POOL_BUSY" as const };
      }
      throw error;
    }
  }

  /** Outer retry for reschedule — re-enters gate after transient pool/serialization exhaustion. */
  private async runRescheduleWithRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isRetryablePrismaError(err)) throw err;
        lastErr = err;
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1) + Math.random() * 75));
      }
    }
    throw lastErr;
  }

  private isRetryableBookingTxError(error: Prisma.PrismaClientKnownRequestError): boolean {
    if (
      error.code === "P2034" ||
      error.code === "P2010" ||
      error.code === "P2024" ||
      error.code === "P2028" ||
      error.code === "P2037"
    ) {
      return true;
    }
    if (error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("booking_number")) return true;
    }
    return false;
  }

  private isBookingConflictError(error: Prisma.PrismaClientKnownRequestError): boolean {
    if (error.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) && target.includes("booking_number")) return false;
      return true;
    }
    if (error.code === "P2034" || error.code === "P2010") return false;
    return this.isExclusionConstraintMessage(error.message);
  }

  private isBookingScheduleConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return this.isBookingConflictError(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return this.isExclusionConstraintMessage(message);
  }

  private isExclusionConstraintMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("bookings_provider_slot_excl") ||
      lower.includes("bookings_user_slot_excl") ||
      lower.includes("23p01") ||
      lower.includes("exclusion constraint")
    );
  }

  /**
   * Accepts of ONE booking run one at a time in this process, before any connection is taken.
   *
   * A broadcast offer reaches up to BROADCAST_FANOUT partners, and a partner's app retries. Every
   * accept used to open its Serializable transaction and then block on the booking's FOR UPDATE —
   * holding a pooled connection while it waited. N concurrent accepts of one booking therefore queued
   * in the CONNECTION POOL, not in Postgres: with N above the pool size the rest waited for a connection,
   * and the moment the lock holder was slow (2026-10-01: a dispatch-offer transaction stalled on a
   * second connection while holding the booking FOR SHARE) they hit Prisma's 2 s maxWait —
   * "Unable to start a transaction", eight retries, then a thrown accept. Meanwhile every other
   * request on the instance starved for the same connections.
   *
   * Serialised here, a booking costs at most one connection per instance however many partners tap
   * Accept, and the later callers read the committed outcome on the cheap pre-check path
   * (ALREADY_CLAIMED, or the idempotent "already yours") without opening a transaction at all.
   * Across instances the row lock still decides; this only stops one instance from spending its pool
   * on waiters.
   */
  accept(providerId: string, id: string, eta?: number): ReturnType<BookingService["acceptSerialized"]> {
    return serializeBookingAccept(id, () => this.acceptSerialized(providerId, id, eta));
  }

  private async acceptSerialized(
    providerId: string,
    id: string,
    eta?: number,
  ): Promise<
    | {
        ok: true;
        booking: NonNullable<Awaited<ReturnType<BookingService["loadBookingForAccept"]>>>;
        newlyAccepted: boolean;
      }
    | {
        ok: false;
        error:
          | "NOT_FOUND"
          | "INVALID_STATUS"
          | "PROVIDER_UNAVAILABLE"
          | "ALREADY_CLAIMED"
          | "PAYMENT_NOT_SETTLED"
          | "CAPACITY_LIMIT"
          | "ACCOUNT_RESTRICTED"
          | "STALE_LOCATION"
          | "STALE_PRESENCE"
          /** Phase 11 — provenance/capability re-check at accept (a machine code from MATCHING_REJECTION_REASONS). */
          | MatchingRejectionReason;
      }
  > {
    const pre = await prisma.booking.findUnique({
      where: { id },
      select: { status: true, providerId: true },
    });
    if (!pre) return { ok: false, error: "NOT_FOUND" };

    const claimedByPartner = new Set<BookingStatus>([
      BookingStatus.ACCEPTED,
      BookingStatus.ASSIGNED,
      BookingStatus.EN_ROUTE,
      BookingStatus.IN_PROGRESS,
    ]);

    if (pre.status !== BookingStatus.PENDING) {
      if (claimedByPartner.has(pre.status) && pre.providerId === providerId) {
        const booking = await this.loadBookingForAccept(id);
        if (!booking) return { ok: false, error: "NOT_FOUND" };
        return { ok: true, booking, newlyAccepted: false };
      }
      if (claimedByPartner.has(pre.status) && pre.providerId && pre.providerId !== providerId) {
        return { ok: false, error: "ALREADY_CLAIMED" };
      }
      return { ok: false, error: "INVALID_STATUS" };
    }

    const MAX_BOOKING_TX_RETRIES = 8;

    for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            await setBookingAuditContext(tx, { actorType: "partner", actorId: providerId, reason: "accepted" });
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                status: string;
                payment_status: string;
                provider_id: string | null;
                user_id: string;
                queued_at: Date | null;
                scheduled_date: Date;
                service_id: string;
                address_id: string;
                slot_duration_minutes: number | null;
              }>
            >`
              SELECT id, status, payment_status, provider_id, user_id, queued_at, scheduled_date, service_id, address_id, slot_duration_minutes
              FROM bookings
              WHERE id = ${id}
              FOR UPDATE
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("NOT_FOUND");
            }
            /**
             * The money, checked under the same lock as the status.
             *
             * Read here rather than before the transaction so the answer cannot change between the
             * check and the write. `payment_status` rides along in the row already being locked, so
             * this costs nothing and closes the window where a booking passes the gate and is then
             * accepted after a refund or a failure lands.
             *
             * Partner accept has no override path by design: taking responsibility for dispatching
             * an unpaid job is an administrative act, and a partner cannot authorise it for
             * themselves.
             */
            const gate = evaluatePaymentGate(row.payment_status as PaymentStatus);
            // §11: a case-created follow-up with its fee waived owes nothing (never marked paid).
            if (!gate.allowed && !(await isNoPaymentFollowUp(id, tx))) {
              throw new Error(gate.reason);
            }
            if (row.status !== "PENDING") {
              if (row.provider_id && claimedByPartner.has(row.status as BookingStatus)) {
                // A duplicate of this partner's own accept that lost the race (another instance, or a
                // retry) gets the same idempotent answer as the pre-check above — not INVALID_STATUS.
                throw new Error(row.provider_id === providerId ? "ALREADY_ACCEPTED_BY_SELF" : "ALREADY_CLAIMED");
              }
              throw new Error("INVALID_STATUS");
            }

            const assignedProviderId = await this.resolveAcceptingProvider(
              tx,
              id,
              providerId,
              row.provider_id,
            );

            const conflict = await bookingValidationService.assertBookingConflictFree(tx, {
              userId: row.user_id,
              providerId: assignedProviderId,
              scheduledDate: row.scheduled_date,
              excludeBookingId: id,
              slotDurationMinutes: row.slot_duration_minutes,
            });
            if (conflict) {
              throw new Error(conflict.code);
            }

            const capacityBlock = await partnerOperationsService.assertAcceptEligible(
              tx,
              assignedProviderId,
              {
                serviceId: row.service_id,
                customerId: row.user_id,
              },
              row.scheduled_date,
            );
            /**
             * W2-D2. No bypass. This used to let a pinned partner accept past a failed capacity or
             * presence gate — and for STALE_LOCATION / STALE_PRESENCE it went further and WROTE a
             * fresh heartbeat and location timestamp into partner_presence, so every downstream
             * presence decision about that partner became a lie. A partner who fails here does not
             * accept, pinned or not, and presence is only ever written by the partner's own device.
             */
            if (capacityBlock) {
              throw new Error(capacityBlock);
            }

            const acceptedAt = new Date();
            const waitTimeMs = row.queued_at
              ? toWaitTimeMsBigInt(acceptedAt.getTime() - new Date(row.queued_at).getTime())
              : null;
            const resolvedEta = await resolveStoredAcceptEta(
              tx,
              assignedProviderId,
              row.address_id,
              eta,
            );

            await tx.booking.update({
              where: { id },
              data: {
                status: "ACCEPTED",
                acceptedAt,
                assignedAt: acceptedAt,
                waitTimeMs,
                ...(resolvedEta != null ? { eta: resolvedEta } : {}),
              },
            });
            // Rival offers close in THIS transaction (they used to close post-commit, detached).
            await assignmentEngine.markAcceptedInTx(tx, id, assignedProviderId);

            if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
              await emitInTransaction(
                tx,
                buildBookingAssignedEvent({
                  bookingId: id,
                  userId: row.user_id,
                  providerId: assignedProviderId,
                  serviceId: row.service_id,
                  assignedAt: acceptedAt,
                  eta: resolvedEta ?? null,
                  actorType: "partner",
                  actorId: providerId,
                }),
              );
            }
          },
          { isolationLevel: "Serializable" },
        );

        const booking = await this.loadBookingForAccept(id);
        if (!booking) return { ok: false, error: "NOT_FOUND" };

        const newlyAccepted = true;
        // Authoritative realtime frame — emitted here, after commit, regardless of whether the
        // action arrived over HTTP or WS, from web or mobile.
        publishBookingStatusBackground({
          bookingId: id,
          status: booking.status,
          userId: booking.userId,
          providerUserId: booking.provider?.userId ?? null,
          extra: {
            providerId,
            providerName: booking.provider?.user?.firstName ?? null,
            acceptedAt: booking.acceptedAt,
            eta: booking.eta ?? null,
          },
        });
        if (booking.userId) {
          const existingNotice = await prisma.notification.findFirst({
            where: {
              userId: booking.userId,
              type: "booking_accepted",
              referenceId: booking.id,
            },
            select: { id: true },
          });
          // The findFirst above is only a cheap pre-check. Two concurrent accepts (double-tap, retry)
          // both see nothing; the partial unique index notifications_booking_accepted_dedup_key makes
          // the second insert fail with P2002 — and that failure means "already told", so the email
          // below is skipped too, and the accept itself (already committed) is never failed by it.
          let noticeCreated = false;
          if (!existingNotice) {
            try {
              await notificationService.createForUser({
                userId: booking.userId,
                type: "booking_accepted",
                title: "Booking Accepted",
                message: `${booking.provider?.user.firstName} has accepted your ${booking.service.name} booking`,
                referenceId: booking.id,
                referenceType: "booking",
              });
              noticeCreated = true;
            } catch (err) {
              if (getPrismaErrorCode(err) !== "P2002") {
                logger.warn("booking_accepted_notice_failed", { bookingId: booking.id, error: err instanceof Error ? err.message : String(err) });
              }
            }
          }
          if (noticeCreated) {
            const customer = await prisma.user.findUnique({ where: { id: booking.userId } });
            if (customer) {
              const email = await userPiiService.resolveEmail(customer, { actorId: booking.userId, authorized: true });
              if (email) {
                emailDeliveryService.sendBookingAssigned(
                  email,
                  {
                    id: booking.id,
                    serviceTitle: booking.service.name,
                    proName: `${booking.provider?.user.firstName ?? "Pro"} ${booking.provider?.user.lastName ?? ""}`.trim(),
                  },
                  customer.firstName,
                );
              }
            }
          }
        }

        void assignmentEngine.onProviderAccepted(id, providerId).catch(() => undefined);
        void partnerOperationsService
          .syncCurrentStatus(providerId)
          .then(() => partnerOperationsService.emitCapacityIfChanged(providerId))
          .catch(() => undefined);

        return { ok: true, booking, newlyAccepted };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
            continue;
          }
        }
        if (error instanceof Error) {
          // Provider/user slot exclusion → treat as availability conflict (not a dead DB).
          if (
            /bookings_provider_slot_excl|bookings_user_slot_excl|exclusion constraint/i.test(
              error.message,
            )
          ) {
            return { ok: false, error: "PROVIDER_UNAVAILABLE" };
          }
          if (error.message === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
          if (error.message === "ALREADY_ACCEPTED_BY_SELF") {
            const booking = await this.loadBookingForAccept(id);
            if (!booking) return { ok: false, error: "NOT_FOUND" };
            return { ok: true, booking, newlyAccepted: false };
          }
          if (error.message === "ALREADY_CLAIMED") return { ok: false, error: "ALREADY_CLAIMED" };
          if (error.message === "INVALID_STATUS") return { ok: false, error: "INVALID_STATUS" };
          /**
           * Reported as its own outcome, never folded into INVALID_STATUS.
           *
           * A partner who is told "invalid status" for an unpaid booking will retry, escalate, and
           * eventually be told the app is broken. "This booking has not been paid for" is a
           * different fact about a different thing, and the partner app can only say so if the
           * reason survives the trip out of the service.
           */
          if (error.message === PAYMENT_GATE_REASON.NOT_SETTLED) {
            return { ok: false, error: PAYMENT_GATE_REASON.NOT_SETTLED };
          }
          if (error.message === "PROVIDER_UNAVAILABLE" || error.message === "OVERLAPPING_BOOKING") {
            return { ok: false, error: "PROVIDER_UNAVAILABLE" };
          }
          if (error.message === "CAPACITY_LIMIT") return { ok: false, error: "CAPACITY_LIMIT" };
          if (error.message === "ACCOUNT_RESTRICTED") return { ok: false, error: "ACCOUNT_RESTRICTED" };
          if (error.message === "STALE_LOCATION") return { ok: false, error: "STALE_LOCATION" };
          if (error.message === "STALE_PRESENCE") return { ok: false, error: "STALE_PRESENCE" };
          if ((MATCHING_REJECTION_REASONS as readonly string[]).includes(error.message)) {
            return { ok: false, error: error.message as MatchingRejectionReason };
          }
        }
        throw error;
      }
    }

    return { ok: false, error: "INVALID_STATUS" };
  }

  /** Confirm this provider may accept — restore tentative assignment when needed. */
  private async resolveAcceptingProvider(
    tx: Prisma.TransactionClient,
    bookingId: string,
    providerId: string,
    currentProviderId: string | null,
  ): Promise<string> {
    if (currentProviderId === providerId) return providerId;

    const sentAttempt = await tx.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.SENT,
        job: { bookingId },
      },
      orderBy: { dispatchedAt: "desc" },
    });
    if (sentAttempt) {
      await tx.booking.update({ where: { id: bookingId }, data: { providerId } });
      return providerId;
    }

    const graceSince = new Date(Date.now() - ASSIGN_ACCEPT_GRACE_MS);
    const recentTimeout = await tx.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.TIMEOUT,
        job: { bookingId },
        respondedAt: { gte: graceSince },
      },
      orderBy: { dispatchedAt: "desc" },
    });
    if (recentTimeout) {
      await tx.assignmentAttempt.update({
        where: { id: recentTimeout.id },
        data: { status: AssignmentAttemptStatus.SENT, respondedAt: null, responseMs: null },
      });
      await tx.assignmentJob.updateMany({
        where: { bookingId },
        data: {
          status: AssignmentJobStatus.DISPATCHED,
          currentProviderId: providerId,
          timeoutAt: new Date(Date.now() + ASSIGN_ACCEPT_GRACE_MS),
        },
      });
      await tx.booking.update({ where: { id: bookingId }, data: { providerId } });
      return providerId;
    }

    throw new Error("NOT_FOUND");
  }

  private async loadBookingForAccept(id: string) {
    return prisma.booking.findUnique({
      where: { id },
      include: { provider: { include: { user: true } }, service: true, user: true },
    });
  }

  async reject(providerId: string, id: string, reason: string) {
    const booking = await prisma.booking.findFirst({
      where: { id, status: BookingStatus.PENDING },
      include: { service: true },
    });
    if (!booking) return { error: "NOT_FOUND" as const };

    const openAttempt = await prisma.assignmentAttempt.findFirst({
      where: {
        providerId,
        status: AssignmentAttemptStatus.SENT,
        job: { bookingId: id },
      },
    });
    if (!openAttempt && booking.providerId !== providerId) {
      return { error: "NOT_FOUND" as const };
    }

    await assignmentEngine.onProviderRejected(id, providerId, reason);

    if (booking.userId) {
      // Detached: the rejection is committed. A throw here used to skip the re-dispatch below,
      // so a rejected booking was never offered to another partner.
      await notificationService.createForUserDetached(
        {
          userId: booking.userId,
          type: "booking_reassigned",
          title: "Finding another professional",
          message: `We're matching you with another provider for ${booking.service?.name ?? "your service"}.`,
          referenceId: id,
          referenceType: "booking",
        },
        { bookingId: id, stage: "reject" },
      );
    }

    assignmentEngine.dispatchBookingNowBackground(id);
    return { ok: true as const };
  }

  /**
   * Explicit "I'm on my way" from the partner.
   *
   * This is the authoritative producer of `enRouteAt`. Before it existed the timestamp
   * was written only as a side effect of a GPS stream that just one client emitted, so a
   * partner who started a job without that stream lost the travel-start anchor forever —
   * 3 of 108 completed bookings ever recorded one. GPS is now corroboration, not the
   * sole source.
   *
   * Idempotent: repeat calls return `newlyTransitioned: false` and change nothing.
   */
  async markEnRoute(
    providerId: string,
    id: string,
    lat: number | null,
    lng: number | null,
  ): Promise<
    | { ok: true; newlyTransitioned: boolean; enRouteAt: Date | null }
    | { ok: false; error: "NOT_FOUND" | "INVALID_STATUS" }
  > {
    const booking = await prisma.booking.findFirst({
      where: { id, providerId },
      select: {
        status: true,
        enRouteAt: true,
        arrivedAt: true,
        eta: true,
        address: { select: { latitude: true, longitude: true } },
      },
    });
    if (!booking) return { ok: false as const, error: "NOT_FOUND" };

    // Already past the transition — report success without re-writing the timestamp.
    if (booking.enRouteAt) {
      recordEtaLifecycleTransition("en_route", "explicit_partner_action", "duplicate");
      return { ok: true as const, newlyTransitioned: false, enRouteAt: booking.enRouteAt };
    }
    // Departure cannot be declared after arrival. The staged CTA prevents this in both
    // clients, but the endpoint must be safe on its own — accepting it would stamp
    // enRouteAt after arrivedAt and yield a negative travel duration.
    if (booking.arrivedAt) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }
    if (!["ACCEPTED", "ASSIGNED"].includes(booking.status)) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }

    // UNKNOWN GPS (null / 0,0 / non-finite) yields no distance rather than a distance from 0°,0°.
    const fix = knownCoords(lat, lng);
    const distanceKm =
      fix && booking.address
        ? distanceBetweenKm(fix.latitude, fix.longitude, booking.address.latitude, booking.address.longitude)
        : null;

    const applied = await trackingService.commitEnRoute({
      bookingId: id,
      providerId,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      googleEtaMin: booking.eta ?? null,
      source: "explicit_partner_action",
    });

    recordEtaLifecycleTransition(
      "en_route",
      "explicit_partner_action",
      applied ? "applied" : "duplicate",
    );

    const fresh = await prisma.booking.findUnique({ where: { id }, select: { enRouteAt: true } });
    return { ok: true as const, newlyTransitioned: applied, enRouteAt: fresh?.enRouteAt ?? null };
  }

  /**
   * Explicit "I've arrived" from the partner — the authoritative producer of `arrivedAt`.
   *
   * Races safely with both the GPS geofence and the job-start fallback: all three funnel
   * into `trackingService.recordArrival`, which is idempotent on `arrivedAt: null`.
   */
  async markArrived(
    providerId: string,
    id: string,
    lat: number | null,
    lng: number | null,
    /** The device's own word on the coordinates it sent (Android `mocked`); null = unknown. */
    mocked: boolean | null = null,
  ): Promise<
    | { ok: true; newlyTransitioned: boolean; arrivedAt: Date | null; requirementGate: GateResult | null }
    | {
        ok: false;
        error:
          | "NOT_FOUND"
          | "INVALID_STATUS"
          | "LOCATION_INVALID"
          | "LOCATION_REQUIRED"
          | "OUTSIDE_SERVICE_AREA"
          | "LOCATION_UNCONFIRMED"
          | "LOCATION_MISMATCH";
      }
  > {
    const booking = await prisma.booking.findFirst({
      where: { id, providerId },
      select: {
        status: true,
        arrivedAt: true,
        enRouteAt: true,
        assignedAt: true,
        eta: true,
        userId: true,
        address: { select: { city: true, latitude: true, longitude: true } },
        service: { select: { category: true } },
      },
    });
    if (!booking) return { ok: false as const, error: "NOT_FOUND" };

    if (booking.arrivedAt) {
      recordEtaLifecycleTransition("arrived", "explicit_partner_action", "duplicate");
      // Duplicate arrival still answers the gate question — a retry after a network error must not lose it.
      const requirementGate = await bookingRequirementService.evaluateAtArrival(id);
      return { ok: true as const, newlyTransitioned: false, arrivedAt: booking.arrivedAt, requirementGate };
    }
    // A booking that is finished or cancelled can no longer be arrived at.
    if (!["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"].includes(booking.status)) {
      return { ok: false as const, error: "INVALID_STATUS" };
    }

    const { assertJobProximity } = await import("../lib/job-proximity");
    const { confirmPartnerPosition, positionException, noteMockedLocation } = await import("./arrival-position.service");
    // A request that admits its own coordinates are mocked is on record; what decides is still the server-held fix.
    if (mocked === true) void noteMockedLocation({ providerId, bookingId: id, reportedBy: "arrive_request" });
    /**
     * A recorded exception (the customer's confirmation, an admin's waiver) is for a device that
     * cannot say where it is, so it is looked up BEFORE the request's coordinates are asked for.
     * Under it the coordinates are not judged at all: a phone that reports a wrong position is the
     * same broken device as one that reports none, and refusing it protected nothing (the same
     * request without coordinates was accepted) while stranding an honest partner.
     */
    const vouchedWithoutPosition = (await positionException(id, providerId)) != null;
    const proximity = vouchedWithoutPosition
      ? ({ ok: true } as const)
      : assertJobProximity({
          latitude: lat,
          longitude: lng,
          jobLatitude: booking.address?.latitude,
          jobLongitude: booking.address?.longitude,
          enforceRadius: true,
        });
    if (!proximity.ok) {
      if (booking.address && lat != null && lng != null) {
        void import("./partner-risk.service")
          .then(({ partnerRiskService }) =>
            partnerRiskService.evaluateArrival({
              providerId,
              bookingId: id,
              jobLat: booking.address!.latitude,
              jobLng: booking.address!.longitude,
              partnerLat: lat,
              partnerLng: lng,
            }),
          )
          .catch(() => undefined);
      }
      return { ok: false as const, error: proximity.error };
    }
    // The request's coordinates are the device's claim. What decides is the position the server holds.
    const held = await confirmPartnerPosition({ providerId, bookingId: id, action: "arrive", jobLatitude: booking.address?.latitude, jobLongitude: booking.address?.longitude });
    if (!held.ok) return { ok: false as const, error: held.error };
    /**
     * What is written down is the position the server held when it confirmed the arrival — never the
     * request's coordinates, and never the job address (W2-D2). Under an exception nothing was
     * confirmed, so no position is recorded.
     */
    const arriveLat = held.waived ? null : held.position.latitude;
    const arriveLng = held.waived ? null : held.position.longitude;

    const distanceKm = booking.address && arriveLat != null && arriveLng != null
      ? distanceBetweenKm(arriveLat, arriveLng, booking.address.latitude, booking.address.longitude)
      : null;

    if (held.waived) {
      // The arrival stands on somebody's word, not on a position. That is written to the booking's
      // record BEFORE the arrival, and a failure to write it refuses the arrival: an arrival that
      // was vouched for must never read afterwards as one a position confirmed.
      const { ARRIVAL_VOUCHED_ACTION } = await import("./arrival-position.service");
      await prisma.activityLog.create({
        data: {
          bookingId: id,
          providerId,
          action: ARRIVAL_VOUCHED_ACTION,
          description: held.by === "admin" ? "Arrival recorded on an admin's waiver: no position was confirmed" : "Arrival recorded on the customer's confirmation: no position was confirmed",
        },
      });
    }
    const applied = await trackingService.recordArrival({
      bookingId: id,
      providerId,
      enRouteAt: booking.enRouteAt,
      assignedAt: booking.assignedAt,
      city: booking.address?.city ?? null,
      serviceCategory: booking.service?.category ?? null,
      distanceKm,
      googleEtaMin: booking.eta ?? null,
      source: "explicit_partner_action",
    });

    recordEtaLifecycleTransition(
      "arrived",
      "explicit_partner_action",
      applied ? "applied" : "duplicate",
    );

    if (applied) {
      try {
        const { jobEvidenceService } = await import("./job-evidence.service");
        await jobEvidenceService.recordStage({
          bookingId: id,
          providerId,
          stage: "ARRIVAL",
          latitude: arriveLat ?? undefined,
          longitude: arriveLng ?? undefined,
          clientUploadId: `arrive:${id}`,
          // The device's own word on the fix this arrival rests on, beside the position (null = unknown).
          metadata: { locationMocked: held.locationMocked },
        });
      } catch {
        /* evidence best-effort */
      }
    }

    const fresh = await prisma.booking.findUnique({ where: { id }, select: { arrivedAt: true } });
    // §6: arrival is a fact and is never refused for a missing precondition (ADR-018), but this is
    // the moment both parties are told what blocks START. Evaluation only; the START gate refuses.
    const requirementGate = await bookingRequirementService.evaluateAtArrival(id);
    return { ok: true as const, newlyTransitioned: applied, arrivedAt: fresh?.arrivedAt ?? null, requirementGate };
  }

  async start(providerId: string, id: string, lat: number | null, lng: number | null, mocked: boolean | null = null) {
    const { assertJobProximity } = await import("../lib/job-proximity");
    const bookingForGeo = await prisma.booking.findFirst({
      where: { id, providerId },
      select: {
        status: true,
        userId: true,
        address: { select: { latitude: true, longitude: true } },
      },
    });
    if (!bookingForGeo) throw new Error("FORBIDDEN");
    // The position written with the start: the one the server held when it confirmed it. A repeat of
    // a start already made confirms nothing and leaves what was recorded alone (`undefined`).
    let startLat: number | null | undefined;
    let startLng: number | null | undefined;
    if (bookingForGeo.status !== "IN_PROGRESS") {
      if (
        !isBookingTransitionAllowed(
          bookingForGeo.status as BookingStatus,
          BookingStatus.IN_PROGRESS,
        )
      ) {
        throw new Error("FORBIDDEN");
      }
      const { confirmPartnerPosition, positionException, noteMockedLocation } = await import("./arrival-position.service");
      // As at arrival: a request that admits its coordinates are mocked is on record; the held fix decides.
      if (mocked === true) void noteMockedLocation({ providerId, bookingId: id, reportedBy: "start_request" });
      // As at arrival: under a recorded exception the request's coordinates are not judged.
      const vouchedWithoutPosition = (await positionException(id, providerId)) != null;
      if (!vouchedWithoutPosition) {
        const proximity = assertJobProximity({
          latitude: lat,
          longitude: lng,
          jobLatitude: bookingForGeo.address?.latitude,
          jobLongitude: bookingForGeo.address?.longitude,
          enforceRadius: true,
        });
        // W2-D2: no GPS substitution at start either — see the note at arrival.
        if (!proximity.ok) throw new Error(proximity.error);
      }
      const held = await confirmPartnerPosition({ providerId, bookingId: id, action: "start", jobLatitude: bookingForGeo.address?.latitude, jobLongitude: bookingForGeo.address?.longitude });
      if (!held.ok) throw new Error(held.error);
      startLat = held.waived ? null : held.position.latitude;
      startLng = held.waived ? null : held.position.longitude;
    }

    const startedAt = new Date();
    let newlyStarted = true;
    const started = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "partner", actorId: providerId, reason: "service started (customer PIN verified)" });
      /**
       * Defence in depth, not the primary control.
       *
       * accept() and admin assignment are where the gate is meant to bite; by the time a partner
       * presses start they are already at the address. This exists because three separate write
       * paths reach service execution and the one thing this incident proved is that a rule
       * enforced in only some of them is a rule with a hole in it.
       *
       * Expressed inside the `where` so the check and the write are one statement — a read followed
       * by an update could be overtaken by a refund landing in between.
       */
      const already = await tx.booking.findFirst({
        where: { id, providerId, status: "IN_PROGRESS" },
        include: { user: true },
      });
      if (already) {
        newlyStarted = false;
        return already;
      }

      /**
       * §6: REQUIRED_BEFORE_ARRIVAL and REQUIRED_AT_START bind here. Evaluated inside this
       * transaction with the state rows locked, so a check landing concurrently is ordered before
       * or after the start, never lost. Throws RequirementGateError (code REQUIREMENT_GATE_BLOCKED).
       */
      // §9 precedence: safety before preconditions — an open incident or active hold stops START first.
      await bookingSafetyService.assertSafe(tx, id, "START");
      await bookingRequirementService.assertStartAllowed(tx, id);

      const updated = await tx.booking.updateMany({
        where: {
          id,
          providerId,
          status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE"] },
          paymentStatus: PaymentStatus.SUCCESS,
        },
        data: { status: "IN_PROGRESS", startedAt },
      });
      if (updated.count === 0) {
        /**
         * Work out which rule refused, rather than reporting them as one thing.
         *
         * "FORBIDDEN" for an unpaid booking sends the partner to support to ask why the app is
         * broken. An administrator may also have already accepted responsibility for this exact
         * booking, in which case the payment state is not what is standing in the way and the start
         * must proceed.
         */
        const current = await tx.booking.findUnique({
          where: { id },
          select: { paymentStatus: true, providerId: true, status: true },
        });
        if (current && current.status === "IN_PROGRESS" && current.providerId === providerId) {
          /**
           * §6.16 — a concurrent start of the same job by the same partner won the row while this
           * one waited on the requirement-gate lock. This call is a retry, not a failure: it must
           * answer like the `already` branch above, or the app tells a partner who is mid-job that
           * they are forbidden to work.
           */
          newlyStarted = false;
        } else if (current && !isSettled(current.paymentStatus)) {
          // §5: refunded → start is never permitted, override or not (see RETURNED_PAYMENT_STATUSES).
          if (isPaymentReturned(current.paymentStatus)) throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);
          const overridden = (await hasAuditedPaymentGateOverride(id, tx)) || (await isNoPaymentFollowUp(id, tx));
          if (!overridden) throw new Error(PAYMENT_GATE_REASON.NOT_SETTLED);
          const forced = await tx.booking.updateMany({
            where: { id, providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE"] } },
            data: { status: "IN_PROGRESS", startedAt },
          });
          if (forced.count === 0) throw new Error("FORBIDDEN");
        } else {
          throw new Error("FORBIDDEN");
        }
      }
      const booking = await tx.booking.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!booking?.userId) throw new Error("FORBIDDEN");

      await tx.tracking.upsert({
        where: { bookingId: id },
        create: {
          bookingId: id,
          status: TrackingStatus.IN_PROGRESS,
          startLatitude: startLat,
          startLongitude: startLng,
          actualStartTime: startedAt,
        },
        update: {
          status: TrackingStatus.IN_PROGRESS,
          startLatitude: startLat,
          startLongitude: startLng,
          actualStartTime: startedAt,
        },
      });

      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingStartedEvent({
            bookingId: id,
            userId: booking.userId,
            providerId,
            startedAt,
          }),
        );
      }
      return booking;
    });

    if (newlyStarted) {
      publishBookingStatusBackground({
        bookingId: id,
        status: BookingStatus.IN_PROGRESS,
        userId: started.userId,
        extra: { startedAt: started.startedAt ?? new Date() },
      });
    }

    if (newlyStarted && started.userId) {
      // Detached: the job is already IN_PROGRESS. A throw here used to skip the START evidence
      // record and the arrival backfill, and a retry returns early on `newlyStarted === false`.
      await notificationService.createForUserDetached(
        {
          userId: started.userId,
          type: "service_started",
          title: "Service Started",
          message: "Your service provider has started the job",
          referenceId: id,
        },
        { bookingId: id, stage: "start" },
      );
    }

    // A partner who is starting the service has demonstrably arrived. Without this,
    // any job that skips the GPS geofence (ACCEPTED -> IN_PROGRESS directly) never
    // records arrivedAt, and Phase 2 can never accumulate ETA training labels.
    // Idempotent: a no-op if the geofence or the explicit action already recorded it.
    //
    // Fire-and-forget so telemetry can never fail a job start — but the failure is now
    // logged and counted instead of swallowed. The previous `.catch(() => undefined)`
    // meant a broken fallback left no trace anywhere.
    if (newlyStarted) {
      try {
        const { jobEvidenceService } = await import("./job-evidence.service");
        await jobEvidenceService.recordStage({
          bookingId: id,
          providerId,
          stage: "START",
          latitude: startLat ?? undefined,
          longitude: startLng ?? undefined,
          clientUploadId: `start:${id}`,
        });
      } catch {
        /* evidence best-effort */
      }

      void this.backfillArrivalFromStart(id, providerId, startLat ?? null, startLng ?? null).catch((err: unknown) => {
        recordEtaJobStartFallback("error");
        logger.error("eta_job_start_fallback_failed", {
          bookingId: id,
          providerId,
          source: "job_start",
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return started;
  }

  /**
   * Records arrival at job start when the geofence never fired.
   *
   * The timestamp is slightly later than true arrival — it includes any idle time
   * before work began — so it is tagged `job_start` and the ETA validator scores it
   * below a GPS-confirmed arrival rather than treating the two as equivalent.
   */
  private async backfillArrivalFromStart(
    bookingId: string,
    providerId: string,
    lat: number | null,
    lng: number | null,
  ): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        arrivedAt: true,
        enRouteAt: true,
        assignedAt: true,
        eta: true,
        address: { select: { city: true, latitude: true, longitude: true } },
        service: { select: { category: true } },
      },
    });
    if (!booking || booking.arrivedAt) return;

    const distanceKm = booking.address && lat != null && lng != null
      ? distanceBetweenKm(lat, lng, booking.address.latitude, booking.address.longitude)
      : null;

    const applied = await trackingService.recordArrival({
      bookingId,
      providerId,
      enRouteAt: booking.enRouteAt,
      assignedAt: booking.assignedAt,
      city: booking.address?.city ?? null,
      serviceCategory: booking.service?.category ?? null,
      distanceKm,
      googleEtaMin: booking.eta ?? null,
      source: "job_start",
    });

    recordEtaJobStartFallback(applied ? "applied" : "duplicate");
    recordEtaLifecycleTransition("arrived", "job_start", applied ? "applied" : "duplicate");
  }

  async complete(
    providerId: string,
    id: string,
    latIn: number | null,
    lngIn: number | null,
    notes?: string,
    opts?: {
      photos?: string[];
      skipSideEffects?: boolean;
      completedChecklist?: string[];
      /** The professional's attestation that the completion criteria were met (asked for only where the frozen policy requires it). */
      professionalConfirmed?: boolean;
      /** §5: who actually completed it, when that is not the partner (admin mark-complete). */
      auditActor?: { actorType: "admin"; actorId: string; reason: string };
    },
  ) {
    // Completion does not require a proof of presence; an unknown fix is recorded as absent
    // evidence, never as coordinates 0,0.
    const completionFix = knownCoords(latIn, lngIn);
    const lat = completionFix?.latitude;
    const lng = completionFix?.longitude;
    const existing = await prisma.booking.findFirst({
      where: { id, providerId },
      include: { service: { select: { name: true } } },
    });
    if (!existing) throw new Error("FORBIDDEN");

    /**
     * Phase 10 §10: every completion attempt leaves a verdict. A refused attempt's transaction rolls
     * back, so its verdict is recorded afterwards in its own short transaction (recordRefusal) and the
     * refusal is then rethrown unchanged — the published error codes (QUALITY_*, SAFETY_HOLD_ACTIVE,
     * EXECUTION_GATE_BLOCKED) keep their meaning, and the verdict rides along on the error. Without the
     * verdict table this is a no-op and completion behaves exactly as before.
     */
    const verdictsOn = await bookingQualityService.enabled();
    const verdictActor = opts?.auditActor
      ? { type: "SYSTEM" as const, id: opts.auditActor.actorId }
      : { type: "PARTNER" as const, id: providerId };
    const recordCompletionRefusal = async (err: unknown, reason: string) => {
      incCounter("completion_blocked_total", { reason });
      if (!verdictsOn) return;
      const v = await bookingQualityService
        .recordRefusal(id, verdictActor, { completedChecklist: opts?.completedChecklist, professionalConfirmed: opts?.professionalConfirmed })
        .catch((e: unknown) => {
          logger.error("quality_verdict_refusal_record_failed", { bookingId: id, error: e instanceof Error ? e.message : String(e) });
          return null;
        });
      if (v && err && typeof err === "object") {
        (err as { verdict?: unknown }).verdict = { id: v.id, verdict: v.verdict, reasonCodes: v.reasonCodes };
      }
    };

    // Safe retry: already completed for this partner — return current state, never double-pay.
    if (existing.status === "COMPLETED") {
      const duration =
        existing.actualDuration ??
        (existing.startedAt
          ? Math.round((existing.completedAt!.getTime() - existing.startedAt.getTime()) / 60000)
          : existing.estimatedDuration);
      return { booking: existing, totalDuration: duration ?? 0, newlyCompleted: false as const };
    }

    if (
      !isBookingTransitionAllowed(
        existing.status as BookingStatus,
        BookingStatus.COMPLETED,
      )
    ) {
      throw new Error("INVALID_STATUS");
    }

    /**
     * Photos sent with the completion are stored first, for every service — with or without a
     * quality policy. (They used to be stored only inside the quality gate below, so a service with
     * no policy accepted them, answered "completed", and kept nothing.) The position written with
     * them is the one the server holds for the partner, not the request's.
     */
    const { heldPartnerPosition } = await import("./arrival-position.service");
    const heldAtCompletion = await heldPartnerPosition(providerId);
    if (opts?.photos?.length) {
      // The photos are the images themselves (data URLs), stored by the server. A link is refused.
      // Judged by the same rules, and refused in the same words, as the evidence upload route:
      // the error carries which refusal it is (not an image, too large, too many, the same photo again).
      const { parseEvidencePhotos, EvidenceRefusedError } = await import("../lib/job-evidence-media");
      const photos = parseEvidencePhotos(opts.photos);
      if (!photos.ok) throw new EvidenceRefusedError(photos.refusal);
      const { jobEvidenceService } = await import("./job-evidence.service");
      await jobEvidenceService.recordStage({
        bookingId: id,
        providerId,
        stage: "COMPLETION",
        latitude: heldAtCompletion?.latitude,
        longitude: heldAtCompletion?.longitude,
        images: photos.images,
        // Named for the photos it carries: a second attempt with the same photos is the same upload,
        // one with different photos is a new one. (Under a fixed id, the photos of a retry after a
        // refused completion were answered with the first attempt's row and silently dropped.)
        clientUploadId: `complete-photos:${id}:${photos.images.map((i) => i.sha256).sort().join("").slice(0, 24)}`,
      });
    }

    const quality = qualityFromSnapshot(existing.serviceConfigSnapshot);
    if (quality) {
      /**
       * W2-D1. The gate reads DURABLE ROWS, never the request.
       *
       * Completion media used to be persisted AFTER this gate, on a best-effort path that
       * swallowed its own failures, while the in-flight `opts.photos` array was counted as proof
       * and, on its own, satisfied the AFTER half of a before/after requirement. A booking could
       * therefore complete against photos that were never stored. So when the caller brings media
       * it is written FIRST, and a write failure is a hard failure rather than a silent one —
       * otherwise the gate is being asked to trust a promise.
       */

      const evidenceRows = await prisma.jobEvidence.findMany({
        // The completing partner's own evidence: an earlier partner's photos prove nothing about this visit.
        where: { bookingId: id, isCurrent: true, providerId },
        select: { stage: true, mediaUrl: true, mediaStorageKey: true, bookingId: true, providerId: true },
      });
      /**
       * `opts.checklistComplete` is deliberately NOT passed. It was a client boolean that
       * satisfied the gate outright; it survives on the route only as a UI hint and has no
       * authority here. The submitted list is matched item by item against the FROZEN checklist,
       * because the previous length comparison accepted any three strings for a three-item list.
       */
      const evidence = resolveQualityEvidence({
        checklist: quality.checklist,
        submitted: opts?.completedChecklist,
        evidenceRows,
      });
      const blocked = qualityBlocksCompletion(quality, evidence);
      if (blocked) {
        incCounter("service_quality_completion_block_total", { reason: blocked });
        logger.warn("completion_blocked_by_quality", {
          category: "APPLICATION",
          bookingId: id,
          reason: blocked,
          photos: evidence.photos,
          hasBefore: evidence.hasBefore,
          hasAfter: evidence.hasAfter,
          missingChecklistItems: evidence.missingChecklistItems.length,
        });
        const refusal = new Error(blocked);
        await recordCompletionRefusal(refusal, blocked);
        throw refusal;
      }
      // An admin mark-complete is its own audited act; the attestation is asked of the professional.
      if (quality.professionalConfirmation && !opts?.auditActor && opts?.professionalConfirmed !== true) {
        const code = "QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED";
        incCounter("service_quality_completion_block_total", { reason: code });
        const refusal = new Error(code);
        await recordCompletionRefusal(refusal, code);
        throw refusal;
      }
    }

    void import("./partner-risk.service").then(async ({ partnerRiskService }) => {
      const addr = await prisma.address.findUnique({
        where: { id: existing.addressId },
        select: { latitude: true, longitude: true },
      });
      if (!addr) return;
      await partnerRiskService.evaluateCompletion({
        providerId,
        bookingId: id,
        jobLat: addr.latitude,
        jobLng: addr.longitude,
        partnerLat: lat ?? null,
        partnerLng: lng ?? null,
      });
    }).catch(() => undefined);

    const duration = existing.startedAt
      ? Math.round((Date.now() - existing.startedAt.getTime()) / 60000)
      : existing.estimatedDuration;
    const completedAt = new Date();
    let completionWindow: { confirmBy: Date; windowHours: number } | null = null;
    const { row: booking, newly } = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(
        tx,
        opts?.auditActor
          ? { actorType: opts.auditActor.actorType, actorId: opts.auditActor.actorId, reason: `completed by admin: ${opts.auditActor.reason}` }
          : { actorType: "partner", actorId: providerId, reason: "completed" },
      );
      // §10: serialise concurrent completes on the booking row, so the loser sees COMPLETED below.
      if (verdictsOn) await lockBookingRow(tx, id);
      /**
       * Phase 10 §8: every mandatory step COMPLETED, nothing FAILED or ESCALATED — evaluated inside
       * this transaction with the step rows locked. Throws ExecutionGateError (EXECUTION_GATE_BLOCKED).
       * A booking with no plan is not gated. An already-COMPLETED booking is answered below as before.
       */
      const current = await tx.booking.findUnique({ where: { id }, select: { status: true } });
      let verdictId: number | null = null;
      if (current?.status === "IN_PROGRESS") {
        await bookingSafetyService.assertSafe(tx, id, "COMPLETE");
        await bookingExecutionService.assertCompletionAllowed(tx, id);
        /**
         * Phase 10 §10: the verdict, derived from durable facts under this transaction's locks. Only
         * PASS / PASS_WITH_EXCEPTION may become COMPLETED; anything else is QUALITY_VERDICT_BLOCKED
         * (and recorded by recordCompletionRefusal once this transaction has rolled back).
         */
        if (verdictsOn) {
          const v = await bookingQualityService.evaluateAndRecord(tx, id, verdictActor, {
            completedChecklist: opts?.completedChecklist,
            // An admin mark-complete stands in for the attestation; it is audited as the admin's act.
            professionalConfirmed: opts?.professionalConfirmed === true || Boolean(opts?.auditActor),
          });
          if (v && !verdictAllowsCompletion(v.verdict)) {
            throw new QualityVerdictError({ verdict: v.verdict, reasonCodes: v.reasonCodes });
          }
          verdictId = v?.id ?? null;
        }
      }
      const claimed = await tx.booking.updateMany({
        where: { id, providerId, status: "IN_PROGRESS" },
        data: {
          status: "COMPLETED",
          completedAt,
          actualDuration: duration,
          providerNotes: notes,
        },
      });
      if (claimed.count === 0) {
        const raced = await tx.booking.findFirst({
          where: { id, providerId, status: "COMPLETED" },
        });
        // Lost the race to a concurrent complete: report it as not newly completed, so the caller
        // fires no second round of post-commit side effects.
        if (raced) return { row: raced, newly: false };
        throw new Error("INVALID_STATUS");
      }
      // §10: open the customer-confirmation window (booking_completions) in the same transaction.
      completionWindow = await bookingCompletionService.recordRequested(tx, {
        bookingId: id,
        verdictId,
        completedAt,
        snapshot: existing.serviceConfigSnapshot,
      });
      /**
       * §11: with booking_warranties deployed the warranty is a row written from the booking's frozen
       * warranty.v1 snapshot, and the snapshot itself is never rewritten. The legacy JSON patch into
       * serviceConfigSnapshot survives only for databases without that table.
       */
      const warrantyRows = await warrantyTablePresent(tx);
      if (warrantyRows) {
        await bookingCompletionService.startWarranty(tx, { bookingId: id, snapshot: existing.serviceConfigSnapshot, event: "COMPLETION", at: completedAt });
      }
      const warranty = warrantyRows ? null : warrantyWindow(quality, completedAt);
      if (warranty) {
        const prev = existing.serviceConfigSnapshot;
        const rec =
          prev && typeof prev === "object" && !Array.isArray(prev)
            ? { ...(prev as Record<string, unknown>) }
            : {};
        await tx.booking.update({
          where: { id },
          data: { serviceConfigSnapshot: { ...rec, warranty } as Prisma.InputJsonValue },
        });
      }
      const updated = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingCompletedEvent({
            bookingId: id,
            userId: updated.userId,
            providerId: updated.providerId,
            serviceId: updated.serviceId,
            completedAt,
            actualDurationMin: duration ?? existing.estimatedDuration ?? 0,
            finalAmount: updated.finalAmount,
            finalAmountPaise: updated.finalAmountPaise,
          }),
        );
      }
      /**
       * The partner is paid in the same transaction that marks the job done.
       *
       * These used to be two transactions: the booking was committed COMPLETED, and only then
       * was the wallet credited, the earning row written and the ledger posted. Anything that
       * interrupted the gap — a process restart, a dropped request — left a finished job with
       * no earning attached, no error anywhere, and a partner whose dashboard simply showed
       * nothing. Six of a hundred and eleven completed bookings were in that state.
       *
       * Joining them means a failure now rolls the completion back too, so the partner sees a
       * job that did not complete and can retry, rather than one that completed for free.
       */
      if (existing.providerId) {
        const alreadyEarned = await tx.earning.findUnique({ where: { bookingId: id } });
        if (!alreadyEarned) {
          /**
           * X-5 — a REWORK / REVISIT follow-up (§11) is a return visit to a job that already
           * counted: completing it must not increment the partner's volume counters, and a waived
           * (₹0) follow-up writes no earning row at all — a ₹0 earning made the visit look like a
           * standard job to tiers, incentives and analytics. A PAID follow-up, if ever configured,
           * still pays (wallet + earning + ledger) but still adds no volume. Read via raw SQL on
           * this tx behind the column probe: a pre-§11 database answers STANDARD and behaves as
           * before. STANDARD bookings are byte-for-byte unchanged, including a ₹0 standard job.
           */
          const followUp = isFollowUpKind(await getBookingKind(id, tx));
          // Computed through `tx` so the commission tier counts this booking, matching the
          // behaviour of the previous ordering where the status was already committed.
          const breakdown = await earningsService.calculateBookingEarning(id, tx);
          const paysOut = !followUp || breakdown.netEarning > 0;
          if (followUp) {
            incCounter("booking_followup_completed_total", { paid: paysOut ? "yes" : "no" });
          }
          if (paysOut) {
            const { rupeesToPaise } = await import("../lib/money-paise");

            await tx.provider.update({
              where: { id: existing.providerId },
              data: {
                walletBalance: { increment: breakdown.netEarning },
                walletBalancePaise: { increment: rupeesToPaise(breakdown.netEarning) },
                totalEarnings: { increment: breakdown.netEarning },
                ...(followUp ? {} : { completedBookings: { increment: 1 } }),
              },
            });
            await tx.earning.create({
              data: {
                providerId: existing.providerId,
                bookingId: id,
                grossAmount: breakdown.bookingAmount,
                commission: breakdown.commission,
                netEarning: breakdown.netEarning,
              },
            });
            await financialLedgerService.recordProviderEarningInTransaction(
              tx,
              id,
              breakdown.bookingAmount,
              breakdown.commission,
              breakdown.netEarning,
              breakdown.bonus,
              breakdown.deduction,
            );
            const earningRow = await tx.earning.findUnique({ where: { bookingId: id } });
            if (earningRow) {
              const { buildPartnerEarningsPostedEvent } = await import("../events/catalog/partner.events");
              const { emitPartnerEvent } = await import("../events/core/partner-event-emit");
              await emitPartnerEvent(
                buildPartnerEarningsPostedEvent({
                  providerId: existing.providerId,
                  bookingId: id,
                  earningId: earningRow.id,
                  netEarning: breakdown.netEarning,
                  grossAmount: breakdown.bookingAmount,
                }),
                tx,
              );
            }
          }
        }
      }
      return { row: updated, newly: true };
    }).catch(async (err: unknown) => {
      // §10: a gate refusal rolled everything back — record the verdict durably, then refuse as before.
      if (err instanceof QualityVerdictError) await recordCompletionRefusal(err, err.data.reasonCodes[0] ?? "QUALITY_VERDICT_BLOCKED");
      else if (err instanceof SafetyGateError) await recordCompletionRefusal(err, "SAFETY_HOLD_ACTIVE");
      else if (err instanceof ExecutionGateError) await recordCompletionRefusal(err, "EXECUTION_GATE_BLOCKED");
      throw err;
    });

    if (!newly) {
      // A concurrent complete won. Its call owns every side effect below; this one reports state only.
      const totalDuration =
        booking.actualDuration ??
        (booking.startedAt && booking.completedAt
          ? Math.round((booking.completedAt.getTime() - booking.startedAt.getTime()) / 60000)
          : booking.estimatedDuration);
      return { booking, totalDuration: totalDuration ?? 0, newlyCompleted: false as const };
    }

    /**
     * Persist completion evidence (GPS + optional media refs) outside the money txn — evidence
     * failure must not roll back earnings once COMPLETED+Earning committed.
     *
     * W2-D1: when the booking has a quality policy, the media was already written BEFORE the
     * gate, awaited and non-swallowing, because the gate has to read durable rows. This call
     * still runs for the GPS stamp and for bookings with no quality policy; `clientUploadId`
     * makes the repeat a no-op rather than a second row.
     */
    try {
      const { jobEvidenceService } = await import("./job-evidence.service");
      await jobEvidenceService.recordStage({
        bookingId: id,
        providerId,
        stage: "COMPLETION",
        // The position the server held, as on every other stamp — never the request's coordinates.
        latitude: heldAtCompletion?.latitude,
        longitude: heldAtCompletion?.longitude,
        clientUploadId: `complete:${id}`,
      });
    } catch {
      /* evidence is best-effort after money path; list/upload APIs remain available */
    }

    // Money path is committed above; the customer must learn about completion even when the
    // caller skips the remaining side effects (batch/backfill callers).
    publishBookingStatusBackground({
      bookingId: id,
      status: BookingStatus.COMPLETED,
      userId: booking.userId,
      extra: { completedAt: booking.completedAt ?? new Date(), totalDuration: duration ?? 0 },
    });

    if (opts?.skipSideEffects) {
      return { booking, totalDuration: duration ?? 0, newlyCompleted: true as const };
    }

    incCounter("booking_completed_total");
    if (existing.providerId) {
      void partnerOperationsService
        .syncCurrentStatus(existing.providerId)
        .then(() => partnerOperationsService.emitCapacityIfChanged(existing.providerId!))
        .catch(() => undefined);
      const pid = existing.providerId;
      void import("./rating.service")
        .then(({ ratingService }) => ratingService.updateProviderMetrics(pid))
        .catch(() => undefined);
    }
    await prisma.tracking.updateMany({
      where: { bookingId: id },
      data: { status: TrackingStatus.COMPLETED, actualEndTime: new Date(), totalDuration: duration },
    });
    if (existing.providerId) {
      const provider = await prisma.provider.findUnique({
        where: { id: existing.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        void earningsLiveService.broadcastEarningsUpdate(provider.userId).catch(() => undefined);
      }
      void partnerIncentivePayoutService
        .evaluateAndCreditIncentives(existing.providerId)
        .catch(() => undefined);
      void import("./partner-referral.service").then(({ partnerReferralService }) =>
        partnerReferralService.onJobCompleted(existing.providerId!, id),
      ).catch(() => undefined);
    }
    if (booking.userId) {
      // Detached: earnings are committed. A throw here used to skip the referral, H-Coin and
      // cashback credits below AND the completion email — permanently, because a retry returns
      // early on `status === COMPLETED`.
      // §10: when a confirmation window was opened, this ONE message asks the customer to confirm or
      // report an issue (booking.completion_confirm_request) instead of a second notification.
      const confirmMsg = completionWindow
        ? bookingCompletionService.confirmRequestMessage(
            (await prisma.user.findUnique({ where: { id: booking.userId }, select: { defaultLanguage: true } }))?.defaultLanguage ?? "en",
            booking.bookingNumber,
            (completionWindow as { windowHours: number }).windowHours,
          )
        : null;
      await notificationService.createForUserDetached(
        {
          userId: booking.userId,
          type: "booking_completed",
          title: confirmMsg?.title ?? "Service Completed",
          message: confirmMsg?.body ?? "Please rate your experience",
          referenceId: id,
          priority: "high",
        },
        { bookingId: id, stage: "complete" },
      );
      // Referral engine: a completed booking may qualify the customer's referrer.
      void fraudContextForUser(booking.userId)
        .then((ctx) => referralService.onBookingCompleted(booking.userId, id, ctx))
        .catch(() => {});
      // Loyalty: reward H-Coins for completing a booking.
      // Loyalty credits are best-effort after the money path, but a failure must not vanish:
      // a customer's cashback silently not arriving is a support ticket, not a non-event.
      void hcoinService.earn(booking.userId, "BOOKING_COMPLETED", id).catch((err: unknown) => {
        incCounter("booking_loyalty_credit_failed_total", { kind: "hcoin" });
        logger.error("booking_hcoin_credit_failed", { bookingId: id, error: err instanceof Error ? err.message : String(err) });
      });
      void cashbackService.creditOnBookingComplete(booking.userId, id).catch((err: unknown) => {
        incCounter("booking_loyalty_credit_failed_total", { kind: "cashback" });
        logger.error("booking_cashback_credit_failed", { bookingId: id, error: err instanceof Error ? err.message : String(err) });
      });
      const customer = await prisma.user.findUnique({ where: { id: booking.userId } });
      if (customer) {
        const email = await userPiiService.resolveEmail(customer, { actorId: booking.userId, authorized: true });
        if (email) {
          emailDeliveryService.sendBookingCompleted(
            email,
            { id, serviceTitle: existing.service?.name ?? "Service" },
            customer.firstName,
          );
        }
      }
    }
    return { booking, totalDuration: duration ?? 0, newlyCompleted: true as const };
  }

  /**
   * The ONE cancellation path — customer, assigned partner, and admin (adminBookingOperations).
   * Status guard, refund quote, refund, offer cleanup, outbox event and notifications all live here;
   * an admin cancel used to fall back to a bare status write that skipped every one of them.
   */
  async cancel(
    actor: { userId: string; providerId?: string; admin?: { refundPolicy: AdminRefundPolicy } },
    id: string,
    reason: string,
  ) {
    const MAX_BOOKING_TX_RETRIES = 8;
    const cancellableStatuses = [
      "PENDING",
      "ACCEPTED",
      "ASSIGNED",
      "EN_ROUTE",
      "IN_PROGRESS",
    ] as const;

    for (let attempt = 0; attempt < MAX_BOOKING_TX_RETRIES; attempt++) {
      try {
        const locked = await prisma.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                status: string;
                user_id: string;
                provider_id: string | null;
                payment_status: string;
                scheduled_date: Date;
                final_amount: number;
                payment_method: string | null;
                service_config_snapshot: unknown;
              }>
            >`
              SELECT id, status, user_id, provider_id, payment_status, scheduled_date, final_amount, payment_method,
                     service_config_snapshot
              FROM bookings
              WHERE id = ${id}
              FOR UPDATE
            `;
            const row = rows[0];
            if (!row) return { error: "NOT_FOUND" as const };

            let cancelledBy: CancellationActor;
            if (actor.admin) {
              // Authorised by the admin route's RBAC (BOOKINGS:APPROVE), not by ownership.
              cancelledBy = "admin";
            } else {
              const actorResolution = resolveBookingCancelActor(actor.userId, actor.providerId, {
                userId: row.user_id,
                providerId: row.provider_id,
              });
              if (!actorResolution.allowed) return { error: "NOT_FOUND" as const };
              cancelledBy = actorResolution.cancelledBy;
            }
            if (row.status === "COMPLETED") return { error: "INVALID_STATUS" as const };
            if (
              row.status === "CANCELLED_BY_USER" ||
              row.status === "CANCELLED_BY_PROVIDER" ||
              row.status === "REJECTED"
            ) {
              return { error: "INVALID_STATUS" as const };
            }
            if (!cancellableStatuses.includes(row.status as (typeof cancellableStatuses)[number])) {
              return { error: "INVALID_STATUS" as const };
            }
            /**
             * O3b (owner decision 2026-09-23): once the service has STARTED a customer may not use
             * the ordinary cancellation path. A professional is on site and working, so ending the
             * job is a controlled stop — an authorised decision by the partner ending their own job
             * or by support, who can see what was actually done. It is deliberately NOT routed to
             * the no-show rules: an IN_PROGRESS booking is `BOOKING_NOT_AWAITING_CUSTOMER` there,
             * and recording an absence that did not happen would be worse than refusing.
             *
             * The `in_progress` tier stays as data — a controlled stop still settles at it. What
             * this refuses is the customer invoking it themselves.
             */
            if (row.status === "IN_PROGRESS" && cancelledBy === "user") {
              return { error: "SERVICE_IN_PROGRESS" as const };
            }

            return {
              ok: true as const,
              paymentStatus: row.payment_status,
              cancelledBy,
              userId: row.user_id,
              bookingStatus: row.status,
              scheduledDate: row.scheduled_date,
              finalAmount: row.final_amount,
              paymentMethod: row.payment_method,
              providerId: row.provider_id,
              // The terms this booking was sold under (null for rows created before snapshots).
              cancellationPolicy: cancellationPolicyFromSnapshot(row.service_config_snapshot),
            };
          },
          { isolationLevel: "Serializable" },
        );

        if ("error" in locked && locked.error) return { error: locked.error };

        // An admin cancellation is recorded as CANCELLED_BY_USER with cancelledBy "admin": the
        // BY_PROVIDER status feeds partner reliability/risk scoring and must never be charged to a
        // partner for a decision support made.
        const status =
          locked.cancelledBy === "provider"
            ? BookingStatus.CANCELLED_BY_PROVIDER
            : BookingStatus.CANCELLED_BY_USER;

        const payment = await prisma.payment.findUnique({
          where: { bookingId: id },
          select: { paymentMethod: true, razorpayPaymentId: true },
        });
        // Refund what is still refundable across every tender (gateway, wallet, or both for a split),
        // net of anything support already refunded — the same base `quoteForBooking` shows the customer.
        const refundable =
          locked.paymentStatus === "SUCCESS" ? await bookingRefundService.refundableRemaining(id, locked.userId) : null;

        const quote = cancellationPolicyService.calculate({
          paidAmount: refundable ?? locked.finalAmount,
          scheduledDate: locked.scheduledDate,
          bookingStatus: locked.bookingStatus,
          cancelledBy: locked.cancelledBy,
          adminRefundPolicy: actor.admin?.refundPolicy,
          // How the money arrived, not what the booking was labelled (see `refundTenderLabel`).
          paymentMethod: refundTenderLabel(payment, locked.paymentMethod),
          policy: locked.cancellationPolicy,
        });

        const refundStatus =
          quote.refundAmount > 0 && locked.paymentStatus === "SUCCESS" ? "pending" : "none";

        /**
         * What will actually be refunded — the only amount that may be recorded or announced.
         *
         * `quote.refundAmount` is what the policy returns on the amount in question. For a booking
         * that was never paid that amount is its PRICE, so the quote is a number with no money behind
         * it. It used to be written to `bookings.refund_amount`, the outbox event, the realtime frame
         * and the notification, and a customer who had paid nothing was told a refund was on the way.
         */
        const refundAmount = refundStatus === "pending" ? quote.refundAmount : 0;

        /**
         * The fee and the message are the policy TIER's, and describe money that was paid. When no
         * payment completed there is no fee to keep and nothing to refund, whatever the timing — the
         * free tier's "Free cancellation — full refund." was returned for bookings nobody had paid for.
         * A paid booking whose refund is ₹0 keeps its tier message: that fee is real.
         */
        const nothingPaid = !PAID_BOOKING_STATUSES.has(locked.paymentStatus);
        const cancellationFee = nothingPaid ? 0 : quote.feeAmount;
        const refundMessage = nothingPaid ? UNPAID_CANCEL_MESSAGE : quote.message;

        const cancelledAt = new Date();
        let closedOfferProviderIds: string[] = [];
        const applied = await prisma.$transaction(async (tx) => {
          await setBookingAuditContext(tx, {
            actorType: locked.cancelledBy === "admin" ? "admin" : locked.cancelledBy === "user" ? "customer" : "partner",
            actorId: actor.userId,
            reason: `cancelled: ${reason}`,
          });
          const count = await tx.booking.updateMany({
            where: {
              id,
              status: { in: [...cancellableStatuses] },
              // The refund above was quoted for THIS payment state. A payment that settled in between
              // must not be cancelled against an "unpaid" quote (money kept, nothing refunded):
              // the write misses and the loop re-reads.
              paymentStatus: locked.paymentStatus as PaymentStatus,
            },
            data: {
              status,
              cancelledAt,
              cancellationReason: reason,
              cancelledBy: locked.cancelledBy,
              refundAmount,
              refundStatus,
            },
          });
          if (count.count === 0) return 0;

          // Open offers close with the booking, atomically (see assignmentEngine.closeOffersInTx).
          closedOfferProviderIds = await assignmentEngine.closeOffersInTx(tx, id, { kind: "cancelled" });

          if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
            await emitInTransaction(
              tx,
              buildBookingCancelledEvent({
                bookingId: id,
                userId: locked.userId,
                providerId: locked.providerId,
                cancelledBy: locked.cancelledBy,
                status,
                refundAmount,
                cancelledAt,
                actorType:
                  locked.cancelledBy === "admin" ? "admin" : locked.cancelledBy === "user" ? "customer" : "partner",
                actorId: actor.userId,
              }),
            );
          }
          return count.count;
        });

        if (applied === 0) {
          const now = await prisma.booking.findUnique({ where: { id }, select: { status: true, paymentStatus: true } });
          if (
            now &&
            cancellableStatuses.includes(now.status as (typeof cancellableStatuses)[number]) &&
            now.paymentStatus !== locked.paymentStatus &&
            attempt < MAX_BOOKING_TX_RETRIES - 1
          ) {
            incCounter("booking_cancel_payment_race_retry_total");
            continue;
          }
          return { error: "INVALID_STATUS" as const };
        }

        incCounter("booking_cancelled_total", { by: locked.cancelledBy });
        if (refundAmount > 0) recordFinancialMetric("refund_total", 1);

        for (const pid of closedOfferProviderIds) {
          void evictProviderFromBooking(id, pid, "offer_withdrawn").catch(() => undefined);
        }

        if (refundAmount > 0 && locked.paymentStatus === "SUCCESS") {
          void bookingRefundService
            .processCancellationRefund({
              bookingId: id,
              userId: locked.userId,
              actorUserId: actor.userId,
              reason,
              cancelledBy: locked.cancelledBy,
              refundAmount,
            })
            .then(async (refundResult) => {
              await prisma.booking.updateMany({
                where: { id },
                data: { refundStatus: refundResult.status, refundAmount: refundResult.amount },
              });
            })
            .catch(() => undefined);
        }

        const bookingRow = await prisma.booking.findUnique({
          where: { id },
          include: { service: true, provider: { include: { user: true } } },
        });

        publishBookingStatusBackground({
          bookingId: id,
          status,
          userId: bookingRow?.userId ?? null,
          providerUserId: bookingRow?.provider?.userId ?? null,
          extra: {
            cancelledBy: locked.cancelledBy,
            refundAmount,
            refundStatus,
            cancellationFee,
          },
        });

        if (bookingRow?.userId && locked.cancelledBy === "admin") {
          await notificationService.createForUserDetached({
            userId: bookingRow.userId,
            type: "booking_cancelled_by_support",
            title: "Booking cancelled by Homeeigo support",
            message:
              refundAmount > 0
                ? `Your ${bookingRow.service?.name ?? "booking"} was cancelled by support — ₹${refundAmount} refund is on the way.`
                : `Your ${bookingRow.service?.name ?? "booking"} was cancelled by support.`,
            referenceId: id,
            referenceType: "booking",
          });
        }
        if (bookingRow?.provider?.userId && locked.cancelledBy === "admin") {
          void notificationService.notifyBookingCancelled(bookingRow.provider.userId, id, reason);
        }

        if (bookingRow?.userId && locked.cancelledBy === "provider") {
          // Detached: the cancellation is committed. A throw re-entered the retry loop, and the
          // second pass reported INVALID_STATUS for a cancel that had actually succeeded.
          await notificationService.createForUserDetached({
            userId: bookingRow.userId,
            type: "booking_cancelled_by_provider",
            title: "Booking cancelled by professional",
            message:
              refundAmount > 0
                ? `${bookingRow.provider?.user.firstName ?? "Your professional"} cancelled — ₹${refundAmount} refund is on the way.`
                : `${bookingRow.provider?.user.firstName ?? "Your professional"} cancelled your ${bookingRow.service?.name ?? "booking"}.`,
            referenceId: id,
            referenceType: "booking",
          });
        }

        if (bookingRow?.provider?.userId && locked.cancelledBy === "user") {
          void notificationService.notifyBookingCancelled(
            bookingRow.provider.userId,
            id,
            reason,
          );
        }

        return {
          status: bookingStatusApi(status),
          refundAmount,
          refundStatus,
          cancellationFee,
          refundMessage,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (this.isRetryableBookingTxError(error) && attempt < MAX_BOOKING_TX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
            continue;
          }
        }
        throw error;
      }
    }

    return { error: "INVALID_STATUS" as const };
  }

  async upcoming(userId: string) {
    const rows = await prisma.booking.findMany({
      where: {
        userId,
        scheduledDate: { gte: new Date() },
        status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE"] },
      },
      orderBy: { scheduledDate: "asc" },
      take: 20,
      include: { service: true, provider: { include: { user: true } } },
    });
    return {
      bookings: rows.map((b) => ({
        id: b.id,
        bookingNumber: b.bookingNumber,
        status: bookingStatusApi(b.status),
        service: b.service.name,
        provider: b.provider ? `${b.provider.user.firstName} ${b.provider.user.lastName}` : "TBD",
        scheduledDate: b.scheduledDate,
        timeUntilBooking: formatTimeUntil(b.scheduledDate),
      })),
      total: rows.length,
    };
  }
}

function formatTimeUntil(date: Date): string {
  const diff = date.getTime() - Date.now();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 0) return `${days} days`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours > 0) return `${hours} hours`;
  return "soon";
}

export const bookingService = new BookingService();
