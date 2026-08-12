import { useEffect, useState } from "react";
import * as Location from "expo-location";

export type DeviceCoordinates = {
  latitude: number;
  longitude: number;
};

const DEFAULT_COORDS: DeviceCoordinates = {
  latitude: 28.4595,
  longitude: 77.0266,
};

let cachedCoords: DeviceCoordinates | null = null;

/** Request device location once and cache for provider matching/search. */
export function useDeviceCoordinates() {
  const [coords, setCoords] = useState<DeviceCoordinates>(cachedCoords ?? DEFAULT_COORDS);
  const [ready, setReady] = useState(cachedCoords != null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!cancelled) setReady(true);
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
          setReady(true);
        }
      } catch {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { coords, ready };
}

export function getCachedDeviceCoordinates(): DeviceCoordinates {
  return cachedCoords ?? DEFAULT_COORDS;
}
