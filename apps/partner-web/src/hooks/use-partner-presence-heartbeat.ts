"use client";

import { useEffect, useRef, useState } from "react";
import { PartnerApiError } from "@/lib/api-error";
import { getDeviceId } from "@/lib/device";
import {
  partnerApi,
  type PartnerPresenceHeartbeatBody,
  type PartnerPresenceSnapshot,
  type PresenceFreshness,
} from "@/services/partner-api";
import { usePartnerOperationsQuery } from "@/hooks/use-partner-data";
import { usePartnerStore } from "@/stores/partner-store";
import { rememberPartnerFix } from "@/lib/partner-coords";
import {
  DEFAULT_HEARTBEAT_INTERVAL_SEC,
  fixNeedsRefresh,
  LOCATION_FRESH_SEC,
  PRESENCE_CADENCE,
  type AvailabilityCadenceKey,
  type PresenceCadence,
} from "@/lib/presence-cadence";

export { PRESENCE_CADENCE, type AvailabilityCadenceKey };

declare global {
  interface Window {
    __HOMIGO_PRESENCE_FORENSIC?: {
      refs: number;
      timer: number | null;
      inFlight: boolean;
      beatCount: number;
      availability: string | null;
      generation: number;
    };
  }
}

const DEFAULT_INTERVAL_SEC = DEFAULT_HEARTBEAT_INTERVAL_SEC;
const BACKOFF_CAP_MS = 60_000;
const SESSION_REFRESH_MIN_MS = 5_000;
const LOCATION_MAX_AGE_MS = 240_000;
const PRESENCE_FRESH_SEC = 30;
const PRESENCE_STALE_SEC = 60;
const LOCATION_STALE_SEC = 600;
const FRESHNESS_TICK_MS = 5_000;
/** Survives a client navigation so a new page does not immediately beat again. */
const LAST_BEAT_KEY = "hg_presence_last_beat_ms";
const LOCATION_ERROR_CODES = new Set([
  "INVALID_LATITUDE",
  "INVALID_LONGITUDE",
  "INVALID_ACCURACY",
  "TIMESTAMP_FUTURE",
  "TIMESTAMP_TOO_OLD",
  "SEQUENCE_REGRESSION",
  "IMPOSSIBLE_JUMP",
  "DUPLICATE_LOCATION",
]);

export type PartnerPresenceHeartbeat = {
  connected: boolean;
  reconnecting: boolean;
  lastHeartbeatAt: string | null;
  presenceFreshness: PresenceFreshness;
  locationFreshness: PresenceFreshness;
};

type SocketLikeState = PartnerPresenceHeartbeat;

type GeoFix = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: string;
};

type SharedRuntime = {
  refs: number;
  generation: number;
  timer: number | null;
  tick: number | null;
  inFlight: boolean;
  retry: number;
  beatCount: number;
  intervalSec: number;
  sessionId: string | null;
  deviceId: string | null;
  availability: AvailabilityCadenceKey | null;
  lastFix: GeoFix | null;
  locationSeq: number;
  geoWatchId: number | null;
  geoDenied: boolean;
  lastSessionRefreshAt: number;
  skipLocationOnce: boolean;
  needsBootstrap: boolean;
  listeners: Set<(state: SocketLikeState) => void>;
  state: SocketLikeState;
};

const IDLE_STATE: SocketLikeState = {
  connected: false,
  reconnecting: false,
  lastHeartbeatAt: null,
  presenceFreshness: "EXPIRED",
  locationFreshness: "EXPIRED",
};

let shared: SharedRuntime | null = null;

const STORED_TO_CANONICAL: Record<string, AvailabilityCadenceKey> = {
  OFFLINE: "OFFLINE",
  AVAILABLE: "AVAILABLE",
  OFFERED: "OFFERED",
  ACCEPTING: "ACCEPTING",
  EN_ROUTE: "EN_ROUTE",
  ON_JOB: "ON_JOB",
  PAUSED: "PAUSED",
  offline: "OFFLINE",
  available: "AVAILABLE",
  offered: "OFFERED",
  accepting: "ACCEPTING",
  accepting_job: "ACCEPTING",
  en_route: "EN_ROUTE",
  on_job: "ON_JOB",
  paused: "PAUSED",
};

function toCadenceKey(raw: string | null | undefined): AvailabilityCadenceKey {
  if (!raw) return "OFFLINE";
  return STORED_TO_CANONICAL[raw] ?? STORED_TO_CANONICAL[raw.toUpperCase()] ?? "OFFLINE";
}

