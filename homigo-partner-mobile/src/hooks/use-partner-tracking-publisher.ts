import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getApiBaseUrl } from "@/lib/api-config";
import { rememberJobFix } from "@/lib/job-fix-cache";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Publishes partner GPS to `/ws/tracking/:bookingId` while a job is live.
 *
 * Mirrors the web publisher's contract exactly — `{ type: "location_update", latitude,
 * longitude, accuracy?, altitude? }`, throttled to one fix per 5 s, duplicates skipped —
 * so the backend needs no changes and both clients feed the same pipeline.
 *
 * FOREGROUND ONLY. `expo-task-manager` is not installed and the app declares neither
 * `ACCESS_BACKGROUND_LOCATION` nor iOS "Always" permission, so background tracking is
 * not possible in this build and is not faked here: the watcher stops when the app
 * backgrounds and resumes when it returns.
 *
 * This is deliberately acceptable. GPS is corroboration now, not the producer of
 * lifecycle timestamps — `enRouteAt` and `arrivedAt` come from the partner's explicit
 * actions, so a paused watcher no longer destroys the ETA label the way it used to.
 */
export function usePartnerTrackingPublisher(opts: {
  bookingId: string | null | undefined;
  enabled?: boolean;
  minIntervalMs?: number;
}) {
  const { bookingId, enabled = true, minIntervalMs = 5_000 } = opts;
  const token = useAuthStore((s) => s.accessToken);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const lastSentAtRef = useRef(0);
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!enabled || !bookingId || !token) return;

    let cancelled = false;

    const teardown = () => {
      watcherRef.current?.remove();
      watcherRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      // A declined permission is not an error worth surfacing here — the partner can
      // still complete every lifecycle action; only corroboration is lost.
      if (status !== "granted" || cancelled) return;

      const wsBase = getApiBaseUrl().replace(/^http/, "ws");
      const ws = new WebSocket(
        `${wsBase}/ws/tracking/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(token)}`,
      );
      socketRef.current = ws;
      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      ws.onclose = () => {
        if (!cancelled) setConnected(false);
      };
      ws.onerror = () => {
        if (!cancelled) setConnected(false);
      };

      watcherRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: minIntervalMs, distanceInterval: 5 },
        (pos) => {
          const sock = socketRef.current;
          if (!sock || sock.readyState !== WebSocket.OPEN) return;

          const now = Date.now();
          if (now - lastSentAtRef.current < minIntervalMs) return;

          const { latitude, longitude, accuracy, altitude } = pos.coords;
          rememberJobFix(latitude, longitude);
          const last = lastFixRef.current;
          if (
            last &&
            Math.abs(last.lat - latitude) < 1e-6 &&
            Math.abs(last.lng - longitude) < 1e-6
          ) {
            return;
          }

          sock.send(
            JSON.stringify({
              type: "location_update",
              latitude,
              longitude,
              accuracy: accuracy ?? undefined,
              altitude: altitude ?? undefined,
            }),
          );
          lastSentAtRef.current = now;
          lastFixRef.current = { lat: latitude, lng: longitude };
        },
      );
    };

    void start();

    let bgTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener("change", (next) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = next;
      // uiautomator dumps briefly background the app — do not tear the socket down.
      if (wasActive && next !== "active") {
        bgTimer = setTimeout(() => {
          if (appStateRef.current !== "active" && !cancelled) teardown();
        }, 4_000);
      } else if (!wasActive && next === "active") {
        if (bgTimer) clearTimeout(bgTimer);
        bgTimer = null;
        if (!cancelled && !socketRef.current) void start();
      }
    });

    return () => {
      cancelled = true;
      if (bgTimer) clearTimeout(bgTimer);
      sub.remove();
      teardown();
    };
  }, [bookingId, enabled, minIntervalMs, token]);

  return { connected };
}
