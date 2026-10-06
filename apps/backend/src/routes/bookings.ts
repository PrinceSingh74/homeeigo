import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { bookingService } from "../services/booking.service";
import { bookingStartOtpService } from "../services/booking-start-otp.service";
import { bookingRefundService } from "../services/booking-refund.service";
import { cancellationPolicyService } from "../services/cancellation-policy.service";
import { jobEvidenceService } from "../services/job-evidence.service";

/** What a partner is told when the server cannot place them at the job (arrival and start). */
const POSITION_MESSAGES = {
  LOCATION_UNCONFIRMED: "We could not confirm your position. Keep the app open with location on for a moment and try again. If your phone cannot get a location, contact support.",
  LOCATION_MISMATCH: "Your device's reported position is not at the service location. Go to the address, keep location on and try again.",
} as const;
import { bookingChatService } from "../services/booking-chat.service";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { NO_SHOW_POLICY } from "../lib/no-show-policy";
import { evaluateReschedule, reschedulePolicyFromSnapshot } from "../lib/reschedule-policy";
import { bookingContactService } from "../services/booking-contact.service";
import { getAvailableJobActions } from "../lib/job-action-policy";
import { bookingRequirementService, REQUIREMENT_ERRORS } from "../services/booking-requirement.service";
import { bookingExecutionService, EXECUTION_ERRORS } from "../services/booking-execution.service";
import { ExecutionGateError, EXECUTION_GATE_BLOCKED } from "../lib/service-execution";
import { bookingSafetyService } from "../services/booking-safety.service";
import { SafetyGateError, SAFETY_HOLD_ACTIVE, safetyGateMessage } from "../lib/service-safety";
import { hasAuditedPaymentGateOverride, isNoPaymentFollowUp, isPaymentReturned } from "../services/booking-payment-gate";
import { RequirementGateError, REQUIREMENT_GATE_BLOCKED, gateMessage } from "../lib/requirement-gates";
import { parseBody } from "../lib/route-security";
import {
  bookingCancelRouteSchema,
  bookingPriceQuoteSchema,
  createBookingSchema,
  geoPingSchema,
  optionalGeoPingSchema,
  updateBookingCustomerSchema,
} from "../schemas/booking.schema";
import { bookingPricingService } from "../services/booking-pricing.service";
import { customerPolicyService } from "../services/customer-policy.service";
import { AGE_POLICY_MESSAGES, type AgeReasonCode } from "../lib/customer-policy";
import { serviceAvailabilityService } from "../services/service-availability.service";
import { bookingAcceptSchema, bookingRejectSchema } from "../schemas/provider.schema";
import { validate } from "../middleware/validation.middleware";
import { idParamSchema } from "../schemas/common.schema";
import prisma from "../lib/prisma";
import { bookingQualityService } from "../services/booking-quality.service";
import { bookingCompletionService, COMPLETION_ERRORS } from "../services/booking-completion.service";
import { QualityVerdictError, QUALITY_VERDICT_BLOCKED } from "../lib/quality-verdict";

/** TypeBox `t.Optional(t.Number())` rejects JSON `null`. Soft GPS flows omit coords or send null. */
const tNullableNumber = t.Optional(t.Union([t.Number(), t.Null()]));

/** Customer-facing messages for rejected selections (see lib/service-catalog-config). */
const SELECTION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_VARIANT: "That option is not available for this service",
  INVALID_QUANTITY: "That quantity is not available for this service",
  INVALID_ADDON: "One of the selected add-ons is not available for this service",
  INVALID_AUDIENCE: "This option is not available for the selected person",
  INVALID_PREFERENCE: "That professional preference is not available for this service",
  INVALID_SELECTION: "This combination of options cannot be booked",
  INVALID_PACKAGE_PRICE: "That package price is not available for this service",
  SERVICE_NOT_BOOKABLE: "This service cannot be booked right now",
  SERVICE_NOT_AVAILABLE: "This service is not available at the selected address",
  SERVICE_VERSION_CHANGED: "This service was updated while you were choosing — please review your selection",
  SERVICE_UNAVAILABLE: "This service is not available",
  PRICING_CONFIG_MISSING: "Pricing unavailable for this configuration",
  REQUIREMENTS_CONFIG_INVALID: "This service cannot be booked right now — its preparation requirements are being updated",
  REQUIREMENT_CONFLICT: "This combination of options cannot be booked right now",
  EXECUTION_CONFIG_INVALID: "This service cannot be booked right now — its work plan is being updated",
};

/** Quote-integrity refusals on booking create: the response carries the fresh quote to show instead. */
/**
 * Phase D — customer age-policy refusals on booking create. Every code lib/customer-policy can
 * refuse with is mapped here, so none can reach the 201 below. 422 = the customer can act (add a
 * date of birth, give a guardian attestation); 403 = the customer is not eligible.
 */
const AGE_POLICY_ERRORS: Record<string, number> = {
  AGE_VERIFICATION_REQUIRED: 422,
  AGE_INPUT_INVALID: 422,
  GUARDIAN_ATTESTATION_REQUIRED: 422,
  POLICY_NOT_CONFIGURED: 422,
  AGE_BELOW_MINIMUM: 403,
  ADULT_REQUIRED: 403,
};

const QUOTE_ERRORS: Record<string, { status: number; message: string }> = {
  PRICE_CHANGED: { status: 409, message: "The price changed since your quote — please review the new total" },
  QUOTE_EXPIRED: { status: 409, message: "Your quote expired — please review the current price" },
  QUOTE_MISMATCH: { status: 400, message: "This quote was for a different selection" },
  QUOTE_INVALID: { status: 400, message: "Invalid quote" },
  QUOTE_REQUIRED: { status: 400, message: "Review the current price before booking" },
};

/**
 * §6.13 — one mapping for every requirement error, so a new code can never fall through to success.
 * Messages are human-safe; the code is stable; nothing internal leaks.
 */
function requirementError(set: { status?: number | string }, code: string) {
  const table: Record<string, { status: number; message: string }> = {
    [REQUIREMENT_ERRORS.NOT_FOUND]: { status: 404, message: "Booking not found" },
    [REQUIREMENT_ERRORS.REQUIREMENT_NOT_FOUND]: { status: 404, message: "This requirement is not part of the booking" },
    [REQUIREMENT_ERRORS.INVALID_STATUS]: { status: 409, message: "This booking is no longer being worked on" },
    [REQUIREMENT_ERRORS.REQUIREMENT_TRANSITION_FORBIDDEN]: { status: 403, message: "You cannot change this requirement" },
    REQUIREMENT_NOT_GATED: { status: 400, message: "This requirement is informational and has no state" },
    [REQUIREMENT_ERRORS.REQUIREMENT_STATE_CONFLICT]: { status: 409, message: "This requirement changed a moment ago — reload and try again" },
    [REQUIREMENT_ERRORS.REQUIREMENT_GATE_UNAVAILABLE]: { status: 503, message: "Requirement checks are not available right now" },
    OUTSIDE_SERVICE_AREA: { status: 400, message: "Move closer to the service location to record this check" },
    LOCATION_INVALID: { status: 400, message: "Valid GPS coordinates are required to record this check" },
    LOCATION_REQUIRED: { status: 400, message: "Location is required to record this check" },
    LOCATION_UNCONFIRMED: { status: 409, message: POSITION_MESSAGES.LOCATION_UNCONFIRMED },
    LOCATION_MISMATCH: { status: 409, message: POSITION_MESSAGES.LOCATION_MISMATCH },
  };
  const m = table[code] ?? { status: 400, message: "Unable to update this requirement" };
  set.status = m.status;
  return { success: false, error: m.message, code };
}

