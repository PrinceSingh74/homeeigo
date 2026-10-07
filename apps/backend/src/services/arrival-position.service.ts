import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { confirmPositionAgainstServerFix, type PositionConfirmation } from "../lib/arrival-position";
import { knownCoords } from "../lib/geo-unknown";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { ARRIVAL_FIX_MAX_AGE_SEC, POSITION_EXCEPTION_MAX_AGE_SEC, TIMESTAMP_FUTURE_TOLERANCE_SEC } from "../lib/partner-presence.config";

/** The admin action that waives the position check for one booking (see admin-booking-operations). */
export const POSITION_CHECK_WAIVED_ACTION = "ADMIN_BOOKING_POSITION_CHECK_WAIVED";
/** The customer of the booking saying the professional is there (the other recorded exception). */
export const CUSTOMER_CONFIRMED_ARRIVAL_ACTION = "CUSTOMER_CONFIRMED_PROFESSIONAL_ARRIVAL";

/** Confirmed from the server-held fix (`position` is that fix), or vouched for by a recorded exception. */
/**
 * Written when an arrival is RECORDED on an exception instead of a confirmed position. This, not
 * the exception itself, is what "the arrival was vouched for" means afterwards: a customer who taps
 * "confirm" for an arrival that the partner's position confirmed anyway has changed nothing.
 */
export const ARRIVAL_VOUCHED_ACTION = "PARTNER_ARRIVAL_VOUCHED";

export type PartnerPositionResult =
  | (Extract<PositionConfirmation, { ok: true }> & { waived?: undefined; position: { latitude: number; longitude: number } })
  | Extract<PositionConfirmation, { ok: false }>
  | { ok: true; waived: true; by: "admin" | "customer" };

/**
 * The recorded exception in force for this booking and this partner, if any: an admin's waiver or
 * the customer's confirmation, each an activity-log row naming who vouched and for which partner,
 * and each only for a limited time after it was recorded (see POSITION_EXCEPTION_MAX_AGE_SEC).
 */
