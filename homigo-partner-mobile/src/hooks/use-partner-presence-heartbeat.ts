import Constants from "expo-constants";
import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { getDeviceId } from "@/lib/device";
import {
  applyPresenceSnapshot,
  nextLocationSequence,
  presenceSession,
  resetPresenceSession,
} from "@/lib/presence-session";
import {
  PartnerApiError,
  partnerApi,
  type PresenceFreshness,
  type PresenceLocationFix,
  type PresenceSnapshot,
} from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import type { PartnerOperations } from "@/types/partner";

/**
 * AVAILABILITY-axis tokens only. Presence is liveness evidence derived from
 * timestamps — never a fifth FSM, never written back into availability, and
 * never treated as lifecycle SUSPENDED.
 */
export const AVAILABILITY_STATES = [
  "OFFLINE",
  "AVAILABLE",
  "OFFERED",
  "ACCEPTING",
  "EN_ROUTE",
  "ON_JOB",
  "PAUSED",
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

type Cadence = {
  heartbeat: boolean;
  /** null = never attach GPS; 1 = every beat; 3 = every 3rd beat. */
  locationEveryN: number | null;
};

export const PRESENCE_CADENCE: Record<AvailabilityState, Cadence> = {
  OFFLINE: { heartbeat: false, locationEveryN: null },
  AVAILABLE: { heartbeat: true, locationEveryN: 3 },
  OFFERED: { heartbeat: true, locationEveryN: 1 },
  ACCEPTING: { heartbeat: true, locationEveryN: 1 },
  EN_ROUTE: { heartbeat: true, locationEveryN: 1 },
  ON_JOB: { heartbeat: true, locationEveryN: 1 },
  PAUSED: { heartbeat: true, locationEveryN: null },
};

const PRESENCE_FRESH_SEC = 30;
const PRESENCE_STALE_SEC = 60;
const LOCATION_FRESH_SEC = 60;
const LOCATION_STALE_SEC = 600;
const MAX_BACKOFF_MS = 60_000;
const SNAPSHOT_REFRESH_MIN_MS = 8_000;
const LOCATION_FIX_TIMEOUT_MS = 8_000;
const BACKGROUND_INTERVAL_MULT = 2;

const FROM_OPERATIONAL: Record<string, AvailabilityState> = {
  offline: "OFFLINE",
  available: "AVAILABLE",
  offered: "OFFERED",
  accepting: "ACCEPTING",
  accepting_job: "ACCEPTING",
  en_route: "EN_ROUTE",
  on_job: "ON_JOB",
  paused: "PAUSED",
};

export type PartnerPresenceHealth = {
  connected: boolean;
  lastHeartbeatAt: Date | null;
  presenceFreshness: PresenceFreshness | null;
  locationFreshness: PresenceFreshness | null;
  reconnecting: boolean;
};

const idleHealth = (): PartnerPresenceHealth => ({
  connected: false,
  lastHeartbeatAt: null,
  presenceFreshness: null,
  locationFreshness: null,
  reconnecting: false,
});

export const usePartnerPresenceStore = create<PartnerPresenceHealth>(idleHealth);

/** Shared with the background location task — one sequence counter per runtime. */
const session = presenceSession;
const resetSessionCache = resetPresenceSession;

export function resolveAvailability(ops: PartnerOperations | undefined): AvailabilityState {
  const raw = ops?.availabilityState?.trim().toUpperCase();
  if (raw && (AVAILABILITY_STATES as readonly string[]).includes(raw)) {
    return raw as AvailabilityState;
  }
  const stored = ops?.operationalStatus?.trim().toLowerCase();
  if (stored && stored in FROM_OPERATIONAL) return FROM_OPERATIONAL[stored];
  if (ops?.isPaused) return "PAUSED";
  if (ops?.isOnline) return "AVAILABLE";
  return "OFFLINE";
}

function freshnessFrom(at: Date | null, now: number, freshSec: number, staleSec: number): PresenceFreshness | null {
  if (!at) return null;
  const age = (now - at.getTime()) / 1000;
  if (age <= freshSec) return "FRESH";
  if (age <= staleSec) return "STALE";
  return "EXPIRED";
}

function applySnapshot(snap: PresenceSnapshot) {
  applyPresenceSnapshot(snap);
}

function mapAppState(status: AppStateStatus): "foreground" | "background" | "inactive" {
  if (status === "active") return "foreground";
  if (status === "background") return "background";
  return "inactive";
}

function mapPlatform(): "ios" | "android" | "web" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web";
}