/** §8 — one mapping for every execution-step error; a new code can never fall through to success. */
function executionError(set: { status?: number | string }, code: string, detail?: string[]) {
  const table: Record<string, { status: number; message: string }> = {
    [EXECUTION_ERRORS.NOT_FOUND]: { status: 404, message: "Booking not found" },
    [EXECUTION_ERRORS.STEP_NOT_FOUND]: { status: 404, message: "This step is not part of the booking's work plan" },
    [EXECUTION_ERRORS.BOOKING_NOT_IN_PROGRESS]: { status: 409, message: "Start the job before working on its steps" },
    [EXECUTION_ERRORS.DEPENDENCY_INCOMPLETE]: { status: 409, message: "Finish the earlier steps first" },
    [EXECUTION_ERRORS.SAFETY_REQUIREMENT_UNMET]: { status: 409, message: "A safety requirement for this step is not in place" },
    [EXECUTION_ERRORS.EVIDENCE_REQUIRED]: { status: 400, message: "This step needs its evidence before it can be completed" },
    [EXECUTION_ERRORS.REASON_REQUIRED]: { status: 400, message: "Give a reason for this" },
    [EXECUTION_ERRORS.STEP_STATE_CONFLICT]: { status: 409, message: "This step changed a moment ago — reload and try again" },
    [EXECUTION_ERRORS.EXECUTION_UNAVAILABLE]: { status: 503, message: "Work steps are not available right now" },
    STEP_NOT_SKIPPABLE: { status: 403, message: "This step cannot be skipped" },
    STEP_NOT_STARTABLE: { status: 409, message: "This step has already been started" },
    STEP_NOT_IN_PROGRESS: { status: 409, message: "Start this step first" },
    STEP_NOT_RESETTABLE: { status: 409, message: "Only a failed or escalated step can be reset" },
    STEP_TRANSITION_FORBIDDEN: { status: 403, message: "You cannot do that to this step" },
  };
  const m = table[code] ?? { status: 400, message: "Unable to update this step" };
  set.status = m.status;
  return { success: false, error: m.message, code, ...(detail?.length ? { data: { detail } } : {}) };
}

