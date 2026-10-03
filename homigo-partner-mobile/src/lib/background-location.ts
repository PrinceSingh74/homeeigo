import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { getDeviceId } from "@/lib/device";
import { classifyPingError, createPingQueue, type QueuedFix, type SendVerdict } from "@/lib/location-ping-queue";
import { rememberJobFix } from "@/lib/job-fix-cache";
import { applyPresenceSnapshot, nextLocationSequence, presenceSession } from "@/lib/presence-session";
import { deleteSecureItem, getSecureItem, setSecureItem } from "@/lib/secure-storage";
import { loadTaskManager } from "@/lib/task-manager";
import { PartnerApiError, partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Background location for partners who are online or on an active job.
 *
 * ── What this does ───────────────────────────────────────────────────────────
 * Registers an expo-task-manager task fed by `Location.startLocationUpdatesAsync`:
 *  - Android: runs as a foreground service with a persistent notification (required by the OS for
 *    background location; the partner can always see that location is being shared).
 *  - iOS: "Always" authorization + `UIBackgroundModes: location` (app.json → expo-location plugin),
 *    with the blue status-bar indicator on.
 * Each delivered fix is sent to the endpoints the backend already accepts:
 *  - `POST /api/providers/me/location/ping` (presence GPS; shares the one `sequence` counter with
 *    the foreground heartbeat so the server's out-of-order guard holds). Queued while offline and
 *    flushed oldest-first; fixes older than the server's 300 s bound are discarded, not replayed.
 *  - `POST /api/tracking/location` for the active job — freshest fix only (the endpoint has no
 *    timestamp, so a replayed fix would be shown to the customer as the current position).
 * While the app is in the FOREGROUND the task sends nothing: the heartbeat hook and the
 * `/ws/tracking` publisher already cover that, and doubling up would trip the presence rate limit.
 *
 * ── What this does NOT guarantee (read before promising anything to ops) ────
 *  - Continuous tracking is NOT guaranteed. The OS decides delivery: Android Doze / OEM battery
 *    managers (Xiaomi, Oppo, Vivo, Samsung "sleeping apps") can delay or kill the service; iOS
 *    batches and throttles background updates and may stop them under memory pressure.
 *  - If the partner swipes the app away, updates stop (`killServiceOnDestroy: true` on Android;
 *    iOS does not relaunch for standard location updates). Presence then goes stale — which is the
 *    correct signal to dispatch.
 *  - If "Allow all the time" / "Always" is denied, only foreground tracking exists; the UI tells the
 *    partner they will go stale in the background (`useBackgroundLocationStatus`).
 *  - Requires a native build containing expo-task-manager (not Expo Go, not an older dev build).
 */

export const BACKGROUND_LOCATION_TASK = "homeeigo-partner-background-location";

const CONTEXT_KEY = "homeeigo-partner-bg-location-context";

export type BackgroundMode = "idle" | "active_job";

type BgContext = { mode: BackgroundMode; bookingId: string | null };

export type BackgroundPermission = "granted" | "denied" | "undetermined" | "unavailable";

export type BackgroundLocationStatus = {
  permission: BackgroundPermission;
  running: boolean;
  mode: BackgroundMode | null;
  /** Last error starting updates (e.g. native module missing in this build). */
  error: string | null;
};

export const useBackgroundLocationStatus = create<BackgroundLocationStatus>(() => ({
  permission: "undetermined",
  running: false,
  mode: null,
  error: null,
}));

/** Minimum spacing between presence writes from this task (server: 6 writes / 10 s shared). */
const PRESENCE_MIN_GAP_MS: Record<BackgroundMode, number> = { idle: 30_000, active_job: 10_000 };
const TRACKING_MIN_GAP_MS = 5_000;
/** A tracking fix older than this is not "live" and is not sent to the customer view. */
const TRACKING_MAX_FIX_AGE_MS = 30_000;

let context: BgContext | null = null;
let lastPresenceSendAt = 0;
let lastTrackingSendAt = 0;
const queue = createPingQueue({ maxSize: 50, maxPerFlush: 3 });

async function loadContext(): Promise<BgContext | null> {
  if (context) return context;
  try {
    const raw = await getSecureItem(CONTEXT_KEY);
    if (raw) context = JSON.parse(raw) as BgContext;
  } catch {
    context = null;
  }
  return context;
}

async function saveContext(next: BgContext | null) {
  context = next;
  try {
    if (next) await setSecureItem(CONTEXT_KEY, JSON.stringify(next));
    else await deleteSecureItem(CONTEXT_KEY);
  } catch {
    /* in-memory copy still applies for this runtime */
  }
}

/** A headless start (Android) begins with an empty store — load credentials from SecureStore. */
async function ensureAuthLoaded(): Promise<boolean> {
  if (!useAuthStore.persist.hasHydrated()) {
    try {
      await useAuthStore.persist.rehydrate();
    } catch {
      return false;
    }
  }
  return !!useAuthStore.getState().accessToken;
}

/** Session + sequence must be known BEFORE fixes are numbered, or a fresh runtime would regress. */
async function ensurePresenceSession(): Promise<boolean> {
  if (presenceSession.sessionId && presenceSession.deviceId) return true;
  try {
    const snap = await partnerApi.presenceSnapshot();
    presenceSession.lastSnapshotAt = Date.now();
    applyPresenceSnapshot(snap);
  } catch {
    return false;
  }
  if (!presenceSession.deviceId) presenceSession.deviceId = await getDeviceId();
  return !!presenceSession.sessionId && !!presenceSession.deviceId;
}

async function sendPing(fix: QueuedFix): Promise<SendVerdict> {
  if (!presenceSession.sessionId || !presenceSession.deviceId) return "retry";
  try {
    const result = await partnerApi.locationPing({
      sessionId: presenceSession.sessionId,
      deviceId: presenceSession.deviceId,
      location: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        ...(typeof fix.accuracy === "number" ? { accuracy: fix.accuracy } : {}),
        capturedAt: fix.capturedAt,
        sequence: fix.sequence,
      },
    });
    applyPresenceSnapshot(result.snapshot);
    return "sent";
  } catch (err) {
    if (err instanceof PartnerApiError) {
      if (err.code === "INVALID_SESSION" || err.code === "STALE_SESSION" || err.code === "DEVICE_MISMATCH") {
        // Repair on the next delivery; the fix stays queued (it may still be young enough).
        presenceSession.sessionId = null;
        if (err.code === "DEVICE_MISMATCH") presenceSession.deviceId = null;
      }
      return classifyPingError(err.status, err.code);
    }
    return "retry";
  }
}

async function sendTracking(bookingId: string, loc: Location.LocationObject) {
  const now = Date.now();
  if (now - lastTrackingSendAt < TRACKING_MIN_GAP_MS) return;
  if (now - loc.timestamp > TRACKING_MAX_FIX_AGE_MS) return;
  lastTrackingSendAt = now;
  const { latitude, longitude, accuracy, altitude, speed } = loc.coords;
  try {
    await partnerApi.trackingLocation({
      bookingId,
      latitude,
      longitude,
      ...(typeof accuracy === "number" && accuracy >= 0 ? { accuracy } : {}),
      ...(typeof altitude === "number" ? { altitude } : {}),
      ...(typeof speed === "number" && speed >= 0 ? { speed } : {}),
    });
  } catch (err) {
    if (err instanceof PartnerApiError && err.code === "INVALID_STATUS") {
      // The job is no longer live (completed / cancelled / reassigned): stop feeding its tracking.
      await saveContext({ mode: "idle", bookingId: null });
    }
  }
}

async function handleLocations(locations: Location.LocationObject[]) {
  if (!locations.length) return;
  // Foreground: the heartbeat hook + /ws/tracking publisher own GPS. Only record the job fix.
  const last = locations[locations.length - 1];
  // Only a fresh fix may back lifecycle CTAs (arrive/start check distance) — batches can be old.
  if (last && Date.now() - last.timestamp <= TRACKING_MAX_FIX_AGE_MS) {
    rememberJobFix(last.coords.latitude, last.coords.longitude);
  }
  if (AppState.currentState === "active") return;

  if (!(await ensureAuthLoaded())) {
    // Signed out while updates were registered (e.g. killed mid-logout): stop, never send anonymously.
    await stopBackgroundLocation();
    return;
  }
  const ctx = (await loadContext()) ?? { mode: "idle" as const, bookingId: null };

  if (ctx.mode === "active_job" && ctx.bookingId && last) {
    await sendTracking(ctx.bookingId, last);
  }

  const now = Date.now();
  if (!(await ensurePresenceSession())) {
    // No session yet (offline, or server unreachable). Numbering fixes now could regress against
    // the server's sequence once it is known, so these fixes are not queued. Honest gap > wrong order.
    return;
  }

  const ordered = [...locations].sort((a, b) => a.timestamp - b.timestamp);
  for (const loc of ordered) {
    const { latitude, longitude, accuracy } = loc.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    queue.enqueue({
      latitude,
      longitude,
      ...(typeof accuracy === "number" && accuracy >= 0 ? { accuracy } : {}),
      capturedAt: new Date(loc.timestamp).toISOString(),
      sequence: nextLocationSequence(),
    });
  }

  // Throttled: fixes stay queued (in order) and go out with the next allowed flush.
  if (now - lastPresenceSendAt < PRESENCE_MIN_GAP_MS[ctx.mode]) return;
  lastPresenceSendAt = now;
  await queue.flush(sendPing);
}

/*
 * The task MUST be defined at module scope, before React renders, so an OS-initiated (headless)
 * start finds it. app/_layout.tsx imports this module at the top for that reason.
 */
const TaskManager = loadTaskManager();
if (TaskManager) {
  try {
    if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
        BACKGROUND_LOCATION_TASK,
        async ({ data, error }) => {
          if (error || !data?.locations) return;
          try {
            await handleLocations(data.locations);
          } catch {
            /* never throw out of a task — the OS may stop delivering */
          }
        },
      );
    }
  } catch {
    useBackgroundLocationStatus.setState({ permission: "unavailable" });
  }
} else {
  // Expo Go / web / a binary built before expo-task-manager was added: foreground-only.
  useBackgroundLocationStatus.setState({ permission: "unavailable" });
}

