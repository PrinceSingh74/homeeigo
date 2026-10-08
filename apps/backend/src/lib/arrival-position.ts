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
 * The mock-location signal (2026-10-08). Android marks every fix a mock-location app produced
 * (`mocked: true` on the fix, from the OS, not from our client); iOS has no such flag, and older
 * clients and the web send nothing. The server keeps the flag with each fix it stores and reads it
 * here with three values: `true` — the device itself says the fix was mocked; `false` — the OS says
 * it was not; absent/null — unknown. A fix the device flags as mocked is NOT a position the server
 * holds: it confirms nothing (LOCATION_UNCONFIRMED, as if no fix had arrived). On the tracking
 * stream the flag is asymmetric: a mocked tracking point is never evidence FOR the partner, but a
 * recent mocked point away from the job is still evidence AGAINST them (a client that fakes one
 * stream and not the other has contradicted itself). `false` and absent are treated exactly as a
 * fix was before the flag existed. Whether any point considered was mocked is reported as
 * `locationMocked` (true / false / null = unknown) so the refusal, the audit and the risk signal
 * can say so.
 *
 * What this is and is not. It is the device's own word about its fix, read by the server and never
 * overridable from the request body of a lifecycle call. It is NOT app or device attestation: a
 * rooted phone, a patched client or a replayed request can still report `false` on a fabricated
 * fix, and Play Integrity / App Attest verification of the client is still absent. Both streams
 * are written by the partner's device, and a client built to lie can report a consistent false
 * position on both with the flag cleared. What this closes is everything short of that: the job's
 * own coordinates sent back, a stale fix, a position on one stream that the other contradicts, and
 * a stock phone running a fake-GPS app. The exceptions are explicit and recorded: the customer
 * confirming the professional is there, or an admin waiving the check with a reason.
 */
export type ServerFix = { latitude: number; longitude: number; capturedAt: Date; receivedAt: Date | null; mocked?: boolean | null } | null;
export type TrackingPosition = { latitude: number; longitude: number; receivedAt: Date; mocked?: boolean | null } | null;

export type PositionConfirmation =
  | { ok: true; fixAgeSec: number; fixDistanceM: number | null; locationMocked: boolean | null }
  | { ok: false; error: "LOCATION_UNCONFIRMED" | "LOCATION_MISMATCH"; fixAgeSec: number | null; fixDistanceM: number | null; locationMocked: boolean | null };

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
  const fix = input.fix;
  const nowMs = input.now.getTime();
  const recent = (receivedAt: Date) => {
    const ago = (nowMs - receivedAt.getTime()) / 1000;
    return Number.isFinite(ago) && ago >= -input.futureToleranceSec && ago <= input.maxAgeSec;
  };
  // The second stream, when it is recent enough to say anything about now.
  const trackingAt = input.tracking ? knownCoords(input.tracking.latitude, input.tracking.longitude) : null;
  const tracking = trackingAt && input.tracking && recent(input.tracking.receivedAt) ? { at: trackingAt, mocked: input.tracking.mocked ?? null } : null;
  // Was any point this answer rests on flagged as mocked? Unknown (null) only when nothing says.
  const locationMocked: boolean | null = fix?.mocked === true || tracking?.mocked === true ? true : fix?.mocked === false ? false : null;

  const unconfirmed = (fixAgeSec: number | null): PositionConfirmation => ({ ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec, fixDistanceM: null, locationMocked });
  const at = fix ? knownCoords(fix.latitude, fix.longitude) : null;
  if (!fix || !at || !fix.receivedAt) return unconfirmed(null);
  // The device's own word: a fix it reports as mocked is not a position the server holds.
  if (fix.mocked === true) return unconfirmed(recent(fix.receivedAt) ? Math.max(0, Math.round((nowMs - fix.receivedAt.getTime()) / 1000)) : null);

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
  if (!job) return { ok: true, fixAgeSec, fixDistanceM: null, locationMocked };

  const metres = (p: { latitude: number; longitude: number }) => Math.round(distanceKm(p.latitude, p.longitude, job.latitude, job.longitude) * 1000);
  const fixDistanceM = metres(at);
  if (fixDistanceM > input.radiusM) return { ok: false, error: "LOCATION_MISMATCH", fixAgeSec, fixDistanceM, locationMocked };

  // The second stream must not place the partner somewhere else. A mocked tracking point is no
  // evidence for the partner (it adds nothing when it agrees), but it still counts against them.
  if (tracking && metres(tracking.at) > input.radiusM) {
    return { ok: false, error: "LOCATION_MISMATCH", fixAgeSec, fixDistanceM: metres(tracking.at), locationMocked };
  }
  return { ok: true, fixAgeSec, fixDistanceM, locationMocked };
}