export const bookingsRoutes = new Elysia({ prefix: "/api/bookings" })
  .use(authPlugin)
  .get("/upcoming", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await bookingService.upcoming(userId);
    return { success: true, data };
  })
  .post(
    "/price-quote",
    async ({ requireAuth, body: raw, set }) => {
      const { userId } = requireAuth();
      const body = parseBody(bookingPriceQuoteSchema, raw);
      let lat = body.lat;
      let lng = body.lng;
      if (body.addressId) {
        const address = await prisma.address.findFirst({
          where: { id: body.addressId, userId },
          select: { latitude: true, longitude: true },
        });
        if (!address) {
          set.status = 404;
          return { success: false, error: "Address not found", code: "ADDRESS_NOT_FOUND" };
        }
        lat = address.latitude;
        lng = address.longitude;
      }
      const result = await bookingPricingService.quote({
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
        lat,
        lng,
      });
      if (!result.ok) {
        if (result.error === "UPGRADE_REQUIRED") {
          set.status = 403;
          return {
            success: false,
            error: "Premium membership required for this service",
            code: "UPGRADE_REQUIRED",
          };
        }
        if (result.error === "INVALID_PACKAGE_PRICE") {
          set.status = 400;
          return { success: false, error: "Invalid package selection", code: "INVALID_PACKAGE_PRICE" };
        }
        if (result.error === "SERVICE_VERSION_CHANGED") {
          set.status = 409;
          return {
            success: false,
            error: SELECTION_ERROR_MESSAGES.SERVICE_VERSION_CHANGED,
            code: "SERVICE_VERSION_CHANGED",
            currentVersion: result.currentVersion,
          };
        }
        if (result.error in SELECTION_ERROR_MESSAGES) {
          set.status = 400;
          // `issues` lists every reason (additive; `code` keeps the legacy family clients switch on).
          return { success: false, error: SELECTION_ERROR_MESSAGES[result.error]!, code: result.error, issues: result.issues ?? [] };
        }
        set.status = 400;
        return { success: false, error: "Invalid service", code: "VALIDATION_ERROR" };
      }
      // Phase D: read-only age-policy outcome so the UI can explain before booking (no decision row).
      const customerPolicy = await customerPolicyService.preview({ customerId: userId, serviceId: body.serviceId, guardianAttested: body.guardianAttested });
      return { success: true, data: { quote: result.breakdown, customerPolicy } };
    },
    { body: bookingPriceQuoteSchema },
  )
  /**
   * Wave 4 — the slots a customer may actually choose, decided by the server.
   *
   * The booking step used to render six hardcoded times no server had agreed to, so a customer could
   * pick a slot the platform would then refuse. This returns the 30-minute grid for one day with each
   * slot's verdict, computed from the same rules booking create enforces.
   *
   * Authenticated: the answer depends on the caller's address when one is given, and an anonymous
   * capacity scan is a cheap way to map a partner's diary.
   */
  .get(
    "/availability",
    async ({ requireAuth, query, set }) => {
      const { userId } = requireAuth();
      const result = await serviceAvailabilityService.getDaySlots({
        serviceId: String(query.serviceId ?? ""),
        date: String(query.date ?? ""),
        userId,
        addressId: query.addressId ? String(query.addressId) : undefined,
        providerId: query.providerId ? String(query.providerId) : undefined,
        excludeBookingId: query.excludeBookingId ? String(query.excludeBookingId) : undefined,
      });
      if (!result.ok) {
        set.status = result.error === "SERVICE_NOT_FOUND" || result.error === "ADDRESS_NOT_FOUND" ? 404 : 400;
        return {
          success: false,
          error:
            result.error === "SERVICE_NOT_FOUND"
              ? "Service not found"
              : result.error === "ADDRESS_NOT_FOUND"
                ? "Address not found"
                : result.error === "INVALID_DATE"
                  ? "date must be YYYY-MM-DD"
                  : "This service is not available",
          code: result.error,
        };
      }
      return { success: true, data: result };
    },
    {
      query: t.Object({
        serviceId: t.String(),
        date: t.String(),
        addressId: t.Optional(t.String()),
        providerId: t.Optional(t.String()),
        excludeBookingId: t.Optional(t.String()),
      }),
    },
  )
  .get("/cancellation-policy", async () => {
    return {
      success: true,
      data: {
        tiers: cancellationPolicyService.listPublicTiers(),
        providerCancel: "Full refund when the professional cancels.",
        walletNote: "Wallet payments are refunded instantly to your HOMEEIGO wallet.",
        gatewayNote: "Card/UPI refunds typically arrive in 5–7 business days.",
      },
    };
  })
  .get(
    "/:id/cancellation-quote",
    async ({ requireAuth, params: rawParams, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const booking = await bookingService.getBookingAccess(params.id);
      if (!booking) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      const isOwner = booking.userId === auth.userId;
      const isProvider = auth.providerId && booking.providerId === auth.providerId;
      if (!isOwner && !isProvider) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      const quote = await bookingRefundService.quoteForBooking(
        params.id,
        isProvider ? "provider" : "user",
      );
      if (!quote) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      return { success: true, data: { quote } };
    },
  )
  /**
   * §45 / O6 — what moving THIS booking costs, before the customer commits.
   *
   * The mirror of `/cancellation-quote`, and deliberately the same shape of thing: the server
   * computes the fee from the booking's own appointment and its FROZEN policy, and the client
   * displays that number. A client that worked the percentage out for itself would be a second
   * pricing authority, and would disagree with the server the moment the policy changes.
   */
  .get("/:id/reschedule-quote", async ({ requireAuth, params: rawParams, set }) => {
    const { userId } = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const booking = await prisma.booking.findFirst({
      where: { id: params.id, userId },
      select: {
        status: true, scheduledDate: true, baseAmount: true, paymentStatus: true,
        serviceConfigSnapshot: true,
      },
    });
    if (!booking) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    const captured =
      booking.paymentStatus === "SUCCESS"
        ? ((await bookingRefundService.refundableRemaining(params.id, userId)) ?? 0)
        : 0;
    const quote = evaluateReschedule({
      scheduledDate: booking.scheduledDate,
      bookingStatus: booking.status,
      subtotal: booking.baseAmount,
      capturedAmount: captured,
      policy: reschedulePolicyFromSnapshot(booking.serviceConfigSnapshot),
    });
    return { success: true, data: { quote } };
  })
  .post(
    "/",
    async ({ requireVerifiedEmail, body: raw, set, request }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(createBookingSchema, raw, { description: { maxLen: 1000 } });
      // Phase 09: optional. A retry with the same key replays the first attempt's booking.
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
      const result = await bookingService.create(userId, {
        ...body,
        scheduledDate: body.scheduledDate.toISOString(),
        idempotencyKey,
      });
      if (result.error === "INVALID_IDEMPOTENCY_KEY") {
        set.status = 400;
        return { success: false, error: result.message ?? "Invalid Idempotency-Key", code: "INVALID_IDEMPOTENCY_KEY" };
      }
      if (result.error === "IDEMPOTENCY_KEY_REUSED") {
        set.status = 409;
        return {
          success: false,
          error: "This Idempotency-Key was already used for a different booking request.",
          code: "IDEMPOTENCY_KEY_REUSED",
        };
      }
      if (result.error === "IDEMPOTENCY_IN_PROGRESS") {
        set.status = 409;
        set.headers["Retry-After"] = "2";
        return { success: false, error: "The same booking request is still being processed.", code: "IDEMPOTENCY_IN_PROGRESS" };
      }
      if ("replayed" in result && result.replayed) {
        // The booking already exists: 200 (not 201), and say so, so a client can tell a replay
        // from a fresh creation without comparing ids.
        set.status = 200;
        set.headers["Idempotent-Replayed"] = "true";
        return { success: true, message: "Booking already created", data: { booking: result.booking }, replayed: true };
      }
      if (result.error === "PROVIDER_UNAVAILABLE") {
        set.status = 400;
        return {
          success: false,
          error: result.message ?? "Provider is not available",
          code: "PROVIDER_UNAVAILABLE",
          ...(result.reason ? { reason: result.reason } : {}),
        };
      }
      if (result.error === "OVERLAPPING_BOOKING") {
        set.status = 409;
        return { success: false, error: "You have an overlapping booking", code: "OVERLAPPING_BOOKING" };
      }
      /**
       * The transaction's own retries (serialization conflicts, pool exhaustion) ran out. That is a
       * transient refusal, and reschedule already answers it as 429 + Retry-After. Without this
       * branch the fail-closed catch-all below answered 400, which tells a client the request itself
       * is wrong and must not be retried (coding-phase certification, 2026-09-27).
       */
      if (result.error === "POOL_BUSY") {
        const retryAfter = 3;
        set.status = 429;
        set.headers["Retry-After"] = String(retryAfter);
        return { success: false, error: "System busy. Please retry in a few seconds.", code: "POOL_BUSY", retryAfter };
      }
      if (result.error === "UPGRADE_REQUIRED") {
        set.status = 403;
        return {
          success: false,
          error: "This is a premium-only service. Upgrade your membership to book it.",
          code: "UPGRADE_REQUIRED",
        };
      }
      if (result.error === "INVALID_PACKAGE_PRICE") {
        set.status = 400;
        return { success: false, error: "Invalid package selection", code: "INVALID_PACKAGE_PRICE" };
      }
      if (result.error && result.error in QUOTE_ERRORS) {
        const qe = QUOTE_ERRORS[result.error]!;
        set.status = qe.status;
        return {
          success: false,
          error: qe.message,
          code: result.error,
          // The current server quote, so the client can show the real price and re-confirm.
          quote: "quote" in result ? result.quote : undefined,
        };
      }
      if (result.error && result.error in AGE_POLICY_ERRORS) {
        set.status = AGE_POLICY_ERRORS[result.error]!;
        const code = result.error as AgeReasonCode;
        return { success: false, error: AGE_POLICY_MESSAGES[code] ?? "This booking could not be created", code };
      }
      if (result.error === "REQUIREMENTS_NOT_CONFIRMED") {
        set.status = 400;
        return {
          success: false,
          error: "Please confirm the requirements marked as needed before booking",
          code: "REQUIREMENTS_NOT_CONFIRMED",
          requirements: "requirements" in result ? result.requirements : [],
          quote: "quote" in result ? result.quote : undefined,
        };
      }
      if (result.error === "SERVICE_VERSION_CHANGED") {
        set.status = 409;
        return {
          success: false,
          error: SELECTION_ERROR_MESSAGES.SERVICE_VERSION_CHANGED,
          code: "SERVICE_VERSION_CHANGED",
          currentVersion: "currentVersion" in result ? result.currentVersion : undefined,
        };
      }
      if (result.error && result.error in SELECTION_ERROR_MESSAGES) {
        set.status = 400;
        return {
          success: false,
          error: SELECTION_ERROR_MESSAGES[result.error]!,
          code: result.error,
          issues: "issues" in result ? (result.issues ?? []) : [],
        };
      }
      if (
        result.error &&
        [
          "INVALID_CODE",
          "CAMPAIGN_INACTIVE",
          "NOT_STARTED",
          "EXPIRED",
          "MAX_REDEMPTIONS",
          "MIN_ORDER_NOT_MET",
          "PREMIUM_REQUIRED",
          "NO_DISCOUNT",
        ].includes(result.error)
      ) {
        set.status = 400;
        return { success: false, error: `Coupon error: ${result.error}`, code: result.error };
      }
      if (result.error === "VALIDATION_ERROR") {
        set.status = 400;
        return {
          success: false,
          error: result.message ?? "Invalid service or address. Add a saved address and try again.",
          code: result.code ?? "VALIDATION_ERROR",
          ...(result.reason ? { reason: result.reason } : {}),
        };
      }
      /**
       * Closes the "route falls through to success" class: any refusal code the service returns that
       * no branch above maps is still a refusal. Before this, a new error code became
       * `201 success: true` with the error object as the "booking".
       */
      if (result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error) {
        set.status = 400;
        return { success: false, error: "This booking could not be created", code: String((result as { error: unknown }).error) };
      }
      set.status = 201;
      return { success: true, message: "Booking created successfully", data: result };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        providerId: t.Optional(t.String()),
        scheduledDate: t.String(),
        addressId: t.String(),
        description: t.Optional(t.String()),
        paymentMethod: t.Optional(t.String()),
        couponCode: t.Optional(t.String()),
        // Package tier + add-ons — validated against the server catalog in
        // bookingPricingService (Elysia strips fields missing from this schema,
        // which used to silently drop the client's selection).
        packagePrice: t.Optional(t.Number()),
        // Selection ids + quantity only — never a price. Priced in bookingPricingService.
        variantId: t.Optional(t.String()),
        quantity: t.Optional(t.Number()),
        audience: t.Optional(t.String()),
        professionalPreference: t.Optional(t.String()),
        addonIds: t.Optional(t.Array(t.String())),
        addonQuantities: t.Optional(t.Record(t.String(), t.Number())),
        serviceVersion: t.Optional(t.Number()),
        quoteToken: t.Optional(t.String({ maxLength: 2048 })),
        requirementAttestations: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 60 })),
        guardianAttested: t.Optional(t.Boolean()),
      }),
    },
  )
  /**
   * CUSTOMER-only view of the service-start PIN. Owner-scoped inside the
   * service (`booking.userId` must match) — a partner token gets 404 here,
   * which is the point: the code must travel person-to-person at the door.
   */
  .get("/:id/start-pin", async ({ requireAuth, params: rawParams, set }) => {
    const { userId } = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const result = await bookingStartOtpService.customerView(userId, params.id);
    if (!result.ok) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return {
      success: true,
      data: {
        state: result.state,
        pin: result.pin,
        expiresAt: result.expiresAt,
        verifiedAt: result.verifiedAt,
      },
    };
  })
  .get("/:id", async ({ requireAuth, params, set }) => {
    const { userId, providerId } = requireAuth();
    const booking = await bookingService.getById(
      params.id,
      providerId ? undefined : userId,
      providerId ?? undefined,
    );
    if (!booking) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { booking } };
  })
  .put(
    "/:id",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const { userId } = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(updateBookingCustomerSchema, raw, { description: { maxLen: 1000 } });
      const result = await bookingService.update(userId, params.id, {
        scheduledDate: body.scheduledDate?.toISOString(),
        description: body.description,
      });
      if (result.error === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Cannot reschedule a booking in progress", code: "INVALID_STATUS" };
      }
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      if (result.error === "PROVIDER_UNAVAILABLE" || result.error === "SCHEDULE_NOT_ALLOWED") {
        set.status = 400;
        return {
          success: false,
          error: result.message ?? "Provider is not available",
          code: result.error,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      }
      if (result.error === "OVERLAPPING_BOOKING") {
        set.status = 409;
        return { success: false, error: "You have an overlapping booking", code: "OVERLAPPING_BOOKING" };
      }
      if (result.error === "POOL_BUSY") {
        const retryAfter = 3;
        set.status = 429;
        set.headers["Retry-After"] = String(retryAfter);
        return {
          success: false,
          error: "System busy. Please retry in a few seconds.",
          code: "POOL_BUSY",
          retryAfter,
        };
      }
      /**
       * §45 / O6: the move happened and nothing was charged, but the customer is TOLD when they
       * moved inside the two-hour window. `feeAmount: null` is the honest answer — the policy says
       * a fee applies and the amount has never been configured. A client must not read null as 0.
       */
      return {
        success: true,
        message: "Booking updated successfully",
        data: "reschedulePolicy" in result ? { reschedulePolicy: result.reschedulePolicy } : undefined,
      };
    },
    {
      body: t.Object({
        scheduledDate: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/:id/accept",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingAcceptSchema, raw ?? {});
      const result = await bookingService.accept(providerId!, params.id, body.eta ?? undefined);
      if (!result.ok) {
        set.status = result.error === "NOT_FOUND" ? 404 : 400;
        const error =
          result.error === "PROVIDER_UNAVAILABLE"
            ? "Provider is not available"
            : result.error === "NOT_FOUND"
              ? "This request is not assigned to you or has expired"
              : result.error === "ALREADY_CLAIMED"
                ? "Another professional already accepted this job"
                : result.error === "INVALID_STATUS"
                  ? "This booking can no longer be accepted"
                  : result.error === "PAYMENT_NOT_SETTLED"
                    ? "This booking has not been paid for yet"
                    : result.error === "CAPACITY_LIMIT"
                      ? "You already have the maximum number of active jobs."
                      : result.error === "ACCOUNT_RESTRICTED"
                        ? "Your account is currently unavailable for job assignments."
                      : result.error === "STALE_LOCATION"
                        ? "Your GPS is outdated. Enable location and try Accept again."
                        : result.error === "STALE_PRESENCE"
                          ? "Go online, wait a few seconds, then try Accept again."
                    : "Cannot accept booking";
        return {
          success: false,
          error,
          code: result.error,
        };
      }
      return {
        success: true,
        message: result.newlyAccepted ? "Booking accepted" : "Booking already accepted",
        data: {
          newlyAccepted: result.newlyAccepted,
          booking: {
            id: result.booking.id,
            status: "accepted",
            provider: { name: result.booking.provider?.user.firstName },
          },
        },
      };
    },
    { body: t.Object({ eta: tNullableNumber }) },
  )
  .post(
    "/:id/reject",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingRejectSchema, raw, { reason: { maxLen: 500 } });
      const result = await bookingService.reject(providerId!, params.id, body.reason);
      if (result && "error" in result) {
        set.status = 404;
        return { success: false, error: "Request not found or expired", code: "NOT_FOUND" };
      }
      return { success: true, message: "Declined — we're finding another professional" };
    },
    { body: t.Object({ reason: t.String() }) },
  )
  .post(
    "/:id/en-route",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(optionalGeoPingSchema, raw ?? {});
      const result = await bookingService.markEnRoute(
        providerId!,
        params.id,
        body.latitude ?? null,
        body.longitude ?? null,
      );
      if (!result.ok) {
        set.status = result.error === "NOT_FOUND" ? 404 : 400;
        return {
          success: false,
          error:
            result.error === "NOT_FOUND"
              ? "This booking is not assigned to you"
              : "This booking can no longer be marked en route",
          code: result.error,
        };
      }
      return {
        success: true,
        message: result.newlyTransitioned ? "On your way" : "Already marked en route",
        data: {
          newlyTransitioned: result.newlyTransitioned,
          booking: { status: "en_route", enRouteAt: result.enRouteAt },
        },
      };
    },
    { body: t.Object({ latitude: tNullableNumber, longitude: tNullableNumber }) },
  )
  .post(
    "/:id/arrived",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(geoPingSchema, raw);
      const result = await bookingService.markArrived(
        providerId!,
        params.id,
        body.latitude,
        body.longitude,
      );
      if (!result.ok) {
        set.status =
          result.error === "NOT_FOUND"
            ? 404
            : result.error === "LOCATION_UNCONFIRMED" || result.error === "LOCATION_MISMATCH"
              ? 409
            : result.error === "OUTSIDE_SERVICE_AREA" ||
                result.error === "LOCATION_INVALID" ||
                result.error === "LOCATION_REQUIRED"
              ? 400
              : 400;
        const messages: Record<string, string> = {
          NOT_FOUND: "This booking is not assigned to you",
          INVALID_STATUS: "This booking can no longer be marked as arrived",
          OUTSIDE_SERVICE_AREA: "Move closer to the service location and try again",
          LOCATION_INVALID: "Valid GPS coordinates are required to mark arrival",
          LOCATION_REQUIRED: "Location is required to mark arrival",
          LOCATION_UNCONFIRMED: POSITION_MESSAGES.LOCATION_UNCONFIRMED,
          LOCATION_MISMATCH: POSITION_MESSAGES.LOCATION_MISMATCH,
        };
        return {
          success: false,
          error: messages[result.error] ?? "Unable to record arrival",
          code: result.error,
        };
      }
      return {
        success: true,
        message: result.newlyTransitioned ? "Arrival recorded" : "Arrival already recorded",
        data: {
          newlyTransitioned: result.newlyTransitioned,
          booking: { arrivedAt: result.arrivedAt },
          // §6: what the partner must resolve before START, evaluated at arrival (null = gate not deployed).
          requirementGate: result.requirementGate,
        },
      };
    },
    { body: t.Object({ latitude: t.Number(), longitude: t.Number() }) },
  )
  /**
   * §52 — the partner waited at the door and nobody answered.
   *
   * Only the assigned partner may say it, and only when the row already carries the arrival that
   * `/:id/arrived` wrote. The service refuses on the evidence, not on the clock, so a partner who
   * never travelled there cannot produce a customer no-show however late the booking gets.
   */
  .post("/:id/no-show", async ({ requireProvider, params: rawParams, set }) => {
    const { userId, providerId } = requireProvider();
    const params = validate(idParamSchema, rawParams);
    const result = await bookingNoShowService.reportCustomerNoShow(params.id, { userId, providerId });
    if ("error" in result) {
      set.status = result.error === "NOT_FOUND" ? 404 : result.error === "FORBIDDEN" ? 403 : 400;
      const messages: Record<string, string> = {
        NOT_FOUND: "This booking is not assigned to you",
        FORBIDDEN: "This booking is not assigned to you",
        INVALID_STATUS: "This booking is past the point where a no-show can be recorded",
        NO_ARRIVAL_EVIDENCE: "Mark your arrival first — a no-show can only be reported from the door",
        GRACE_NOT_ELAPSED: `Wait ${NO_SHOW_POLICY.graceMinutes} minutes from arrival before reporting a no-show`,
        ARRIVAL_IN_FUTURE: "The recorded arrival time is in the future — contact support",
      };
      return {
        success: false,
        error: messages[result.reason ?? result.error] ?? "Unable to record a no-show",
        code: result.reason ?? result.error,
        data: { waitedMinutes: result.waitedMinutes ?? null, graceMinutes: NO_SHOW_POLICY.graceMinutes },
      };
    }
    return {
      success: true,
      message: "No-show recorded",
      // The partner reports this: it hears the fee recorded, not the customer's refund (X-29).
      data: {
        status: "customer_no_show",
        feeAmount: result.feeAmount,
      },
    };
  })
  /**
   * §53 — the professional never arrived.
   *
   * The customer reports it, never the partner: a partner cannot absolve themselves, and the
   * absence of somebody is not a thing the customer can be asked to prove. No fee is charged on
   * this path, whatever was captured.
   */
  .post("/:id/provider-no-show", async ({ requireAuth, params: rawParams, set }) => {
    const { userId } = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const result = await bookingNoShowService.reportProviderNoShow(params.id, { userId });
    if ("error" in result) {
      set.status = result.error === "NOT_FOUND" ? 404 : result.error === "FORBIDDEN" ? 403 : 400;
      const messages: Record<string, string> = {
        NOT_FOUND: "Booking not found",
        FORBIDDEN: "This is not your booking",
        INVALID_STATUS: "This booking is past the point where a no-show can be reported",
      };
      return { success: false, error: messages[result.error] ?? "Unable to report a no-show", code: result.error };
    }
    return {
      success: true,
      message: "Reported — you have not been charged",
      data: {
        status: "provider_no_show",
        feeAmount: result.feeAmount,
        refundAmount: result.refundAmount,
        refundStatus: result.refundStatus,
      },
    };
  })
  .post(
    "/:id/start-otp",
    async ({ requireProvider, params: rawParams, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const result = await bookingStartOtpService.issue(providerId!, params.id);
      if (!result.ok) {
        if (result.error === "NOT_FOUND") {
          set.status = 404;
          return { success: false, error: "This booking is not assigned to you", code: "NOT_FOUND" };
        }
        if (result.error === "INVALID_STATUS") {
          set.status = 400;
          return {
            success: false,
            error: "A start PIN cannot be issued for this booking anymore",
            code: "INVALID_STATUS",
          };
        }
        set.status = 429;
        return {
          success: false,
          error:
            result.error === "RESEND_COOLDOWN"
              ? `Please wait ${result.retryAfterSec ?? 30}s before resending`
              : "Too many PIN requests for this booking — try again later",
          code: result.error,
          data: { retryAfterSec: result.retryAfterSec ?? null },
        };
      }
      return {
        success: true,
        message: result.alreadyVerified
          ? "Customer already verified — you can start the job"
          : "Start PIN sent to the customer",
        data: {
          alreadyVerified: result.alreadyVerified,
          channels: result.channels,
          sentTo: result.sentTo,
          expiresInSec: result.expiresInSec,
          resendInSec: result.resendInSec,
        },
      };
    },
  )
  .post(
    "/:id/start",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(geoPingSchema, raw);
      const otp = typeof (raw as { otp?: unknown })?.otp === "string"
        ? (raw as { otp: string }).otp
        : undefined;

      // §9: a standing safety hold refuses the start before the PIN is checked — otherwise the refused
      // start still recorded the customer's PIN as verified (durable, below) while no work could begin.
      // Read-only here; `assertSafe` inside the start transaction remains the authority. Ownership first:
      // a partner must not learn another booking's safety state from this answer.
      const owned = await prisma.booking.findFirst({ where: { id: params.id, providerId: providerId! }, select: { id: true } });
      if (!owned) {
        set.status = 404;
        return { success: false, error: "This booking is not assigned to you", code: "NOT_FOUND" };
      }
      const safety = await bookingSafetyService.currentGate(params.id);
      if (!safety.ok) {
        set.status = 409;
        return { success: false, error: safetyGateMessage(safety), code: SAFETY_HOLD_ACTIVE, data: { blocking: safety.blocking } };
      }

      // Proof-of-presence gate: the customer's start PIN must be verified
      // before any work can begin. Durable via booking.startOtpVerifiedAt,
      // so a retry after a network error never re-prompts the partner.
      const gate = await bookingStartOtpService.ensureCanStart(providerId!, params.id, otp);
      if (!gate.ok) {
        if (gate.error === "NOT_FOUND") {
          set.status = 404;
          return { success: false, error: "This booking is not assigned to you", code: "NOT_FOUND" };
        }
        set.status = 400;
        const messages: Record<string, string> = {
          OTP_REQUIRED: "Ask the customer for their start PIN to begin this job",
          OTP_NOT_REQUESTED: "No active PIN for this job — send a new one to the customer",
          OTP_EXPIRED: "The PIN has expired — send a new one to the customer",
          OTP_LOCKED: "Too many incorrect attempts — send a new PIN to the customer",
          OTP_INVALID: "Incorrect PIN — please check with the customer",
        };
        return {
          success: false,
          error: messages[gate.error] ?? "Customer verification failed",
          code: gate.error,
          data: { attemptsLeft: gate.attemptsLeft ?? null },
        };
      }

      try {
        const booking = await bookingService.start(
          providerId!,
          params.id,
          body.latitude,
          body.longitude,
        );
        return {
          success: true,
          message: "Job started",
          data: { booking: { status: "in_progress", startedAt: booking.startedAt } },
        };
      } catch (err) {
        const code = err instanceof Error ? err.message : "FORBIDDEN";
        if (
          code === "OUTSIDE_SERVICE_AREA" ||
          code === "LOCATION_INVALID" ||
          code === "LOCATION_REQUIRED"
        ) {
          set.status = 400;
          const messages: Record<string, string> = {
            OUTSIDE_SERVICE_AREA: "Move closer to the service location and try again",
            LOCATION_INVALID: "Valid GPS coordinates are required to start this job",
            LOCATION_REQUIRED: "Location is required to start this job",
          };
          return { success: false, error: messages[code] ?? code, code };
        }
        if (code === "LOCATION_UNCONFIRMED" || code === "LOCATION_MISMATCH") {
          set.status = 409;
          return { success: false, error: POSITION_MESSAGES[code], code };
        }
        if (code === "PAYMENT_NOT_SETTLED") {
          set.status = 403;
          return {
            success: false,
            error: "Payment confirmation is still pending",
            code: "PAYMENT_NOT_SETTLED",
          };
        }
        /**
         * §6.13 — a blocked requirement gate is its own outcome with a structured body: the stable
         * code, a human-safe sentence, and every blocking requirement with its enforcement point,
         * reason and remediation. Never folded into FORBIDDEN.
         */
        if (err instanceof SafetyGateError) {
          set.status = 409;
          return { success: false, error: safetyGateMessage(err.gate), code: SAFETY_HOLD_ACTIVE, data: { blocking: err.gate.blocking } };
        }
        if (err instanceof RequirementGateError) {
          set.status = 409;
          return {
            success: false,
            error: gateMessage(err.gate),
            code: REQUIREMENT_GATE_BLOCKED,
            data: { enforcementPoint: "AT_START", target: err.gate.target, blocking: err.gate.blocking },
          };
        }
        set.status = 403;
        return { success: false, error: "Forbidden", code: "FORBIDDEN" };
      }
    },
    {
      body: t.Object({
        latitude: t.Number(),
        longitude: t.Number(),
        otp: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/:id/complete",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(optionalGeoPingSchema, raw ?? {}, { notes: { maxLen: 500 } });
      const photos = Array.isArray((raw as { photos?: unknown })?.photos)
        ? ((raw as { photos: string[] }).photos).filter((p) => typeof p === "string")
        : undefined;
      const completedChecklist = Array.isArray((raw as { completedChecklist?: unknown })?.completedChecklist)
        ? ((raw as { completedChecklist: unknown[] }).completedChecklist).filter((p) => typeof p === "string")
        : undefined;
      /**
       * W2-D1: accepted for wire compatibility with deployed partner clients and then
       * DISCARDED. It used to satisfy the completion quality gate on its own. The gate now
       * matches `completedChecklist` item by item against the booking's frozen checklist, so
       * this boolean is a UI hint with no authority and is not forwarded.
       */
      void (raw as { checklistComplete?: unknown })?.checklistComplete;
      try {
        const result = await bookingService.complete(
          providerId!,
          params.id,
          body.latitude ?? null,
          body.longitude ?? null,
          body.notes,
          { photos, completedChecklist, professionalConfirmed: (raw as { professionalConfirmation?: unknown })?.professionalConfirmation === true },
        );
        return {
          success: true,
          message: "Job completed",
          data: {
            booking: {
              status: "completed",
              completedAt: result?.booking.completedAt,
              totalDuration: result?.totalDuration,
            },
          },
        };
      } catch (err) {
        const code = err instanceof Error ? err.message : "FORBIDDEN";
        if (code === "INVALID_STATUS") {
          set.status = 400;
          return { success: false, error: "Job cannot be completed in this status", code };
        }
        // §10: every refusal below also carries the id of the verdict row it left behind (null when
        // verdicts are not deployed) — the code keeps its precedence meaning, the verdict rides along.
        const refusalVerdict = (err as { verdict?: { id: number; verdict: string } })?.verdict ?? null;
        if (code === "QUALITY_PROOF_REQUIRED") {
          set.status = 409;
          return { success: false, error: "Required job proof is missing", code, data: { verdictId: refusalVerdict?.id ?? null, verdict: refusalVerdict?.verdict ?? null } };
        }
        // §8: an incomplete/failed/escalated step is its own outcome, with the blocking steps.
        if (err instanceof SafetyGateError) {
          set.status = 409;
          return { success: false, error: safetyGateMessage(err.gate), code: SAFETY_HOLD_ACTIVE, data: { blocking: err.gate.blocking, verdictId: refusalVerdict?.id ?? null, verdict: refusalVerdict?.verdict ?? null } };
        }
        if (err instanceof ExecutionGateError) {
          set.status = 409;
          return { success: false, error: "Finish the required work steps before completing this job", code: EXECUTION_GATE_BLOCKED, data: { blocking: err.gate.blocking, verdictId: refusalVerdict?.id ?? null, verdict: refusalVerdict?.verdict ?? null } };
        }
        if (code === "QUALITY_CHECKLIST_REQUIRED") {
          set.status = 409;
          return { success: false, error: "Complete the service checklist before finishing this job", code, data: { verdictId: refusalVerdict?.id ?? null, verdict: refusalVerdict?.verdict ?? null } };
        }
        if (code === "QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED") {
          set.status = 409;
          return { success: false, error: "Confirm the completion criteria were met before finishing this job", code, data: { verdictId: refusalVerdict?.id ?? null, verdict: refusalVerdict?.verdict ?? null } };
        }
        // §10: the recorded verdict refused completion (REWORK_REQUIRED / FAILED / ESCALATED).
        if (err instanceof QualityVerdictError) {
          set.status = 409;
          const verdictRow = (err as { verdict?: { id: number } }).verdict ?? null;
          return {
            success: false,
            error: err.data.verdict === "ESCALATED" ? "This job is under review and cannot be completed yet" : "This job needs more work before it can be completed",
            code: QUALITY_VERDICT_BLOCKED,
            data: { verdict: err.data.verdict, reasonCodes: err.data.reasonCodes, verdictId: verdictRow?.id ?? null, blocking: err.data.reasonCodes.map((c) => ({ code: `quality:${c}`, reason: err.data.verdict })) },
          };
        }
        if (code === "FORBIDDEN" || code === "PROVIDER_NOT_FOUND") {
          set.status = 403;
          return { success: false, error: "Forbidden", code: "FORBIDDEN" };
        }
        set.status = 500;
        return { success: false, error: "Could not complete this job", code: "COMPLETE_FAILED" };
      }
    },
    {
      body: t.Object({
        latitude: tNullableNumber,
        longitude: tNullableNumber,
        photos: t.Optional(t.Array(t.String())),
        notes: t.Optional(t.String()),
        /**
         * W2-D1. Neither of these was declared, so Elysia stripped both before the handler ran:
         * the checklist array never reached the service, and a booking with a non-empty
         * checklist could not be completed over HTTP at all. `completedChecklist` is now the
         * partner's actual submission, matched item by item server-side. `checklistComplete` is
         * accepted so deployed clients are not rejected with 422, and then ignored.
         */
        completedChecklist: t.Optional(t.Array(t.String())),
        checklistComplete: t.Optional(t.Boolean()),
        /** The professional's attestation, required only where the frozen quality policy asks for it. */
        professionalConfirmation: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/:id/actions", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const booking = await prisma.booking.findFirst({
      where: {
        id: params.id,
        OR: [
          { userId: auth.userId },
          ...(auth.providerId ? [{ providerId: auth.providerId }] : []),
        ],
      },
      select: {
        status: true,
        enRouteAt: true,
        arrivedAt: true,
        startedAt: true,
        completedAt: true,
        paymentStatus: true,
        startOtpVerifiedAt: true,
      },
    });
    if (!booking) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    // §6/§9: the START requirement gate and the safety gate are the server's to know; the client policy
    // mirror cannot compute them. The payment exemption is the same one start/accept apply.
    const [requirementGate, safetyGate, paymentExempt] = await Promise.all([
      bookingRequirementService.startGateSummary(params.id),
      bookingSafetyService.gateSummary(params.id),
      booking.paymentStatus === "SUCCESS" || isPaymentReturned(booking.paymentStatus)
        ? Promise.resolve(false)
        : Promise.all([hasAuditedPaymentGateOverride(params.id), isNoPaymentFollowUp(params.id)]).then(([o, f]) => o || f),
    ]);
    const actions = getAvailableJobActions({ ...booking, requirementGate, safetyGate, paymentExempt });
    return { success: true, data: { axis: "JOB" as const, jobState: actions.stage, ...actions, requirementGate, safetyGate, paymentExempt } };
  })
  /* ------------------------------------------------------------------ */
  /* Phase 10 §10 — quality verdict + customer confirmation             */
  /* ------------------------------------------------------------------ */
  /** The latest quality verdict — plain words for the customer; codes and missing items for the partner. */
  .get("/:id/quality", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const view = auth.providerId
      ? await bookingQualityService.viewFor(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingQualityService.viewFor(params.id, { role: "CUSTOMER", userId: auth.userId });
    if ("error" in view) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: view };
  })
  /** The confirmation axis: state, confirm-by, verdict summary and warranty window — customer or partner. */
  .get("/:id/completion", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const view = auth.providerId
      ? await bookingCompletionService.viewFor(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingCompletionService.viewFor(params.id, { role: "CUSTOMER", userId: auth.userId });
    if ("error" in view) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: view };
  })
  /**
   * The customer confirms the completed job. Owner only. Replay by the same customer is 200 with the
   * same state; a completion resolved any other way (auto-confirmed, issue reported) is 409 with it.
   */
  .post("/:id/confirm-completion", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const r = await bookingCompletionService.confirm(params.id, auth.userId);
    if (!r.ok) {
      const table: Record<string, [number, string]> = {
        [COMPLETION_ERRORS.NOT_FOUND]: [404, "Booking not found"],
        [COMPLETION_ERRORS.COMPLETION_NOT_FOUND]: [409, "This booking is not awaiting your confirmation"],
        [COMPLETION_ERRORS.COMPLETION_ALREADY_RESOLVED]: [409, "This completion has already been resolved"],
        [COMPLETION_ERRORS.COMPLETION_UNAVAILABLE]: [503, "Completion confirmation is not available right now"],
      };
      const [status, message] = table[r.error] ?? [400, "Unable to confirm this completion"];
      set.status = status;
      return { success: false, error: message, code: r.error, ...("completion" in r && r.completion ? { data: { state: r.completion.state } } : {}) };
    }
    return { success: true, message: r.changed ? "Thank you — your service is confirmed" : "Already confirmed", data: { changed: r.changed, completion: r.completion } };
  })
  /* ------------------------------------------------------------------ */
  /* Phase 10 §9 — safety                                                */
  /* ------------------------------------------------------------------ */
  /** The booking's safety information and whether work is on safety hold — for its customer or partner. */
  .get("/:id/safety", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const view = auth.providerId
      ? await bookingSafetyService.viewFor(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingSafetyService.viewFor(params.id, { role: "CUSTOMER", userId: auth.userId });
    if ("error" in view) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: view };
  })
  /**
   * The assigned partner reports a prohibited condition from the booking's own safety list. Work stops
   * (hold) and the safety team is alerted (incident). Only an administrator can clear the hold.
   */
  .post(
    "/:id/safety/prohibited-condition",
    async ({ requireProvider, params: rawParams, body, set }) => {
      const { providerId, userId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const r = await bookingSafetyService.raiseProhibitedCondition({ bookingId: params.id, providerId: providerId!, userId, condition: body.condition, note: body.note ?? null });
      if (!r.ok) {
        const table: Record<string, [number, string]> = {
          NOT_FOUND: [404, "Booking not found"],
          CONDITION_NOT_CONFIGURED: [400, "That is not one of this service's prohibited conditions — report it as a safety incident instead"],
          INVALID_STATUS: [409, "This booking is no longer being worked on"],
          SAFETY_UNAVAILABLE: [503, "Safety holds are not available right now — report a safety incident"],
        };
        const [status, message] = table[r.error] ?? [400, "Unable to record this"];
        set.status = status;
        return { success: false, error: message, code: r.error };
      }
      return { success: true, message: "Work is on hold — our safety team has been alerted", data: r };
    },
    { body: t.Object({ condition: t.String({ minLength: 1, maxLength: 300 }), note: t.Optional(t.String({ maxLength: 500 })) }) },
  )
  /* ------------------------------------------------------------------ */
  /* Phase 10 §7/§8 — execution steps                                    */
  /* ------------------------------------------------------------------ */
  /** The booking's work plan and step state — for its customer (titles + states) or its partner. */
  .get("/:id/execution", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const view = auth.providerId
      ? await bookingExecutionService.viewFor(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingExecutionService.viewFor(params.id, { role: "CUSTOMER", userId: auth.userId });
    if ("error" in view) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: view };
  })
  /**
   * The assigned partner acts on a step. The server validates everything (booking in progress,
   * dependencies, linked safety requirement, evidence in job_evidence, reason for exceptions).
   */
  .post(
    "/:id/execution/:code/:action",
    async ({ requireProvider, params: rawParams, body, set, request }) => {
      const { providerId, userId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const raw = rawParams as { code?: string; action?: string };
      const action = String(raw.action ?? "").toUpperCase();
      if (!["START", "COMPLETE", "SKIP", "FAIL", "ESCALATE"].includes(action)) {
        set.status = 404;
        return { success: false, error: "Unknown step action", code: "NOT_FOUND" };
      }
      let r: Awaited<ReturnType<typeof bookingExecutionService.transition>>;
      try {
        r = await bookingExecutionService.transition({
        bookingId: params.id,
        code: String(raw.code ?? ""),
        action: action as "START" | "COMPLETE" | "SKIP" | "FAIL" | "ESCALATE",
        actor: { role: "PARTNER", providerId: providerId!, userId },
        evidenceId: body?.evidenceId ?? null,
        note: body?.note ?? null,
        reason: body?.reason ?? null,
        idempotencyKey: request.headers.get("idempotency-key"),
        });
      } catch (err) {
        if (err instanceof SafetyGateError) {
          set.status = 409;
          return { success: false, error: safetyGateMessage(err.gate), code: SAFETY_HOLD_ACTIVE, data: { blocking: err.gate.blocking } };
        }
        throw err;
      }
      if (!r.ok) return executionError(set, r.error, r.detail);
      return { success: true, data: { code: String(raw.code), state: r.state, changed: r.changed, gate: r.gate } };
    },
    {
      body: t.Optional(
        t.Object({
          evidenceId: t.Optional(t.String({ maxLength: 64 })),
          note: t.Optional(t.String({ maxLength: 1000 })),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
      ),
    },
  )
  /* ------------------------------------------------------------------ */
  /* Phase 10 §6 — booking requirement state                             */
  /* ------------------------------------------------------------------ */
  /** The booking's gated requirements, their state and the START gate — for its customer or its partner. */
  .get("/:id/requirements", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const view = auth.providerId
      ? await bookingRequirementService.viewFor(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingRequirementService.viewFor(params.id, { role: "CUSTOMER", userId: auth.userId });
    if ("error" in view) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: view };
  })
  /**
   * The assigned partner records the outcome of an on-site check (verification PARTNER_CHECK).
   * GPS proximity is enforced like arrival. `outcome` is what the partner FOUND, not whether the
   * gate passes — the server decides that and returns it.
   */
  .post(
    "/:id/requirements/:code/check",
    async ({ requireProvider, params: rawParams, body, set, request }) => {
      const { providerId, userId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const code = String((rawParams as { code?: string }).code ?? "");
      const r = await bookingRequirementService.partnerCheck({
        bookingId: params.id,
        providerId: providerId!,
        userId,
        code,
        outcome: body.outcome,
        note: body.note ?? null,
        latitude: body.latitude,
        longitude: body.longitude,
        idempotencyKey: request.headers.get("idempotency-key"),
      });
      if (!r.ok) return requirementError(set, r.error);
      return {
        success: true,
        message: r.row.state === "SATISFIED" ? "Check recorded" : "Recorded as missing — the customer has been told",
        data: { code: r.row.code, state: r.row.state, changed: r.changed, gate: r.gate },
      };
    },
    {
      body: t.Object({
        outcome: t.Union([t.Literal("SATISFIED"), t.Literal("FAILED")]),
        note: t.Optional(t.String({ maxLength: 500 })),
        latitude: t.Number(),
        longitude: t.Number(),
      }),
    },
  )
  /**
   * The customer: attest an attestation item (ATTEST), or tell us a failed check is ready to be
   * checked again (READY → back to UNRESOLVED). A customer can never mark a partner check satisfied.
   */
  .post(
    "/:id/requirements/:code/customer",
    async ({ requireAuth, params: rawParams, body, set, request }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const code = String((rawParams as { code?: string }).code ?? "");
      const r = await bookingRequirementService.customerAction({
        bookingId: params.id,
        userId: auth.userId,
        code,
        action: body.action,
        note: body.note ?? null,
        idempotencyKey: request.headers.get("idempotency-key"),
      });
      if (!r.ok) return requirementError(set, r.error);
      return {
        success: true,
        message: body.action === "ATTEST" ? "Confirmed" : "Thanks — your professional will check again",
        data: { code: r.row.code, state: r.row.state, changed: r.changed, gate: r.gate },
      };
    },
    {
      body: t.Object({
        action: t.Union([t.Literal("READY"), t.Literal("ATTEST")]),
        note: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  .get("/:id/evidence", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    try {
      const evidence = await jobEvidenceService.listForBooking(params.id, {
        userId: auth.userId,
        providerId: auth.providerId,
        isAdmin: auth.role === "ADMIN",
      });
      return { success: true, data: { evidence } };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
    }
  })
  .post(
    "/:id/evidence",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = raw as {
        stage?: string;
        latitude?: number;
        longitude?: number;
        clientUploadId?: string;
        mediaUrl?: string;
        photos?: string[];
        mediaStorageKey?: string;
        mediaMimeType?: string;
        replace?: boolean;
      };
      const stage = body.stage?.toUpperCase();
      if (stage !== "ARRIVAL" && stage !== "START" && stage !== "COMPLETION") {
        set.status = 400;
        return { success: false, error: "Invalid stage", code: "VALIDATION_ERROR" };
      }
      const mediaUrls = [
        ...(typeof body.mediaUrl === "string" ? [body.mediaUrl] : []),
        ...(Array.isArray(body.photos) ? body.photos.filter((p) => typeof p === "string") : []),
      ];
      // A storage key supplied by the client is signed back to it when the evidence is listed, so it
      // must be a key of THIS booking — never a path into another booking's evidence.
      if (typeof body.mediaStorageKey === "string" && body.mediaStorageKey.length > 0) {
        const segments = body.mediaStorageKey.split("/");
        if (!segments.includes(params.id) || segments.includes("..")) {
          set.status = 400;
          return { success: false, error: "The storage key does not belong to this booking", code: "VALIDATION_ERROR" };
        }
      }
      try {
        const row = await jobEvidenceService.recordStage({
          bookingId: params.id,
          providerId: providerId!,
          stage,
          latitude: typeof body.latitude === "number" ? body.latitude : undefined,
          longitude: typeof body.longitude === "number" ? body.longitude : undefined,
          clientUploadId: body.clientUploadId,
          mediaUrls: mediaUrls.length ? mediaUrls : undefined,
          mediaStorageKey: body.mediaStorageKey,
          mediaMimeType: body.mediaMimeType,
          replace: Boolean(body.replace),
          requireActiveJob: true,
        });
        return { success: true, data: { evidence: jobEvidenceService.uploadReceipt(row) } };
      } catch (err) {
        const code = err instanceof Error ? err.message : "FORBIDDEN";
        if (code === "BOOKING_NOT_ACTIVE") {
          set.status = 409;
          return { success: false, error: "Evidence can be added only while the job is in hand", code };
        }
        set.status = code === "NOT_FOUND" ? 404 : 403;
        return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
      }
    },
    {
      body: t.Object({
        stage: t.String(),
        latitude: tNullableNumber,
        longitude: tNullableNumber,
        clientUploadId: t.Optional(t.String()),
        mediaUrl: t.Optional(t.String()),
        photos: t.Optional(t.Array(t.String())),
        mediaStorageKey: t.Optional(t.String()),
        mediaMimeType: t.Optional(t.String()),
        replace: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/:id/chat", async ({ requireAuth, params: rawParams, query, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingChatService.listMessages(
        params.id,
        { userId: auth.userId, providerId: auth.providerId },
        {
          cursor: typeof query.cursor === "string" ? query.cursor : undefined,
          limit: query.limit ? Number(query.limit) : undefined,
        },
      );
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : code === "CHAT_CLOSED" ? "Chat is closed for this job" : "Forbidden", code };
    }
  })
  .post(
    "/:id/chat",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = raw as { body?: string; clientMessageId?: string };
      if (typeof body.body !== "string") {
        set.status = 400;
        return { success: false, error: "Message body required", code: "VALIDATION_ERROR" };
      }
      try {
        const result = await bookingChatService.sendMessage(
          params.id,
          auth.userId,
          body.body,
          body.clientMessageId,
        );
        return { success: true, data: result };
      } catch (err) {
        const code = err instanceof Error ? err.message : "FORBIDDEN";
        if (code === "RATE_LIMITED") {
          set.status = 429;
          return { success: false, error: "Too many messages", code };
        }
        if (code === "VALIDATION_ERROR") {
          set.status = 400;
          return { success: false, error: "Invalid message", code };
        }
        set.status = code === "NOT_FOUND" ? 404 : 403;
        return { success: false, error: code === "NOT_FOUND" ? "Not found" : code === "CHAT_CLOSED" ? "Chat is closed for this job" : "Forbidden", code };
      }
    },
    {
      body: t.Object({
        body: t.String(),
        clientMessageId: t.Optional(t.String()),
      }),
    },
  )
  .post("/:id/chat/read", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingChatService.markRead(params.id, auth.userId);
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : code === "CHAT_CLOSED" ? "Chat is closed for this job" : "Forbidden", code };
    }
  })
  .get("/:id/contact", async ({ requireProvider, params: rawParams, set }) => {
    const { providerId } = requireProvider();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingContactService.getMaskedContact(params.id, providerId!);
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
    }
  })
  .post("/:id/call", async ({ requireProvider, params: rawParams, set }) => {
    const auth = requireProvider();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingContactService.initiateCall(
        params.id,
        auth.providerId,
        auth.userId,
      );
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      if (code === "CALL_RELAY_UNAVAILABLE") {
        // X-28: no masked-call relay exists, and the customer's number is never given to a partner.
        set.status = 409;
        return { success: false, error: "Calling the customer isn't available yet — message them in the job chat.", code, data: { alternative: "CHAT" } };
      }
      if (code === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Call not available in this status", code };
      }
      if (code === "NO_PHONE") {
        set.status = 400;
        return { success: false, error: "Customer phone unavailable", code };
      }
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
    }
  })
  .get("/:id/partner-contact", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingContactService.getPartnerMaskedContact(params.id, auth.userId);
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
    }
  })
  .post("/:id/partner-call", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    try {
      const data = await bookingContactService.initiatePartnerCall(params.id, auth.userId);
      return { success: true, data };
    } catch (err) {
      const code = err instanceof Error ? err.message : "FORBIDDEN";
      if (code === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Call not available in this status", code };
      }
      if (code === "NO_PHONE") {
        set.status = 400;
        return { success: false, error: "Partner phone unavailable", code };
      }
      set.status = code === "NOT_FOUND" ? 404 : 403;
      return { success: false, error: code === "NOT_FOUND" ? "Not found" : "Forbidden", code };
    }
  })
  .post(
    "/:id/cancel",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingCancelRouteSchema, raw, { reason: { maxLen: 500 } });
      const result = await bookingService.cancel(
        { userId: auth.userId, providerId: auth.providerId },
        params.id,
        body.reason,
      );
      if ("error" in result && result.error === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Cannot cancel a completed booking", code: "INVALID_STATUS" };
      }
      if ("error" in result && result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      /**
       * O3b: the service has started, so this is a controlled stop and not a self-serve cancel.
       * 409 rather than 400 — the request is well formed, the booking is simply past the point
       * where the customer decides alone.
       */
      if ("error" in result && result.error === "SERVICE_IN_PROGRESS") {
        set.status = 409;
        return {
          success: false,
          error:
            "Your professional has already started work, so this cannot be cancelled here. Contact support to stop the service and settle what was done.",
          code: "SERVICE_IN_PROGRESS",
        };
      }
      /**
       * Fail closed on anything else.
       *
       * Without this the handler fell through to `success: true` for every error it did not name,
       * so the NEXT error code added to `cancel()` would have told a customer "Booking cancelled
       * successfully" while the booking was untouched. An unrecognised refusal is a refusal.
       */
      if ("error" in result) {
        set.status = 400;
        return { success: false, error: "This booking cannot be cancelled", code: String(result.error) };
      }
      return {
        success: true,
        message: "Booking cancelled successfully",
        data: {
          booking: {
            id: params.id,
            status: "status" in result ? result.status : undefined,
            refundAmount: "refundAmount" in result ? result.refundAmount : 0,
            refundStatus: "refundStatus" in result ? result.refundStatus : "none",
            cancellationFee: "cancellationFee" in result ? result.cancellationFee : 0,
            refundMessage: "refundMessage" in result ? result.refundMessage : undefined,
          },
        },
      };
    },
    {
      body: t.Object({
        reason: t.String(),
      }),
    },
  );
