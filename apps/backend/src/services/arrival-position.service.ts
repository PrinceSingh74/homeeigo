import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { confirmPositionAgainstServerFix, type PositionConfirmation } from "../lib/arrival-position";
import { knownCoords } from "../lib/geo-unknown";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { ARRIVAL_FIX_MAX_AGE_SEC, TIMESTAMP_FUTURE_TOLERANCE_SEC } from "../lib/partner-presence.config";

/** The admin action that waives the position check for one booking (see admin-booking-operations). */
export const POSITION_CHECK_WAIVED_ACTION = "ADMIN_BOOKING_POSITION_CHECK_WAIVED";

export type PartnerPositionResult = PositionConfirmation | { ok: true; waived: true };

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
  action: "arrive" | "start";
  jobLatitude: number | null | undefined;
  jobLongitude: number | null | undefined;
}): Promise<PartnerPositionResult> {
  const waiver = await prisma.activityLog.findFirst({
    where: { bookingId: input.bookingId, action: POSITION_CHECK_WAIVED_ACTION },
    select: { id: true },
  });
  if (waiver) {
    incCounter("partner_position_check_total", { action: input.action, outcome: "waived" });
    return { ok: true, waived: true };
  }

  const presence = await prisma.partnerPresence.findUnique({
    where: { providerId: input.providerId },
    select: { lastLocationLat: true, lastLocationLng: true, lastLocationAt: true },
  });
  const fix =
    presence?.lastLocationLat != null && presence.lastLocationLng != null && presence.lastLocationAt
      ? { latitude: presence.lastLocationLat, longitude: presence.lastLocationLng, capturedAt: presence.lastLocationAt }
      : null;

  const result = confirmPositionAgainstServerFix({
    fix,
    now: new Date(),
    maxAgeSec: ARRIVAL_FIX_MAX_AGE_SEC,
    futureToleranceSec: TIMESTAMP_FUTURE_TOLERANCE_SEC,
    jobLatitude: input.jobLatitude,
    jobLongitude: input.jobLongitude,
    radiusM: eventPlatformConfig.arrivalRadiusM,
  });
  incCounter("partner_position_check_total", { action: input.action, outcome: result.ok ? "confirmed" : result.error });
  if (result.ok) return result;

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
