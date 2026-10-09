/**
 * Phase 15.2 — backend-authoritative funnel projection.
 *
 * The six names a client may never mint (quote, checkout, booking created / completed /
 * cancelled, repeat) are written from here and nowhere else. Each one observes a fact that has
 * already been committed by the service that owns it:
 *
 *   quote_generated    POST /api/bookings/price-quote, after `bookingPricingService.quote` returned ok
 *   checkout_started   the CHECKOUT_STARTED outbox event (Razorpay order / split initiation), or the
 *                      wallet-only checkout after its transaction committed
 *   booking_created    the BOOKING_CREATED outbox event
 *   booking_completed  the BOOKING_COMPLETED outbox event
 *   cancelled          the BOOKING_CANCELLED outbox event
 *   repeat_booking     derived at BOOKING_COMPLETED from the existing business definition
 *
 * Event identity is deterministic — the outbox event id, the quote token's digest, or the wallet
 * transaction id — so a redelivered outbox row, a retried consumer or a replayed request reaches the
 * same `analytics_events.event_id` and collapses onto one row. Nothing here is awaited by the
 * business transaction; a failure to project is logged and never surfaces to the customer.
 *
 * Repeat-booking definition (NOT invented here): `customer-intelligence.service.ts`
 * (`repeatCustomerRatePct`) counts a customer as a repeater once they have MORE THAN ONE booking in
 * status COMPLETED, over any service and any provider, with no time window. The per-booking
 * projection of that definition is: a booking is a repeat booking when it reaches COMPLETED and the
 * same customer already has at least one other COMPLETED booking that completed earlier. The
 * narrower service-level (`satisfaction-intelligence.service.ts`) and provider-level
 * (`partner-os.service.ts`) variants are carried as metadata (`sameService`, `sameProvider`) so a
 * reader can apply either without a second event.
 */
import { createHash } from "node:crypto";
import type { DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import type { HomigoEvent } from "../events/core/homigo-event";
import { EVENT_TYPES } from "../events/catalog/event-types";
import type {
  BookingCancelledPayload,
  BookingCompletedPayload,
  BookingCreatedPayload,
} from "../events/catalog/booking.events";
import type { CheckoutStartedPayload } from "../events/catalog/payment.events";
import { recordAuthoritativeEvent, type AnalyticsEventInput, type IngestResult } from "./analytics-events.service";
import type { BookingPriceBreakdown } from "./booking-pricing.service";

type Meta = Record<string, string | number | boolean | null>;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Write one authoritative row. Returns the ingest result for callers that want to assert it, but
 * never throws for a refused event: a refusal (booking gone, service gone) is a logged measurement
 * gap, not a failure of the business operation that produced the fact. Infrastructure errors
 * (database down) DO propagate, so the outbox consumer retries them.
 */
async function record(input: AnalyticsEventInput, actor: { userId: string; dataOrigin: DataOrigin | null } | null): Promise<IngestResult> {
  const result = await recordAuthoritativeEvent(input, actor);
  if (!result.ok) {
    logger.warn("analytics_funnel_event_refused", {
      eventName: input.eventName,
      eventId: input.eventId,
      error: result.error,
      detail: result.detail ?? null,
      bookingId: input.bookingId ?? null,
      serviceId: input.serviceId ?? null,
    });
  }
  return result;
}

/**
 * The booking's own attribution: the catalogue version it was sold under and the customer it
 * belongs to. `serviceConfigVersion` is what the create transaction froze; it is the version the
 * analytics row must carry, not whatever the service is at now.
 */
async function bookingAttribution(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      serviceId: true,
      providerId: true,
      serviceConfigVersion: true,
      completedAt: true,
      createdAt: true,
      dataOrigin: true,
    },
  });
}

