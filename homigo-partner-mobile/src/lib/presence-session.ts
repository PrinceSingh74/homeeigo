/**
 * Presence session shared by every GPS producer in this JS runtime: the foreground heartbeat
 * (use-partner-presence-heartbeat) and the background location task (background-location).
 *
 * Why shared: the backend's location guard (apps/backend/src/lib/partner-presence-location.ts)
 * rejects any fix whose `sequence` is not strictly greater than the last stored one
 * (SEQUENCE_REGRESSION). Two producers with private counters would reject each other's fixes.
 * One counter, advanced by `nextLocationSequence()`, keeps them ordered.
 *
 * `sessionId` is the refresh-token row id (the backend promotes the new id on every refresh), so
 * the auth layer updates it after a token rotation instead of letting the next beat fail
 * INVALID_SESSION first.
 *
 * `lastLocationSequence` is an Int column server-side — never seed it from Date.now().
 */

export const DEFAULT_HEARTBEAT_INTERVAL_SEC = 25;

export type PresenceSessionCache = {
  sessionId: string | null;
  deviceId: string | null;
  heartbeatIntervalSeconds: number;
  locationSequence: number;
  lastSnapshotAt: number;
  refreshInFlight: Promise<void> | null;
};

export const presenceSession: PresenceSessionCache = {
  sessionId: null,
  deviceId: null,
  heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SEC,
  locationSequence: 0,
  lastSnapshotAt: 0,
  refreshInFlight: null,
};

export function resetPresenceSession() {
  presenceSession.sessionId = null;
  presenceSession.deviceId = null;
  presenceSession.heartbeatIntervalSeconds = DEFAULT_HEARTBEAT_INTERVAL_SEC;
  presenceSession.locationSequence = 0;
  presenceSession.lastSnapshotAt = 0;
  presenceSession.refreshInFlight = null;
}

/** Fold a server snapshot in. The sequence only ever moves forward. */
export function applyPresenceSnapshot(snap: {
  sessionId: string | null;
  deviceId: string | null;
  heartbeatIntervalSeconds: number;
  location: { sequence: number | null } | null;
}) {
  if (snap.sessionId) presenceSession.sessionId = snap.sessionId;
  if (snap.deviceId) presenceSession.deviceId = snap.deviceId;
  if (snap.heartbeatIntervalSeconds > 0) {
    presenceSession.heartbeatIntervalSeconds = snap.heartbeatIntervalSeconds;
  }
  if (typeof snap.location?.sequence === "number") {
    presenceSession.locationSequence = Math.max(presenceSession.locationSequence, snap.location.sequence);
  }
}

export function nextLocationSequence(): number {
  presenceSession.locationSequence += 1;
  return presenceSession.locationSequence;
}

/** Called after a token refresh: the server has already promoted this id to the active session. */
export function adoptRefreshedSession(sessionId: string | null) {
  if (sessionId) presenceSession.sessionId = sessionId;
}
