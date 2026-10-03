/**
 * Live-tracking frame integrity — pure reducer shared by the tracking screen.
 *
 * Mirrors apps/web hooks/use-booking-tracking.ts and hardens it for a phone on a flaky network:
 *   - dedupe by eventId (or a content key when a frame has none),
 *   - drop out-of-order frames (older than the last applied one),
 *   - drop stale frames (location older than STALE_FRAME_MS when it arrives),
 *   - drop physically impossible jumps (implied speed > MAX_SPEED_MPS between two fixes).
 * A REST snapshot (/api/tracking/:id) goes through the same reducer, so a refetch after a
 * reconnect can only move the state forward, never back.
 */

export type TrackingFrame = {
  eventId?: string;
  type?: string;
  bookingId?: string;
  status?: string;
  eta?: number | null;
  distance?: number | null;
  providerLatitude?: number | null;
  providerLongitude?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  bearing?: number | null;
  speed?: number | null;
  locationUpdatedAt?: string | null;
  timestamp?: string | null;
  sequence?: number | null;
};

export type LiveTrackingState = {
  lat?: number;
  lng?: number;
  eta?: number;
  distance?: number;
  status?: string;
  bearing?: number;
  speed?: number;
  /** Server time of the last applied location fix (ms). */
  locationTs: number;
  /** Server time of the last applied frame of any kind (ms). */
  eventTs: number;
  /** Highest applied sequence number, when the server sends one. */
  sequence: number;
  seen: string[];
  /** Consecutive fixes rejected as impossible jumps (a persistent new track is eventually accepted). */
  rejectedJumps: number;
};

export const INITIAL_TRACKING_STATE: LiveTrackingState = { locationTs: 0, eventTs: 0, sequence: -1, seen: [], rejectedJumps: 0 };

/** ~200 km/h — a two-wheeler in a city never legitimately exceeds this between two fixes. */
export const MAX_SPEED_MPS = 55;
/** A location that was already this old when it arrived is not "live". */
export const STALE_FRAME_MS = 5 * 60_000;
const SEEN_LIMIT = 300;
/** After this many consecutive "impossible" fixes the old anchor was the outlier — accept. */
const JUMP_TOLERANCE = 3;

export type DropReason = "duplicate" | "out_of_order" | "stale" | "impossible_jump" | "empty";

export type ApplyResult =
  | { applied: true; state: LiveTrackingState }
  | { applied: false; reason: DropReason; state: LiveTrackingState };

/** Unwrap the server envelope `{ type, data: {...}, timestamp }` (tolerating flat frames). */
export function unwrapTrackingMessage(raw: unknown): TrackingFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown> & { data?: unknown };
  if (r.data && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>;
    return { ...(d as TrackingFrame), type: (d.type as string | undefined) ?? (r.type as string | undefined) };
  }
  return r as TrackingFrame;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseTs(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function frameKey(f: TrackingFrame): string {
  if (f.eventId) return `id:${f.eventId}`;
  return [
    f.type ?? "",
    f.status ?? "",
    f.locationUpdatedAt ?? f.timestamp ?? "",
    f.providerLatitude ?? f.latitude ?? "",
    f.providerLongitude ?? f.longitude ?? "",
    f.eta ?? "",
    f.sequence ?? "",
  ].join("|");
}

export function applyTrackingFrame(
  state: LiveTrackingState,
  frame: TrackingFrame,
  now: number = Date.now(),
  source: "ws" | "rest" = "ws",
): ApplyResult {
  const lat = num(frame.providerLatitude) ?? num(frame.latitude);
  const lng = num(frame.providerLongitude) ?? num(frame.longitude);
  const hasLocation = lat != null && lng != null;
  const eta = num(frame.eta);
  const distance = num(frame.distance);
  const status = typeof frame.status === "string" && frame.status ? frame.status : undefined;
  if (!hasLocation && eta == null && distance == null && !status) {
    return { applied: false, reason: "empty", state };
  }

  const key = frameKey(frame);
  if (state.seen.includes(key)) return { applied: false, reason: "duplicate", state };

  const seq = num(frame.sequence);
  if (seq != null && seq <= state.sequence) return { applied: false, reason: "out_of_order", state };

  // Envelope time orders frames of every kind; the location fix time orders positions only.
  // (A REST snapshot has no envelope time: its status is as fresh as the request itself.)
  const eventTs = parseTs(frame.timestamp);
  if (eventTs != null && eventTs < state.eventTs) return { applied: false, reason: "out_of_order", state };

  const locTs = parseTs(frame.locationUpdatedAt) ?? eventTs;
  let applyLocation = hasLocation;
  if (hasLocation) {
    const carriesNews = status != null || eta != null || distance != null;
    if (locTs != null && locTs < state.locationTs) {
      // An older position never moves the marker back; a REST snapshot's status is still fresh.
      if (source === "ws" || !carriesNews) return { applied: false, reason: "out_of_order", state };
      applyLocation = false;
    } else if (locTs != null && locTs === state.locationTs && lat === state.lat && lng === state.lng) {
      applyLocation = false; // same fix re-delivered (e.g. REST snapshot after a WS frame)
    } else if (source === "ws" && locTs != null && now - locTs > STALE_FRAME_MS) {
      // Too old to be a live position. A status/eta change riding on it is still news.
      if (!carriesNews) return { applied: false, reason: "stale", state };
      applyLocation = false;
    }
    if (applyLocation && state.lat != null && state.lng != null && state.locationTs > 0 && locTs != null) {
      const dtSec = Math.max(1, (locTs - state.locationTs) / 1000);
      const meters = haversineMeters(state.lat, state.lng, lat!, lng!);
      if (meters / dtSec > MAX_SPEED_MPS && state.rejectedJumps + 1 < JUMP_TOLERANCE) {
        const counted = { ...state, rejectedJumps: state.rejectedJumps + 1 };
        if (!carriesNews) return { applied: false, reason: "impossible_jump", state: counted };
        state = counted;
        applyLocation = false;
      }
    }
  }

  const seen = [...state.seen, key];
  if (seen.length > SEEN_LIMIT) seen.splice(0, seen.length - SEEN_LIMIT);

  const next: LiveTrackingState = {
    ...state,
    seen,
    sequence: seq ?? state.sequence,
    eventTs: eventTs ?? state.eventTs,
    status: status ?? state.status,
    eta: eta ?? state.eta,
    distance: distance ?? state.distance,
  };
  if (applyLocation) {
    next.lat = lat;
    next.lng = lng;
    // Never invent a server time from the device clock — an unknown fix time stays unknown.
    next.locationTs = locTs ?? state.locationTs;
    next.rejectedJumps = 0;
    next.bearing = num(frame.bearing) ?? state.bearing;
    next.speed = num(frame.speed) ?? state.speed;
  }
  return { applied: true, state: next };
}