async function recordForBooking(args: {
  eventName: "CHECKOUT_STARTED" | "BOOKING_CREATED" | "BOOKING_COMPLETED" | "CANCELLED" | "REPEAT_BOOKING";
  eventId: string;
  occurredAt: Date | string;
  booking: NonNullable<Awaited<ReturnType<typeof bookingAttribution>>>;
  metadata: Meta;
}): Promise<IngestResult> {
  const base: AnalyticsEventInput = {
    eventId: args.eventId,
    eventName: args.eventName,
    occurredAt: args.occurredAt,
    bookingId: args.booking.id,
    serviceId: args.booking.serviceId,
    source: "BACKEND",
    platform: "SERVER",
    metadata: args.metadata,
  };
  const actor = { userId: args.booking.userId, dataOrigin: null };
  const version = args.booking.serviceConfigVersion ?? undefined;
  const first = await recordAuthoritativeEvent(version ? { ...base, serviceVersionId: version } : base, actor);
  // A booking frozen on a version the catalogue no longer lists: keep the fact, drop the version,
  // and say so — losing the whole row to a missing version would under-count real bookings.
  if (!first.ok && first.error === "SERVICE_VERSION_NOT_FOUND" && version) {
    logger.warn("analytics_funnel_version_unlisted", { bookingId: args.booking.id, serviceVersion: version });
    return record(base, actor);
  }
  if (!first.ok) {
    logger.warn("analytics_funnel_event_refused", {
      eventName: args.eventName,
      eventId: args.eventId,
      error: first.error,
      detail: first.detail ?? null,
      bookingId: args.booking.id,
    });
  }
  return first;
}

/* ───────────────────────── quote_generated ───────────────────────── */

/**
 * Called by the price-quote route once — and only once — `bookingPricingService.quote` has returned
 * `ok: true`. The quote token is the quote's identity: the same signed token can only ever be one
 * quote, and a second request computes a second token, which is a second quote.
 */
export async function recordQuoteGenerated(args: {
  userId: string;
  serviceId: string;
  breakdown: BookingPriceBreakdown;
}): Promise<IngestResult> {
  const user = await prisma.user.findUnique({ where: { id: args.userId }, select: { id: true, dataOrigin: true } });
  if (!user) return { ok: false, error: "MALFORMED_EVENT", detail: "actor" };
  const b = args.breakdown;
  return record(
    {
      eventId: `quote_${digest(b.quoteToken).slice(0, 48)}`,
      eventName: "QUOTE_GENERATED",
      serviceId: args.serviceId,
      serviceVersionId: b.serviceVersion,
      variantId: b.selection.variant?.id ?? undefined,
      optionId: b.selection.audience ?? b.selection.professionalPreference ?? undefined,
      quoteFingerprint: b.selectionFingerprint,
      source: "BACKEND",
      platform: "SERVER",
      metadata: {
        finalAmountPaise: b.finalAmountPaise,
        subtotalPaise: b.subtotalPaise,
        discountPaise: b.discountPaise,
        taxesPaise: b.taxesPaise,
        quantity: b.selection.quantity,
        addonCount: b.addons.length,
        couponApplied: Boolean(b.couponCode) && !b.couponError,
        couponError: b.couponError ?? null,
        pricingVersion: b.pricingVersion,
        expiresAt: b.expiresAt,
      },
    },
    { userId: user.id, dataOrigin: user.dataOrigin },
  );
}

/* ───────────────────────── checkout_started (wallet-only) ───────────────────────── */

/**
 * A full-wallet checkout starts and settles in one transaction and writes no Payment row, so there
 * is no CHECKOUT_STARTED outbox event to project. Recorded after commit, keyed on the wallet
 * transaction that paid — the same transaction a replay returns as `alreadyPaid`.
 */
export async function recordWalletCheckoutStarted(args: {
  bookingId: string;
  walletTransactionId: string;
  amountPaid: number;
}): Promise<IngestResult | null> {
  const booking = await bookingAttribution(args.bookingId);
  if (!booking) return null;
  return recordForBooking({
    eventName: "CHECKOUT_STARTED",
    eventId: `checkout_wallet_${digest(args.walletTransactionId).slice(0, 40)}`,
    occurredAt: new Date(),
    booking,
    metadata: { tender: "wallet", amountPaise: Math.round(args.amountPaid * 100), settledInline: true },
  });
}

/* ───────────────────────── outbox projection ───────────────────────── */

