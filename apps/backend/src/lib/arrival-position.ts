import { distanceKm } from "./geo";
import { knownCoords } from "./geo-unknown";

/**
 * Is the partner where the request says they are? Answered from the position the SERVER holds,
 * not from the one in the request.
 *
 * `/arrived` and `/start` used to judge only the coordinates the client sent against the job
 * address. The holder of a job is sent that address's exact coordinates, so any client could send
 * them back and be recorded as arrived from anywhere. The partner's device already reports its
 * position with every heartbeat while it travels; that stream is what this reads. The coordinates
 * in the request are still validated as before — they are the device's claim, and a claim that
 * disagrees with what the server holds is a signal worth recording.
 */
export type ServerFix = { latitude: number; longitude: number; capturedAt: Date } | null;

export type PositionConfirmation =
  | { ok: true; fixAgeSec: number; fixDistanceM: number | null }
  | { ok: false; error: "LOCATION_UNCONFIRMED" | "LOCATION_MISMATCH"; fixAgeSec: number | null; fixDistanceM: number | null };

export function confirmPositionAgainstServerFix(input: {
  fix: ServerFix;
  now: Date;
  /** Oldest fix that still says where the partner is now. */
  maxAgeSec: number;
  /** A capture time ahead of the server clock by more than this is not a reading of the present. */
  futureToleranceSec: number;
  jobLatitude: number | null | undefined;
  jobLongitude: number | null | undefined;
  radiusM: number;
}): PositionConfirmation {
  const fix = input.fix;
  const at = fix ? knownCoords(fix.latitude, fix.longitude) : null;
  if (!fix || !at) return { ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec: null, fixDistanceM: null };

  const ageSec = (input.now.getTime() - fix.capturedAt.getTime()) / 1000;
  if (!Number.isFinite(ageSec) || ageSec > input.maxAgeSec || ageSec < -input.futureToleranceSec) {
    return { ok: false, error: "LOCATION_UNCONFIRMED", fixAgeSec: Number.isFinite(ageSec) ? Math.round(ageSec) : null, fixDistanceM: null };
  }
  const fixAgeSec = Math.max(0, Math.round(ageSec));

  // A job address with no known coordinates cannot be measured against. The fresh fix still shows a
  // live device reporting; the distance is simply not claimed.
  const job = knownCoords(input.jobLatitude, input.jobLongitude);
  if (!job) return { ok: true, fixAgeSec, fixDistanceM: null };

  const fixDistanceM = Math.round(distanceKm(at.latitude, at.longitude, job.latitude, job.longitude) * 1000);
  if (fixDistanceM > input.radiusM) return { ok: false, error: "LOCATION_MISMATCH", fixAgeSec, fixDistanceM };
  return { ok: true, fixAgeSec, fixDistanceM };
}