function taskOptions(mode: BackgroundMode): Location.LocationTaskOptions {
  const activeJob = mode === "active_job";
  return {
    // Battery: balanced + 100 m while waiting for work; high accuracy + 20 m on a live job.
    accuracy: activeJob ? Location.Accuracy.High : Location.Accuracy.Balanced,
    distanceInterval: activeJob ? 20 : 100,
    timeInterval: activeJob ? 10_000 : 60_000, // Android only; iOS ignores it
    deferredUpdatesInterval: activeJob ? 10_000 : 60_000,
    // Pausing would stop iOS updates until the app is foregrounded again — never silently.
    pausesUpdatesAutomatically: false,
    activityType: activeJob ? Location.ActivityType.AutomotiveNavigation : Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "HOMEEIGO Partner is using your location",
      notificationBody: activeJob
        ? "Sharing your live location for your active job."
        : "You're online — sharing location so nearby jobs can reach you. Go offline to stop.",
      notificationColor: "#3d6b4f",
      killServiceOnDestroy: true,
    },
  };
}

async function backgroundSupported(): Promise<boolean> {
  if (Platform.OS === "web" || !TaskManager || !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) return false;
  try {
    const [tm, bg] = await Promise.all([
      TaskManager.isAvailableAsync(),
      Location.isBackgroundLocationAvailableAsync(),
    ]);
    return tm && bg;
  } catch {
    return false;
  }
}

