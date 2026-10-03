import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Location from "expo-location";
import { classifyLocation, type PartnerLocationState, STALE_LOCATION_MS } from "@/lib/partner-map";
import { mapPermissionCall, type MapLocationTrigger } from "@/lib/map-location-permission";

/**
 * Foreground-only partner location for the map screen.
 *
 * Deliberately NOT the tracking publisher (`use-partner-tracking-publisher.ts`): that one exists to
 * push GPS to `/ws/tracking/:bookingId` for a live job. This one only reads a fix to centre the map
 * and never transmits anything, so viewing the map has no server side effects at all.
 *
 * Watching stops whenever the screen is inactive (`active` = false) or the app backgrounds — the
 * brief's "do not continuously request GPS when screen is inactive" requirement. Updates are
 * throttled by distance and interval so map re-renders stay bounded.
 */
export function usePartnerMapLocation(active: boolean): {
  state: PartnerLocationState;
  refresh: () => void;
} {
  const [state, setState] = useState<PartnerLocationState>({ kind: "loading" });
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Per effect run: the permission prompt itself backgrounds the app, so a start in flight is not doubled.
    let starting = false;

    const teardown = () => {
      watcherRef.current?.remove();
      watcherRef.current = null;
    };

    const start = async (trigger: MapLocationTrigger) => {
      if (!active || starting) return;
      starting = true;
      try {
        const { status } =
          mapPermissionCall(trigger) === "request"
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          setState({ kind: "permission_denied" });
          return;
        }

        // Seed immediately from the last known fix so the map can render something while the
        // first live fix resolves — classified honestly (it may already be stale).
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (!cancelled && last) {
          setState(
            classifyLocation(
              { latitude: last.coords.latitude, longitude: last.coords.longitude },
              last.timestamp,
            ),
          );
        }

        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 10_000,
            distanceInterval: 25,
            // A map watch the partner did not ask for: never raise the settings dialog (X-62).
            mayShowUserSettingsDialog: false,
          },
          (pos) => {
            if (cancelled) return;
            setState(
              classifyLocation(
                { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
                pos.timestamp,
              ),
            );
          },
        );
        if (cancelled) {
          sub.remove();
          return;
        }
        teardown();
        watcherRef.current = sub;
      } catch {
        if (!cancelled) setState({ kind: "unavailable" });
      } finally {
        starting = false;
      }
    };

    void start(refreshTick === 0 ? "mount" : "retry");

    const appSub = AppState.addEventListener("change", (next) => {
      const wasActive = appStateRef.current === "active";
      appStateRef.current = next;
      if (wasActive && next !== "active") teardown();
      // Only CHECK here: requesting would show the prompt, which backgrounds the app again (X-75).
      if (!wasActive && next === "active" && active) void start("resume");
    });

    return () => {
      cancelled = true;
      teardown();
      appSub.remove();
    };
  }, [active, refreshTick]);

  // A fix that was live when received becomes stale purely by the passage of time — re-classify
  // on a timer so the UI never keeps showing a minutes-old position labelled "live".
  useEffect(() => {
    if (state.kind !== "live") return;
    const timer = setTimeout(() => {
      setState((prev) =>
        prev.kind === "live" ? classifyLocation(prev.coords, prev.at) : prev,
      );
    }, STALE_LOCATION_MS + 1_000);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, refresh };
}