export const ANALYTICS_FUNNEL_EVENT_TYPES = [
  EVENT_TYPES.BOOKING_CREATED,
  EVENT_TYPES.CHECKOUT_STARTED,
  EVENT_TYPES.BOOKING_COMPLETED,
  EVENT_TYPES.BOOKING_CANCELLED,
] as const;

/** Whether `booking` is the customer's 2nd-or-later COMPLETED booking (see module header). */
export async function priorCompletedBookingFor(booking: {
  id: string;
  userId: string;
  serviceId: string;
  providerId: string | null;
  completedAt: Date | null;
  createdAt: Date;
}): Promise<{ id: string; serviceId: string; providerId: string | null } | null> {
  const completedAt = booking.completedAt ?? new Date();
  return prisma.booking.findFirst({
    where: {
      userId: booking.userId,
      status: "COMPLETED",
      id: { not: booking.id },
      OR: [
        { completedAt: { lt: completedAt } },
        { completedAt, createdAt: { lt: booking.createdAt } },
      ],
    },
    orderBy: [{ completedAt: "desc" }],
    select: { id: true, serviceId: true, providerId: true },
  });
}

/**
 * Project one domain event into zero, one or two analytics rows. Idempotent on the domain event id;
 * safe to call again for the same event.
 */
export async function projectFunnelDomainEvent(event: HomigoEvent): Promise<void> {
  switch (event.type) {
    case EVENT_TYPES.BOOKING_CREATED: {
      const p = event.data as BookingCreatedPayload;
      const booking = await bookingAttribution(p.bookingId);
      if (!booking) return;
      await recordForBooking({
        eventName: "BOOKING_CREATED",
        eventId: `booking_created_${event.id}`,
        occurredAt: event.time,
        booking,
        metadata: {
          status: p.status,
          finalAmountPaise: p.finalAmountPaise,
          paymentMethod: p.paymentMethod ?? null,
          city: p.city,
          actorType: event.homigo.actorType ?? null,
          hasProvider: Boolean(p.providerId),
        },
      });
      return;
    }
    case EVENT_TYPES.CHECKOUT_STARTED: {
      const p = event.data as CheckoutStartedPayload;
      const booking = await bookingAttribution(p.bookingId);
      if (!booking) return;
      await recordForBooking({
        eventName: "CHECKOUT_STARTED",
        eventId: `checkout_${event.id}`,
        occurredAt: event.time,
        booking,
        metadata: {
          tender: p.razorpayOrderId ? "gateway" : "reservation",
          amountPaise: p.amountPaise,
          hasGatewayOrder: Boolean(p.razorpayOrderId),
        },
      });
      return;
    }
    case EVENT_TYPES.BOOKING_COMPLETED: {
      const p = event.data as BookingCompletedPayload;
      const booking = await bookingAttribution(p.bookingId);
      if (!booking) return;
      await recordForBooking({
        eventName: "BOOKING_COMPLETED",
        eventId: `booking_completed_${event.id}`,
        occurredAt: event.time,
        booking,
        metadata: {
          finalAmountPaise: p.finalAmountPaise,
          actualDurationMin: p.actualDurationMin,
          hasProvider: Boolean(p.providerId),
        },
      });
      const prior = await priorCompletedBookingFor(booking);
      if (prior) {
        await recordForBooking({
          eventName: "REPEAT_BOOKING",
          eventId: `repeat_${event.id}`,
          occurredAt: event.time,
          booking,
          metadata: {
            definition: "customer_completed_count_gt_1",
            sameService: prior.serviceId === booking.serviceId,
            sameProvider: Boolean(booking.providerId) && prior.providerId === booking.providerId,
          },
        });
      }
      return;
    }
    case EVENT_TYPES.BOOKING_CANCELLED: {
      const p = event.data as BookingCancelledPayload;
      const booking = await bookingAttribution(p.bookingId);
      if (!booking) return;
      await recordForBooking({
        eventName: "CANCELLED",
        eventId: `cancelled_${event.id}`,
        occurredAt: event.time,
        booking,
        metadata: {
          cancelledBy: p.cancelledBy,
          status: p.status,
          refundAmountPaise: p.refundAmountPaise,
          hadProvider: Boolean(p.providerId),
        },
      });
      return;
    }
    default:
      return;
  }
}