function cadenceFor(key: AvailabilityCadenceKey | null): PresenceCadence {
  return PRESENCE_CADENCE[key ?? "OFFLINE"];
}

function deriveFreshness(at: string | null, freshSec: number, staleSec: number, now = Date.now()): PresenceFreshness {
  if (!at) return "EXPIRED";
  const age = (now - Date.parse(at)) / 1000;
  if (!Number.isFinite(age)) return "EXPIRED";
  if (age <= freshSec) return "FRESH";
  if (age <= staleSec) return "STALE";
  return "EXPIRED";
}

function readAppState(): "foreground" | "background" {
  if (typeof document === "undefined") return "foreground";
  return document.visibilityState === "hidden" ? "background" : "foreground";
}

function intervalMs(rt: SharedRuntime): number {
  const base = Math.max(5, rt.intervalSec) * 1000;
  return readAppState() === "background" ? base * 2 : base;
}

function msSinceLastBeat(): number {
  try {
    const last = Number(sessionStorage.getItem(LAST_BEAT_KEY) || 0);
    if (!Number.isFinite(last) || last <= 0) return Number.POSITIVE_INFINITY;
    return Date.now() - last;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function rememberBeat(): void {
  try {
    sessionStorage.setItem(LAST_BEAT_KEY, String(Date.now()));
  } catch {
    /* sessionStorage can throw in private mode; the in-memory timer still paces this page. */
  }
}

function backoffMs(retry: number, retryAfterSec?: number): number {
  if (retryAfterSec != null && retryAfterSec > 0) return Math.min(BACKOFF_CAP_MS, retryAfterSec * 1000);
  return Math.min(BACKOFF_CAP_MS, 1_000 * 2 ** Math.max(0, retry));
}

function emit(rt: SharedRuntime, patch: Partial<SocketLikeState> = {}) {
  const lastHeartbeatAt = patch.lastHeartbeatAt ?? rt.state.lastHeartbeatAt;
  const lastLocationAt = rt.lastFix?.capturedAt ?? null;
  const next: SocketLikeState = {
    connected: patch.connected ?? rt.state.connected,
    reconnecting: patch.reconnecting ?? rt.state.reconnecting,
    lastHeartbeatAt,
    presenceFreshness:
      patch.presenceFreshness ?? deriveFreshness(lastHeartbeatAt, PRESENCE_FRESH_SEC, PRESENCE_STALE_SEC),
    locationFreshness:
      patch.locationFreshness ?? deriveFreshness(lastLocationAt, LOCATION_FRESH_SEC, LOCATION_STALE_SEC),
  };
  rt.state = next;
  for (const fn of rt.listeners) fn(next);
}

function applySnapshot(rt: SharedRuntime, snap: PartnerPresenceSnapshot) {
  if (snap.sessionId) rt.sessionId = snap.sessionId;
  rt.deviceId = snap.deviceId?.trim() || getDeviceId();
  if (snap.heartbeatIntervalSeconds > 0) rt.intervalSec = snap.heartbeatIntervalSeconds;
  if (snap.location?.sequence != null && snap.location.sequence > rt.locationSeq) {
    rt.locationSeq = snap.location.sequence;
  }
  emit(rt, {
    lastHeartbeatAt: snap.lastHeartbeatAt ?? rt.state.lastHeartbeatAt,
    presenceFreshness: snap.presenceFreshness,
    locationFreshness: snap.locationFreshness,
  });
}

function clearTimer(rt: SharedRuntime) {
  if (rt.timer != null) {
    window.clearTimeout(rt.timer);
    rt.timer = null;
  }
}

function stopGeo(rt: SharedRuntime) {
  if (rt.geoWatchId != null && typeof navigator !== "undefined" && navigator.geolocation) {
    navigator.geolocation.clearWatch(rt.geoWatchId);
  }
  rt.geoWatchId = null;
}

function syncGeoWatch(rt: SharedRuntime) {
  const wants = cadenceFor(rt.availability).locationEveryNthBeat != null;
  if (!wants || rt.geoDenied) {
    stopGeo(rt);
    return;
  }
  if (rt.geoWatchId != null) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    rt.geoDenied = true;
    return;
  }
  rt.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined;
      rt.lastFix = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy,
        capturedAt: new Date(pos.timestamp).toISOString(),
      };
      rememberPartnerFix(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      // Only a hard deny should stop the watcher. Timeout / unavailable must not
      // permanently flag GPS as blocked — laptops often timeout on high-accuracy.
      if (err?.code === 1) {
        rt.geoDenied = true;
        stopGeo(rt);
      }
    },
    { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 },
  );
}