/** Read permission without prompting. */
export async function refreshBackgroundPermission(): Promise<BackgroundPermission> {
  if (!(await backgroundSupported())) {
    useBackgroundLocationStatus.setState({ permission: "unavailable" });
    return "unavailable";
  }
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    const permission: BackgroundPermission = bg.granted ? "granted" : bg.canAskAgain ? "undetermined" : "denied";
    useBackgroundLocationStatus.setState({ permission });
    return permission;
  } catch {
    useBackgroundLocationStatus.setState({ permission: "unavailable" });
    return "unavailable";
  }
}

/**
 * Ask for foreground, then background permission. Call ONLY from a user action after showing the
 * rationale (Android 11+ sends the user to Settings for "Allow all the time"; asking cold is refused
 * by Play policy and confuses partners).
 */
export async function requestBackgroundLocationPermission(): Promise<BackgroundPermission> {
  if (!(await backgroundSupported())) {
    useBackgroundLocationStatus.setState({ permission: "unavailable" });
    return "unavailable";
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    useBackgroundLocationStatus.setState({ permission: "denied" });
    return "denied";
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  const permission: BackgroundPermission = bg.granted ? "granted" : "denied";
  useBackgroundLocationStatus.setState({ permission });
  return permission;
}

/**
 * Start (or retune) background updates. No-op unless background permission is already granted —
 * this never prompts. Calling again with a different mode restarts with the new options.
 */
export async function startBackgroundLocation(mode: BackgroundMode, bookingId: string | null): Promise<boolean> {
  const permission = await refreshBackgroundPermission();
  if (permission !== "granted") {
    useBackgroundLocationStatus.setState({ running: false, mode: null });
    return false;
  }
  await saveContext({ mode, bookingId: mode === "active_job" ? bookingId : null });
  try {
    const current = useBackgroundLocationStatus.getState();
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!started || current.mode !== mode) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, taskOptions(mode));
    }
    useBackgroundLocationStatus.setState({ running: true, mode, error: null });
    return true;
  } catch (err) {
    useBackgroundLocationStatus.setState({
      running: false,
      mode: null,
      error: err instanceof Error ? err.message : "Could not start background location",
    });
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  queue.clear();
  lastPresenceSendAt = 0;
  lastTrackingSendAt = 0;
  await saveContext(null);
  if (TaskManager) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch {
      /* task not registered in this build */
    }
  }
  useBackgroundLocationStatus.setState({ running: false, mode: null });
}
