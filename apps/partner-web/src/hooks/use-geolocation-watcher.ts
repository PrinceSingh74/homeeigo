"use client";

import { useEffect, useState } from "react";

export type GeoCoords = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
};

type Options = {
  enabled?: boolean;
  enableHighAccuracy?: boolean;
  /**
   * Minimum movement in meters before publishing a new coord — helps the
   * downstream tracking publisher avoid no-op updates from GPS noise.
   */
  minMoveMeters?: number;
};

function haversine(a: GeoCoords, b: GeoCoords): number {
  const R = 6371_000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Long-running geolocation watcher. Returns the latest fix or null until
 * the first sample arrives. The hook handles permission denial, missing
 * APIs (SSR) and the no-movement filter — consumers stay simple.
 */
export function useGeolocationWatcher({
  enabled = true,
  enableHighAccuracy = true,
  minMoveMeters = 8,
}: Options = {}): GeoCoords | null {
  const [coords, setCoords] = useState<GeoCoords | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let lastFix: GeoCoords | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next: GeoCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude ?? undefined,
        };
        if (lastFix && haversine(lastFix, next) < minMoveMeters) return;
        lastFix = next;
        setCoords(next);
      },
      () => {
        // permission denied / position unavailable — leave state as-is
      },
      {
        enableHighAccuracy,
        maximumAge: 5_000,
        timeout: 15_000,
      },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, enableHighAccuracy, minMoveMeters]);

  return coords;
}