/**
 * Before a beat that carries a location: if the watcher's last fix is getting old (a device that is
 * not moving reports nothing new), ask the device once more. Its answer is the device's own position
 * with a current capture time; when it cannot answer, the old fix is sent as it is and the server
 * judges its age.
 */
async function refreshFixIfStale(rt: SharedRuntime, nth: number | null): Promise<void> {
  if (nth == null || rt.geoDenied || rt.skipLocationOnce) return;
  if (nth > 1 && (rt.beatCount + 1) % nth !== 0) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  const captured = rt.lastFix ? Date.parse(rt.lastFix.capturedAt) : null;
  if (!fixNeedsRefresh(captured, Date.now())) return;
  await new Promise<void>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        rt.lastFix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
          capturedAt: new Date(pos.timestamp).toISOString(),
        };
        rememberPartnerFix(pos.coords.latitude, pos.coords.longitude);
        resolve();
      },
      () => resolve(),
      { enableHighAccuracy: false, maximumAge: 10_000, timeout: 6_000 },
    );
  });
}

function locationPayload(rt: SharedRuntime, nth: number | null): PartnerPresenceHeartbeatBody["location"] {
  if (nth == null || rt.skipLocationOnce) return undefined;
  if (nth > 1 && rt.beatCount % nth !== 0) return undefined;
  const fix = rt.lastFix;
  if (!fix) return undefined;
  const captured = Date.parse(fix.capturedAt);
  if (!Number.isFinite(captured) || Date.now() - captured > LOCATION_MAX_AGE_MS) return undefined;
  rt.locationSeq += 1;
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    ...(fix.accuracy != null ? { accuracy: fix.accuracy } : {}),
    capturedAt: fix.capturedAt,
    sequence: rt.locationSeq,
  };
}

function isAlive(rt: SharedRuntime, generation: number): boolean {
  return shared === rt && rt.generation === generation && rt.refs > 0;
}

function publishForensic(rt: SharedRuntime) {
  if (typeof window === "undefined") return;
  window.__HOMIGO_PRESENCE_FORENSIC = {
    refs: rt.refs,
    timer: rt.timer,
    inFlight: rt.inFlight,
    beatCount: rt.beatCount,
    availability: rt.availability,
    generation: rt.generation,
  };
}

async function refreshSession(rt: SharedRuntime, generation: number, force: boolean): Promise<boolean> {
  const now = Date.now();
  if (!force && rt.sessionId && now - rt.lastSessionRefreshAt < SESSION_REFRESH_MIN_MS) return Boolean(rt.sessionId);
  rt.lastSessionRefreshAt = now;
  try {
    const snap = await partnerApi.presenceSnapshot();
    if (!isAlive(rt, generation)) return false;
    applySnapshot(rt, snap);
    return Boolean(rt.sessionId);
  } catch {
    return Boolean(rt.sessionId);
  }
}

async function beat(rt: SharedRuntime) {
  const generation = rt.generation;
  if (rt.inFlight) return;
  const plan = cadenceFor(rt.availability);
  if (!plan.heartbeat) return;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emit(rt, { connected: false, reconnecting: true });
    rt.retry += 1;
    schedule(rt, Math.max(2_000, backoffMs(rt.retry)));
    return;
  }

  rt.inFlight = true;
  emit(rt, { reconnecting: !rt.state.connected });

  try {
    if (rt.needsBootstrap || !rt.sessionId || !rt.deviceId) {
      const ok = await refreshSession(rt, generation, true);
      if (!isAlive(rt, generation)) return;
      rt.needsBootstrap = false;
      if (!ok || !rt.sessionId) {
        rt.retry += 1;
        emit(rt, { connected: false, reconnecting: true });
        schedule(rt, backoffMs(rt.retry));
        return;
      }
    }

    await refreshFixIfStale(rt, plan.locationEveryNthBeat);
    if (!isAlive(rt, generation)) return;
    rt.beatCount += 1;
    const body: PartnerPresenceHeartbeatBody = {
      sessionId: rt.sessionId!,
      deviceId: rt.deviceId ?? getDeviceId(),
      timestamp: new Date().toISOString(),
      appState: readAppState(),
      platform: "web",
      availabilityTelemetry: rt.availability ?? undefined,
      location: locationPayload(rt, plan.locationEveryNthBeat),
    };
    rt.skipLocationOnce = false;

    const result = await partnerApi.presenceHeartbeat(body);
    if (!isAlive(rt, generation)) return;
    rt.retry = 0;
    rememberBeat();
    if (result.snapshot) applySnapshot(rt, result.snapshot);
    const lastHeartbeatAt = result.snapshot?.lastHeartbeatAt ?? new Date().toISOString();
    emit(rt, {
      connected: true,
      reconnecting: false,
      lastHeartbeatAt,
      presenceFreshness: result.snapshot?.presenceFreshness ?? deriveFreshness(lastHeartbeatAt, PRESENCE_FRESH_SEC, PRESENCE_STALE_SEC),
      locationFreshness: result.snapshot?.locationFreshness ?? rt.state.locationFreshness,
    });
    schedule(rt, intervalMs(rt));
  } catch (error) {
    if (!isAlive(rt, generation)) return;
    await handleBeatError(rt, generation, error);
  } finally {
    if (rt.generation === generation) rt.inFlight = false;
    publishForensic(rt);
  }
}

