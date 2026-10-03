import { useEffect, useState } from "react";
import * as Location from "expo-location";

export type DeviceCoordinates = {
  latitude: number;
  longitude: number;
};

export type DeviceLocationStatus = "pending" | "granted" | "denied" | "unavailable";

let cachedCoords: DeviceCoordinates | null = null;

/**
 * Request device location once and cache it for provider matching/search.
 *
 * No fabricated fallback: without a real fix `coords` is null and `status` says why. This used to
 * return Gurugram (28.4595, 77.0266) whenever permission was denied or GPS failed, so "providers
 * near you" silently listed partners near Gurugram with made-up distances and ETAs.
 */
export function useDeviceCoordinates() {
  const [coords, setCoords] = useState<DeviceCoordinates | null>(cachedCoords);
  const [status, setStatus] = useState<DeviceLocationStatus>(cachedCoords ? "granted" : "pending");

  useEffect(() => {
    if (cachedCoords) return;
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!cancelled) setStatus("denied");
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const next = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        cachedCoords = next;
        if (!cancelled) {
          setCoords(next);
          setStatus("granted");
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { coords, status, ready: status !== "pending" };
}

/** The last real fix this session, or null — never a default city. */
export function getCachedDeviceCoordinates(): DeviceCoordinates | null {
  return cachedCoords;
}
