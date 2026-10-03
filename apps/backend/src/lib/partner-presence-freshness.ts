import {
  LOCATION_FRESH_SEC,
  LOCATION_STALE_SEC,
  PRESENCE_FRESH_SEC,
  PRESENCE_STALE_SEC,
  type DerivedFreshness,
} from "./partner-presence.config";

export type FreshnessInput = {
  lastHeartbeatAt: Date | null | undefined;
  now?: Date;
};

export type LocationFreshnessInput = {
  lastLocationAt: Date | null | undefined;
  now?: Date;
};

export type OperationalLiveInput = {
  lastHeartbeatAt: Date | null | undefined;
  isOnline: boolean;
  now?: Date;
};

function ageSeconds(at: Date | null | undefined, now: Date): number | null {
  if (!at) return null;
  return Math.max(0, (now.getTime() - at.getTime()) / 1000);
}

/** Derive presence freshness from last heartbeat timestamp — NOT a stored FSM state. */
export function derivePresenceFreshness(input: FreshnessInput): DerivedFreshness {
  const now = input.now ?? new Date();
  const age = ageSeconds(input.lastHeartbeatAt, now);
  if (age === null) return "EXPIRED";
  if (age <= PRESENCE_FRESH_SEC) return "FRESH";
  if (age <= PRESENCE_STALE_SEC) return "STALE";
  return "EXPIRED";
}

export function isPresenceFresh(input: FreshnessInput): boolean {
  return derivePresenceFreshness(input) === "FRESH";
}

export function isLocationFresh(input: LocationFreshnessInput): boolean {
  const now = input.now ?? new Date();
  const age = ageSeconds(input.lastLocationAt, now);
  if (age === null) return false;
  return age <= LOCATION_FRESH_SEC;
}

export function deriveLocationFreshness(input: LocationFreshnessInput): DerivedFreshness {
  const now = input.now ?? new Date();
  const age = ageSeconds(input.lastLocationAt, now);
  if (age === null) return "EXPIRED";
  if (age <= LOCATION_FRESH_SEC) return "FRESH";
  if (age <= LOCATION_STALE_SEC) return "STALE";
  return "EXPIRED";
}

/**
 * Operationally live = availability says online AND presence heartbeat is not expired.
 * Does NOT mutate availability — read-only derived signal for Phase 2 dispatch hints.
 */
export function isOperationallyLive(input: OperationalLiveInput): boolean {
  if (!input.isOnline) return false;
  return derivePresenceFreshness({ lastHeartbeatAt: input.lastHeartbeatAt, now: input.now }) !== "EXPIRED";
}

export { PRESENCE_FRESH_SEC, PRESENCE_STALE_SEC, LOCATION_FRESH_SEC, LOCATION_STALE_SEC };