async function handleBeatError(rt: SharedRuntime, generation: number, error: unknown) {
  const err = error instanceof PartnerApiError ? error : null;
  const code = err?.code;
  const status = err?.status ?? 0;

  if (code === "STALE_SESSION" || code === "INVALID_SESSION" || code === "DEVICE_MISMATCH") {
    rt.sessionId = null;
    const ok = await refreshSession(rt, generation, true);
    if (!isAlive(rt, generation)) return;
    rt.retry += 1;
    emit(rt, { connected: false, reconnecting: true });
    schedule(rt, ok ? 1_000 : backoffMs(rt.retry));
    return;
  }

  if (status === 429) {
    rt.retry += 1;
    emit(rt, { connected: false, reconnecting: true });
    // A 1s Retry-After still sits inside the server window. Retrying that soon fills the
    // window again and the browser logs a 429 on every beat. Wait out a full interval.
    schedule(rt, Math.max(intervalMs(rt), backoffMs(rt.retry, err?.retryAfter)));
    return;
  }

  if (status === 400 && (code == null || LOCATION_ERROR_CODES.has(code))) {
    rt.skipLocationOnce = true;
    if (code === "SEQUENCE_REGRESSION") {
      await refreshSession(rt, generation, true);
      if (!isAlive(rt, generation)) return;
    }
    rt.retry += 1;
    emit(rt, { connected: false, reconnecting: true });
    schedule(rt, backoffMs(Math.min(rt.retry, 2)));
    return;
  }

  rt.retry += 1;
  emit(rt, { connected: false, reconnecting: true });
  schedule(rt, backoffMs(rt.retry));
}

function schedule(rt: SharedRuntime, delayMs: number) {
  if (rt.refs <= 0) return;
  if (!cadenceFor(rt.availability).heartbeat) return;
  clearTimer(rt);
  const generation = rt.generation;
  rt.timer = window.setTimeout(() => {
    if (!isAlive(rt, generation)) return;
    void beat(rt);
  }, Math.max(250, delayMs));
  publishForensic(rt);
}

function startLoop(rt: SharedRuntime) {
  if (!cadenceFor(rt.availability).heartbeat) return;
  syncGeoWatch(rt);
  emit(rt, { reconnecting: !rt.state.connected });
  publishForensic(rt);
  if (rt.timer != null) return;
  if (rt.inFlight) return;
  // A full navigation creates a new runtime. Beating immediately on every finance page
  // exceeds the server's 6-per-10s heartbeat budget. The last successful beat is enough
  // until the interval elapses.
  const wait = intervalMs(rt) - msSinceLastBeat();
  if (wait > 250) {
    schedule(rt, wait);
    return;
  }
  rt.needsBootstrap = true;
  void beat(rt);
}

function stopLoop(rt: SharedRuntime, resetConnection: boolean) {
  rt.generation += 1;
  rt.inFlight = false;
  rt.beatCount = 0;
  rt.retry = 0;
  clearTimer(rt);
  stopGeo(rt);
  if (resetConnection) {
    emit(rt, { connected: false, reconnecting: false });
  }
}

function startFreshnessTick(rt: SharedRuntime) {
  if (rt.tick != null) return;
  rt.tick = window.setInterval(() => {
    if (rt.refs <= 0) return;
    const presence = deriveFreshness(rt.state.lastHeartbeatAt, PRESENCE_FRESH_SEC, PRESENCE_STALE_SEC);
    const location = deriveFreshness(rt.lastFix?.capturedAt ?? null, LOCATION_FRESH_SEC, LOCATION_STALE_SEC);
    if (presence !== rt.state.presenceFreshness || location !== rt.state.locationFreshness) {
      emit(rt, { presenceFreshness: presence, locationFreshness: location });
    }
  }, FRESHNESS_TICK_MS);
}