function nextBackoff(current: number, floorMs: number): number {
  if (current <= 0) return Math.min(MAX_BACKOFF_MS, floorMs * 2);
  return Math.min(MAX_BACKOFF_MS, current * 2);
}

function isSessionInvalid(err: PartnerApiError): boolean {
  return (
    err.code === "STALE_SESSION" ||
    err.code === "INVALID_SESSION" ||
    err.code === "DEVICE_MISMATCH" ||
    err.status === 401
  );
}

export function partnerPresenceHealthCopy(input: {
  receiveJobs: boolean;
  connected: boolean;
  reconnecting: boolean;
  presenceFreshness: PresenceFreshness | null;
}): { text: string; tone: "ok" | "warn" } | null {
  if (input.reconnecting) {
    return { text: "Connection lost — reconnecting…", tone: "warn" };
  }
  if (!input.receiveJobs) return null;
  if (input.presenceFreshness === "STALE" || input.presenceFreshness === "EXPIRED") {
    return { text: "You're currently not receiving new jobs", tone: "warn" };
  }
  if (input.connected && input.presenceFreshness === "FRESH") {
    return { text: "You're visible for new jobs", tone: "ok" };
  }
  return null;
}

export function usePartnerPresenceHealth(): PartnerPresenceHealth {
  return usePartnerPresenceStore();
}

/**
 * Global partner presence runtime. Mount once at the app root — a second mount
 * would double-beat and trip the server rate limit.
 */
