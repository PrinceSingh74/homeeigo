import * as Location from "expo-location";
import { AppState } from "react-native";
import { getApiBaseUrl } from "@/lib/api-config";
import { rememberJobFix } from "@/lib/job-fix-cache";
import { createTrackingPublisherRegistry, type TrackingSocket } from "@/lib/tracking-publisher-registry";
import { quietSubscription } from "@/lib/safe-subscription";
import { mockedField } from "@/lib/location-mocked";

/**
 * The app's one tracking-publisher registry (X-76), wired to the real platform: a WebSocket per
 * (session, booking), one foreground GPS watcher per publisher, and a single AppState subscription
 * for the whole app instead of one per screen.
 *
 * FOREGROUND ONLY. Publishers stop shortly after the app backgrounds and resume when it returns.
 * Background job tracking is a separate path (src/lib/background-location.ts: expo-task-manager task →
 * `POST /api/tracking/location`) that never runs while the app is in the foreground.
 * Message contract (unchanged, same as partner web): `{ type: "location_update", latitude,
 * longitude, accuracy?, altitude? }`, at most one fix per interval, identical fixes skipped. The
 * server decides what a ping may change (X-59 travel window).
 */
export const trackingPublisherRegistry = createTrackingPublisherRegistry({
  wsBase: () => getApiBaseUrl().replace(/^http/, "ws"),
  checkPermission: async () => (await Location.getForegroundPermissionsAsync()).status,
  requestPermission: async () => (await Location.requestForegroundPermissionsAsync()).status,
  openSocket: (url) => {
    const ws = new WebSocket(url);
    const socket: TrackingSocket = {
      get isOpen() {
        return ws.readyState === WebSocket.OPEN;
      },
      send: (message) => ws.send(message),
      close: () => ws.close(),
      onopen: null,
      onclose: null,
      onerror: null,
    };
    ws.onopen = () => socket.onopen?.();
    ws.onclose = () => socket.onclose?.();
    ws.onerror = () => socket.onerror?.();
    return socket;
  },
  watchPosition: (intervalMs, onFix) =>
    Location.watchPositionAsync(
      // Started by opening a job, not by a tap: never raise the location-settings dialog (X-62).
      { accuracy: Location.Accuracy.Highest, timeInterval: intervalMs, distanceInterval: 5, mayShowUserSettingsDialog: false },
      (pos) => onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? undefined, pos.coords.altitude ?? undefined, mockedField(pos).mocked),
      // The registry stops this watch when a job leaves its active stage; a stop that throws must not take the job screen down.
    ).then(quietSubscription),
  onFix: rememberJobFix,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

AppState.addEventListener("change", (next) => trackingPublisherRegistry.setForeground(next === "active"));
