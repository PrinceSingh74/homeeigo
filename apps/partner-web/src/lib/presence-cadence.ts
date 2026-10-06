export type AvailabilityCadenceKey = "OFFLINE" | "AVAILABLE" | "OFFERED" | "ACCEPTING" | "EN_ROUTE" | "ON_JOB" | "PAUSED";

export type PresenceCadence = {
  heartbeat: boolean;
  /** null = never attach GPS. 1 = every beat. */
  locationEveryNthBeat: number | null;
};

/** Seconds between heartbeats until the server names its own interval. A background tab doubles it. */
export const DEFAULT_HEARTBEAT_INTERVAL_SEC = 25;
/** How long the server treats a GPS fix as fresh, counted from when the device captured it. */
export const LOCATION_FRESH_SEC = 60;

/**
 * A partner who can be offered a job sends a location with every beat. Dispatch rejects a partner
 * whose fix is older than LOCATION_FRESH_SEC, so a location every third beat (75 s) left an
 * available partner unmatchable for part of every cycle.
 */
export const PRESENCE_CADENCE: Record<AvailabilityCadenceKey, PresenceCadence> = {
  OFFLINE: { heartbeat: false, locationEveryNthBeat: null },
  AVAILABLE: { heartbeat: true, locationEveryNthBeat: 1 },
  OFFERED: { heartbeat: true, locationEveryNthBeat: 1 },
  ACCEPTING: { heartbeat: true, locationEveryNthBeat: 1 },
  EN_ROUTE: { heartbeat: true, locationEveryNthBeat: 1 },
  ON_JOB: { heartbeat: true, locationEveryNthBeat: 1 },
  PAUSED: { heartbeat: true, locationEveryNthBeat: null },
};

/**
 * Should the device be asked for its position again before this fix is sent? The position watcher
 * only reports when something changes, so on a device that is not moving its last fix keeps an old
 * capture time. Half the freshness window leaves the other half for the fix to reach the server and
 * be used.
 */
export function fixNeedsRefresh(capturedAtMs: number | null, nowMs: number): boolean {
  if (capturedAtMs == null || !Number.isFinite(capturedAtMs)) return true;
  return nowMs - capturedAtMs > (LOCATION_FRESH_SEC * 1000) / 2;
}