export function usePartnerPresenceHeartbeat(): PartnerPresenceHealth {
  const isAuthenticated = useAuthStore((s) => s.hydrated && !!s.user && !!s.accessToken);
  const queryClient = useQueryClient();
  const ops = useQuery({
    queryKey: ["partner", "operations"],
    queryFn: () => partnerApi.operations(),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? 15_000 : false,
  });
  const availability = resolveAvailability(ops.data);
  const shouldBeat = PRESENCE_CADENCE[availability].heartbeat;

  useEffect(() => {
    if (!isAuthenticated) {
      resetSessionCache();
      usePartnerPresenceStore.setState(idleHealth());
      return;
    }
    if (!shouldBeat) {
      usePartnerPresenceStore.setState({ connected: false, reconnecting: false });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ageTimer: ReturnType<typeof setInterval> | null = null;
    let beatCount = 0;
    let backoffMs = 0;
    let permissionDenied = false;
    let lastLocationAt: Date | null = null;
    const appStateRef = { current: AppState.currentState };

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const intervalMs = () => {
      const base = Math.max(1, session.heartbeatIntervalSeconds) * 1000;
      const background = appStateRef.current !== "active";
      return background ? base * BACKGROUND_INTERVAL_MULT : base;
    };

    const schedule = (delay: number) => {
      clearTimer();
      if (cancelled) return;
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };

    const markLost = () => {
      usePartnerPresenceStore.setState({ connected: false, reconnecting: true });
    };

    const refreshSnapshot = async (force: boolean) => {
      if (session.refreshInFlight) {
        await session.refreshInFlight;
        return;
      }
      if (!force && Date.now() - session.lastSnapshotAt < SNAPSHOT_REFRESH_MIN_MS && session.sessionId) {
        return;
      }
      const pending = (async () => {
        const snap = await partnerApi.presenceSnapshot();
        session.lastSnapshotAt = Date.now();
        applySnapshot(snap);
        if (snap.lastHeartbeatAt) {
          const at = new Date(snap.lastHeartbeatAt);
          lastLocationAt = snap.location?.capturedAt ? new Date(snap.location.capturedAt) : lastLocationAt;
          usePartnerPresenceStore.setState({
            lastHeartbeatAt: at,
            presenceFreshness: snap.presenceFreshness,
            locationFreshness: snap.locationFreshness,
          });
        }
      })();
      session.refreshInFlight = pending;
      try {
        await pending;
      } finally {
        if (session.refreshInFlight === pending) session.refreshInFlight = null;
      }
    };

    const ensureSession = async () => {
      if (session.sessionId && session.deviceId) return;
      await refreshSnapshot(true);
      if (!session.deviceId) session.deviceId = await getDeviceId();
    };

    const captureFix = async (): Promise<PresenceLocationFix | undefined> => {
      if (permissionDenied) return undefined;
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        let status = existing.status;
        if (status !== "granted") {
          const asked = await Location.requestForegroundPermissionsAsync();
          status = asked.status;
        }
        if (status !== "granted") {
          permissionDenied = true;
          return undefined;
        }
        const pos = await Promise.race([
          // Background heartbeat: never raise Android's location-settings dialog (X-62).
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_FIX_TIMEOUT_MS)),
        ]);
        if (!pos) return undefined;
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
        const sequence = nextLocationSequence();
        lastLocationAt = new Date(pos.timestamp);
        return {
          latitude,
          longitude,
          ...(typeof accuracy === "number" && accuracy >= 0 ? { accuracy } : {}),
          capturedAt: lastLocationAt.toISOString(),
          sequence,
        };
      } catch {
        return undefined;
      }
    };

    const tick = async () => {
      if (cancelled) return;

      let latestOps = queryClient.getQueryData<PartnerOperations>(["partner", "operations"]);
      try {
        latestOps = await queryClient.fetchQuery({
          queryKey: ["partner", "operations"],
          queryFn: () => partnerApi.operations(),
          staleTime: 5_000,
        });
      } catch {
        // Cached ops still gate the beat; missing ops retries rather than dying.
      }
      if (cancelled) return;

      if (!latestOps) {
        markLost();
        backoffMs = nextBackoff(backoffMs, intervalMs());
        schedule(backoffMs);
        return;
      }

      const liveAvailability = resolveAvailability(latestOps);
      const plan = PRESENCE_CADENCE[liveAvailability];
      if (!plan.heartbeat) {
        usePartnerPresenceStore.setState({ connected: false, reconnecting: false });
        return;
      }

      try {
        await ensureSession();
        if (cancelled) return;
        if (!session.sessionId || !session.deviceId) {
          markLost();
          backoffMs = nextBackoff(backoffMs, intervalMs());
          schedule(backoffMs);
          return;
        }

        const wantLocation = plan.locationEveryN != null && beatCount % plan.locationEveryN === 0;
        beatCount += 1;
        const location = wantLocation ? await captureFix() : undefined;
        if (cancelled) return;

        const result = await partnerApi.presenceHeartbeat({
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          timestamp: new Date().toISOString(),
          appState: mapAppState(appStateRef.current),
          platform: mapPlatform(),
          appVersion: Constants.expoConfig?.version ?? undefined,
          availabilityTelemetry: liveAvailability,
          ...(location ? { location } : {}),
        });

        backoffMs = 0;
        applySnapshot(result.snapshot);
        const beatAt = result.snapshot.lastHeartbeatAt
          ? new Date(result.snapshot.lastHeartbeatAt)
          : new Date();
        if (result.snapshot.location?.capturedAt) {
          lastLocationAt = new Date(result.snapshot.location.capturedAt);
        }
        usePartnerPresenceStore.setState({
          connected: true,
          reconnecting: false,
          lastHeartbeatAt: beatAt,
          presenceFreshness: result.snapshot.presenceFreshness,
          locationFreshness: result.snapshot.locationFreshness,
        });
        schedule(intervalMs());
      } catch (err) {
        if (cancelled) return;
        markLost();
        if (err instanceof PartnerApiError) {
          if (isSessionInvalid(err)) {
            session.sessionId = null;
            if (err.code === "DEVICE_MISMATCH") session.deviceId = null;
            try {
              await refreshSnapshot(true);
            } catch {
              // Snapshot refresh failed — back off rather than tight-loop.
            }
            backoffMs = nextBackoff(backoffMs, intervalMs());
            schedule(Math.max(backoffMs, SNAPSHOT_REFRESH_MIN_MS));
            return;
          }
          if (err.status === 429) {
            const waitMs = (err.retryAfter ?? 10) * 1000;
            schedule(Math.max(waitMs, intervalMs()));
            return;
          }
        }
        backoffMs = nextBackoff(backoffMs, intervalMs());
        schedule(backoffMs);
      }
    };

    const appSub = AppState.addEventListener("change", (next) => {
      appStateRef.current = next;
    });

    ageTimer = setInterval(() => {
      const now = Date.now();
      const last = usePartnerPresenceStore.getState().lastHeartbeatAt;
      const presenceFreshness = freshnessFrom(last, now, PRESENCE_FRESH_SEC, PRESENCE_STALE_SEC);
      const locationFreshness = freshnessFrom(lastLocationAt, now, LOCATION_FRESH_SEC, LOCATION_STALE_SEC);
      const cur = usePartnerPresenceStore.getState();
      if (cur.presenceFreshness !== presenceFreshness || cur.locationFreshness !== locationFreshness) {
        usePartnerPresenceStore.setState({ presenceFreshness, locationFreshness });
      }
    }, 5_000);

    void tick();

    return () => {
      cancelled = true;
      clearTimer();
      if (ageTimer) clearInterval(ageTimer);
      appSub.remove();
    };
  }, [isAuthenticated, shouldBeat, queryClient]);

  return usePartnerPresenceStore();
}