export async function positionException(bookingId: string, providerId: string, now = new Date()): Promise<"admin" | "customer" | null> {
  const since = (sec: number) => new Date(now.getTime() - sec * 1000);
  const row = await prisma.activityLog.findFirst({
    where: {
      bookingId,
      providerId,
      OR: [
        { action: POSITION_CHECK_WAIVED_ACTION, createdAt: { gte: since(POSITION_EXCEPTION_MAX_AGE_SEC.admin) } },
        { action: CUSTOMER_CONFIRMED_ARRIVAL_ACTION, createdAt: { gte: since(POSITION_EXCEPTION_MAX_AGE_SEC.customer) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { action: true },
  });
  if (!row) return null;
  return row.action === POSITION_CHECK_WAIVED_ACTION ? "admin" : "customer";
}

/**
 * Confirms that the partner is at the job from the position the server holds for them (the last
 * fix their device reported through the presence heartbeat), for `/arrived` and `/start`.
 *
 * A refusal is not silent: a fix that places the partner away from a job they claim to have reached
 * is recorded as a FAKE_ARRIVAL risk signal, the same one a failed proximity check records.
 * An admin's waiver for this booking (a named admin and a reason, in the booking's activity log)
 * skips the check — for a device that cannot produce a fix while the customer confirms the visit.
 */
export async function confirmPartnerPosition(input: {
  providerId: string;
  bookingId: string;
  action: "arrive" | "start" | "requirement_check" | "geofence";
  jobLatitude: number | null | undefined;
  jobLongitude: number | null | undefined;
}): Promise<PartnerPositionResult> {
  // The two exceptions, each a row in the booking's activity log naming who vouched and for which
  // partner: a partner who takes the job over is checked again. The geofence never uses them — an
  // exception lets a person declare arrival, it does not make the tracker declare it for them.
  // They are the fallback, looked at only when the position does not confirm: a partner whose
  // device does place them at the job has arrived on that, whoever also vouched for them.
  const presence = await prisma.partnerPresence.findUnique({
    where: { providerId: input.providerId },
    select: { lastLocationLat: true, lastLocationLng: true, lastLocationAt: true, lastLocationReceivedAt: true },
  });
  const fix =
    presence?.lastLocationLat != null && presence.lastLocationLng != null && presence.lastLocationAt
      ? { latitude: presence.lastLocationLat, longitude: presence.lastLocationLng, capturedAt: presence.lastLocationAt, receivedAt: presence.lastLocationReceivedAt }
      : null;
  // The second stream: this partner's last tracking ping for THIS booking (server-timed). Only the
  // tracking channel writes `location_history`. The `locations` row is not a second stream: the
  // heartbeat writes it together with the presence fix, so it could never contradict the fix.
  const lastPing = await prisma.locationHistory.findFirst({
    where: { providerId: input.providerId, tracking: { bookingId: input.bookingId } },
    orderBy: { timestamp: "desc" },
    select: { latitude: true, longitude: true, timestamp: true },
  });
  const tracking = lastPing ? { latitude: lastPing.latitude, longitude: lastPing.longitude, receivedAt: lastPing.timestamp } : null;

  const result = confirmPositionAgainstServerFix({
    fix,
    tracking,
    now: new Date(),
    maxAgeSec: ARRIVAL_FIX_MAX_AGE_SEC,
    futureToleranceSec: TIMESTAMP_FUTURE_TOLERANCE_SEC,
    jobLatitude: input.jobLatitude,
    jobLongitude: input.jobLongitude,
    radiusM: eventPlatformConfig.arrivalRadiusM,
  });
  if (result.ok) {
    incCounter("partner_position_check_total", { action: input.action, outcome: "confirmed" });
    return { ...result, position: { latitude: fix!.latitude, longitude: fix!.longitude } };
  }
  if (input.action !== "geofence") {
    const by = await positionException(input.bookingId, input.providerId);
    if (by) {
      // Vouched for: not refused, and no fake-arrival signal against a partner the customer or an
      // admin says is there. What the device said is still kept, for whoever reviews the exception.
      logger.info("partner_position_vouched_over_device", {
        bookingId: input.bookingId,
        providerId: input.providerId,
        action: input.action,
        by,
        deviceSaid: result.error,
        fixAgeSec: result.fixAgeSec,
        fixDistanceM: result.fixDistanceM,
      });
      incCounter("partner_position_check_total", { action: input.action, outcome: by === "admin" ? "waived" : "customer_confirmed" });
      return { ok: true, waived: true, by };
    }
  }
  incCounter("partner_position_check_total", { action: input.action, outcome: result.error });

  logger.warn("partner_position_not_confirmed", {
    bookingId: input.bookingId,
    providerId: input.providerId,
    action: input.action,
    reason: result.error,
    fixAgeSec: result.fixAgeSec,
    fixDistanceM: result.fixDistanceM,
  });
  const job = knownCoords(input.jobLatitude, input.jobLongitude);
  if (result.error === "LOCATION_MISMATCH" && fix && job) {
    void import("./partner-risk.service")
      .then(({ partnerRiskService }) =>
        partnerRiskService.evaluateArrival({
          providerId: input.providerId,
          bookingId: input.bookingId,
          jobLat: job.latitude,
          jobLng: job.longitude,
          partnerLat: fix.latitude,
          partnerLng: fix.longitude,
        }),
      )
      .catch(() => undefined);
  }
  return result;
}

/**
 * The position the server holds for a partner right now: the presence fix, if the server received
 * it recently enough to say where they are. This is what is written beside something the partner
 * sends (a photo); the coordinates in their request are never written.
 */
export async function heldPartnerPosition(providerId: string, now = new Date()): Promise<{ latitude: number; longitude: number } | null> {
  const p = await prisma.partnerPresence.findUnique({
    where: { providerId },
    select: { lastLocationLat: true, lastLocationLng: true, lastLocationAt: true, lastLocationReceivedAt: true },
  });
  if (!p || p.lastLocationLat == null || p.lastLocationLng == null || !p.lastLocationAt) return null;
  const confirmed = confirmPositionAgainstServerFix({
    fix: { latitude: p.lastLocationLat, longitude: p.lastLocationLng, capturedAt: p.lastLocationAt, receivedAt: p.lastLocationReceivedAt },
    now,
    maxAgeSec: ARRIVAL_FIX_MAX_AGE_SEC,
    futureToleranceSec: TIMESTAMP_FUTURE_TOLERANCE_SEC,
    // No job to measure against: only "is this a current reading" is asked.
    jobLatitude: null,
    jobLongitude: null,
    radiusM: eventPlatformConfig.arrivalRadiusM,
  });
  return confirmed.ok ? { latitude: p.lastLocationLat, longitude: p.lastLocationLng } : null;
}

/**
 * The customer of a booking says the professional is at the door. This is the exception for a
 * device that cannot give a position, not the normal way to arrive: it is written to the booking's
 * activity log with the customer and the professional it vouches for, and counted on its own metric.
 */
export async function recordCustomerArrivalConfirmation(input: { bookingId: string; customerId: string; ipAddress?: string | null }) {
  const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { userId: true, providerId: true, status: true, arrivedAt: true } });
  if (!booking || booking.userId !== input.customerId) return { ok: false as const, error: "NOT_FOUND" as const };
  if (!booking.providerId || !["ACCEPTED", "ASSIGNED", "EN_ROUTE"].includes(String(booking.status))) return { ok: false as const, error: "INVALID_STATUS" as const };
  // A confirmation that has run out is history: confirming again records a new one.
  const already = await prisma.activityLog.findFirst({
    where: {
      bookingId: input.bookingId,
      providerId: booking.providerId,
      action: CUSTOMER_CONFIRMED_ARRIVAL_ACTION,
      createdAt: { gte: new Date(Date.now() - POSITION_EXCEPTION_MAX_AGE_SEC.customer * 1000) },
    },
    select: { id: true, createdAt: true },
  });
  let recordedAt = already?.createdAt ?? new Date();
  if (!already) {
    recordedAt = new Date();
    await prisma.activityLog.create({
      data: {
        bookingId: input.bookingId,
        userId: input.customerId,
        providerId: booking.providerId,
        action: CUSTOMER_CONFIRMED_ARRIVAL_ACTION,
        description: "Customer confirmed the professional is at the service address",
        ipAddress: input.ipAddress ?? undefined,
      },
    });
    incCounter("customer_arrival_confirmation_total");
  }
  // Until when this confirmation vouches for the professional: the customer's app offers the control again after it.
  const validUntil = new Date(recordedAt.getTime() + POSITION_EXCEPTION_MAX_AGE_SEC.customer * 1000);
  return { ok: true as const, changed: !already, alreadyArrived: Boolean(booking.arrivedAt), validUntil };
}