function setAvailability(rt: SharedRuntime, next: AvailabilityCadenceKey | null) {
  const prev = rt.availability;
  rt.availability = next;
  const plan = cadenceFor(next);
  if (!plan.heartbeat) {
    stopLoop(rt, true);
    return;
  }
  syncGeoWatch(rt);
  if (prev == null || !cadenceFor(prev).heartbeat || (rt.timer == null && !rt.inFlight)) {
    startLoop(rt);
  }
}

function onVisibility() {
  const rt = shared;
  if (!rt || rt.refs <= 0) return;
  if (!cadenceFor(rt.availability).heartbeat) return;
  if (readAppState() === "foreground" && !rt.state.connected) {
    clearTimer(rt);
    void beat(rt);
    return;
  }
  if (!rt.inFlight) schedule(rt, intervalMs(rt));
}

function onOnline() {
  const rt = shared;
  if (!rt || rt.refs <= 0) return;
  if (!cadenceFor(rt.availability).heartbeat) return;
  rt.retry = 0;
  clearTimer(rt);
  void beat(rt);
}

function onOffline() {
  const rt = shared;
  if (!rt || rt.refs <= 0) return;
  emit(rt, { connected: false, reconnecting: true });
}

function createRuntime(): SharedRuntime {
  return {
    refs: 0,
    generation: 0,
    timer: null,
    tick: null,
    inFlight: false,
    retry: 0,
    beatCount: 0,
    intervalSec: DEFAULT_INTERVAL_SEC,
    sessionId: null,
    deviceId: getDeviceId(),
    availability: null,
    lastFix: null,
    locationSeq: 0,
    geoWatchId: null,
    geoDenied: false,
    lastSessionRefreshAt: 0,
    skipLocationOnce: false,
    needsBootstrap: true,
    listeners: new Set(),
    state: { ...IDLE_STATE },
  };
}

function acquire(): SharedRuntime {
  if (!shared) shared = createRuntime();
  shared.refs += 1;
  if (shared.refs === 1) {
    startFreshnessTick(shared);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }
  return shared;
}

function release() {
  const rt = shared;
  if (!rt) return;
  rt.refs -= 1;
  if (rt.refs > 0) return;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  if (rt.tick != null) window.clearInterval(rt.tick);
  stopLoop(rt, true);
  shared = null;
}

function patchState(prev: SocketLikeState, next: SocketLikeState): SocketLikeState | null {
  if (
    prev.connected === next.connected &&
    prev.reconnecting === next.reconnecting &&
    prev.lastHeartbeatAt === next.lastHeartbeatAt &&
    prev.presenceFreshness === next.presenceFreshness &&
    prev.locationFreshness === next.locationFreshness
  ) {
    return null;
  }
  return next;
}

/**
 * Liveness heartbeat for dispatch eligibility. Presence is derived evidence —
 * this hook never writes availability, job, or finance state.
 *
 * Shared singleton (StrictMode-safe), same acquire/release + backoff conventions
 * as `useRealtimeChannel`. Failed beats never toast.
 */
export function usePartnerPresenceHeartbeat(): PartnerPresenceHeartbeat {
  const status = usePartnerStore((s) => s.status);
  const accessToken = usePartnerStore((s) => s.accessToken);
  const ops = usePartnerOperationsQuery();
  const authenticated = status === "authenticated" && Boolean(accessToken);
  const availability = authenticated && ops.data
    ? toCadenceKey(ops.data.availabilityState ?? ops.data.operationalStatus)
    : authenticated
      ? null
      : "OFFLINE";

  const [state, setState] = useState<SocketLikeState>(shared?.state ?? IDLE_STATE);
  const entryRef = useRef<SharedRuntime | null>(null);
  const availabilityRef = useRef(availability);
  availabilityRef.current = availability;

  useEffect(() => {
    if (!authenticated) return;
    const entry = acquire();
    entryRef.current = entry;
    setAvailability(entry, availabilityRef.current);
    const onState = (next: SocketLikeState) => {
      setState((prev) => patchState(prev, next) ?? prev);
    };
    entry.listeners.add(onState);
    onState(entry.state);
    return () => {
      entry.listeners.delete(onState);
      entryRef.current = null;
      release();
    };
  }, [authenticated]);

  useEffect(() => {
    const entry = entryRef.current ?? (authenticated ? shared : null);
    if (!entry) return;
    setAvailability(entry, availability);
  }, [authenticated, availability]);

  return authenticated ? state : IDLE_STATE;
}
