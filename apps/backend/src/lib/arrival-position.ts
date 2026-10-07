import { distanceKm } from "./geo";
import { knownCoords } from "./geo-unknown";

/**
 * Is the partner where the request says they are? Answered from what the SERVER holds, never from
 * the coordinates in the request.
 *
 * `/arrived`, `/start`, the on-site requirement check and the GPS-geofence arrival used to judge a
 * position the request carried against the job address. The holder of a job is sent that address's
 * exact coordinates, so any client could send them back and be recorded as arrived from anywhere.
 *
 * What the server holds for a partner, and what this reads:
 *   - the presence fix: the last position the partner's device reported through the heartbeat of
 *     its active session, with the time the SERVER received it;
 *   - the tracking position: the last position the same partner sent on the tracking stream.
 *
 * The rule: the presence fix must have been received recently (by the server's clock — the device's
 * own timestamp cannot buy freshness), must not have been old already when it arrived, and must be
 * at the job; and a recent tracking position must not place the partner somewhere else.
 *
 * This is not device attestation. Both streams are written by the partner's device, and a client
 * built to lie can report a consistent false position on both. What this closes is everything
 * short of that: the job's own coordinates sent back, a stale fix, a position on one stream that
 * the other contradicts. The exceptions are explicit and recorded: the customer confirming the
 * professional is there, or an admin waiving the check with a reason.
 */
export type ServerFix = { latitude: number; longitude: number; capturedAt: Date; receivedAt: Date | null } | null;
export type TrackingPosition = { latitude: number; longitude: number; receivedAt: Date } | null;

export type PositionConfirmation =
  | { ok: true; fixAgeSec: number; fixDistanceM: number | null }
  | { ok: false; error: "LOCATION_UNCONFIRMED" | "LOCATION_MISMATCH"; fixAgeSec: number | null; fixDistanceM: number | null };

export function confirmPositionAgainstServerFix(input: {
  fix: ServerFix;
  tracking?: TrackingPosition;
  now: Date;
  /** Oldest fix, by server receive time, that still says where the partner is now. */
  maxAgeSec: number;
  /** A capture time ahead of the server clock by more than this is not a reading of the present. */
  futureToleranceSec: number;
  jobLatitude: number | null | undefined;
  jobLongitude: number | null | undefined;
  radiusM: number;
}): PositionConfirmation {
  const unconfirmed = (fixAgeSec: number | null): PositionConfirmation => ({ ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec, fixDistanceM: null });
  const fix = input.fix;
  const at = fix ? knownCoords(fix.latitude, fix.longitude) : null;
  if (!fix || !at || !fix.receivedAt) return unconfirmed(null);

  const nowMs = input.now.getTime();
  const receivedAgo = (nowMs - fix.receivedAt.getTime()) / 1000;
  if (!Number.isFinite(receivedAgo) || receivedAgo > input.maxAgeSec || receivedAgo < -input.futureToleranceSec) {
    return unconfirmed(Number.isFinite(receivedAgo) ? Math.round(receivedAgo) : null);
  }
  // The reading itself must be recent too: a fix that was already old when the server got it, or
  // one dated in the future, is not a reading of where the partner is now.
  const capturedAgo = (nowMs - fix.capturedAt.getTime()) / 1000;
  if (!Number.isFinite(capturedAgo) || capturedAgo > input.maxAgeSec || capturedAgo < -input.futureToleranceSec) return unconfirmed(Math.round(receivedAgo));
  const fixAgeSec = Math.max(0, Math.round(receivedAgo));

  // A job address with no known coordinates cannot be measured against. The fresh fix still shows a
  // live device reporting; the distance is simply not claimed.
  const job = knownCoords(input.jobLatitude, input.jobLongitude);
  if (!job) return { ok: true, fixAgeSec, fixDistanceM: null };

  const metres = (p: { latitude: number; longitude: number }) => Math.round(distanceKm(p.latitude, p.longitude, job.latitude, job.longitude) * 1000);
  const fixDistanceM = metres(at);
  if (fixDistanceM > input.radiusM) return { ok: false, error: "LOCATION_MISMATCH", fixAgeSec, fixDistanceM };

  // The second stream: where the same partner's tracking pings place them, if they are recent.
  const tracking = input.tracking ? knownCoords(input.tracking.latitude, input.tracking.longitude) : null;
  if (tracking && input.tracking) {
    const trackingAgo = (nowMs - input.tracking.receivedAt.getTime()) / 1000;
    if (trackingAgo >= -input.futureToleranceSec && trackingAgo <= input.maxAgeSec && metres(tracking) > input.radiusM) {
      return { ok: false, error: "LOCATION_MISMATCH", fixAgeSec, fixDistanceM: metres(tracking) };
    }
  }
  return { ok: true, fixAgeSec, fixDistanceM };
}
