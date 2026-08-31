import * as Location from "expo-location";
import { getE2eGeoOverride } from "@/lib/e2e-geo";
import { readRememberedJobFix, rememberJobFix } from "@/lib/job-fix-cache";

export type JobCoords = {
  latitude: number;
  longitude: number;
  warning?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

function isNullIsland(lat: number, lng: number): boolean {
  return lat === 0 && lng === 0;
}

/**
 * Soft GPS for en-route (may fall back); strict for arrive/start (never 0,0).
 * Prefers the live tracking publisher cache, then last-known, then a short watch.
 */
export async function getJobCoords(mode: "soft" | "strict" = "soft"): Promise<JobCoords> {
  const e2e = getE2eGeoOverride();
  if (e2e) {
    rememberJobFix(e2e.latitude, e2e.longitude);
    return e2e;
  }

  const cached = readRememberedJobFix(mode === "strict" ? 120_000 : 60_000);
  if (cached) return cached;

  try {
    const { status } = await withTimeout(
      Location.requestForegroundPermissionsAsync(),
      8_000,
      "Location permission",
    );
    if (status !== "granted") {
      if (mode === "strict") {
        throw new Error("Location permission is required. Enable GPS and move closer to the job.");
      }
      return {
        latitude: 0,
        longitude: 0,
        warning: "Location permission denied — using fallback coords.",
      };
    }

    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last && !isNullIsland(last.coords.latitude, last.coords.longitude)) {
      rememberJobFix(last.coords.latitude, last.coords.longitude);
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }

    const watched = await new Promise<Location.LocationObject | null>((resolve) => {
      let sub: Location.LocationSubscription | null = null;
      const timer = setTimeout(() => {
        sub?.remove();
        resolve(null);
      }, mode === "strict" ? 14_000 : 6_000);
      void Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 250,
          distanceInterval: 0,
          mayShowUserSettingsDialog: false,
        },
        (pos) => {
          if (isNullIsland(pos.coords.latitude, pos.coords.longitude)) return;
          clearTimeout(timer);
          sub?.remove();
          resolve(pos);
        },
      )
        .then((s) => {
          sub = s;
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });

    if (watched && !isNullIsland(watched.coords.latitude, watched.coords.longitude)) {
      rememberJobFix(watched.coords.latitude, watched.coords.longitude);
      return { latitude: watched.coords.latitude, longitude: watched.coords.longitude };
    }

    if (mode === "strict") {
      throw new Error("Valid GPS coordinates are required. Move outdoors and try again.");
    }
    return {
      latitude: 0,
      longitude: 0,
      warning: "GPS unavailable — using fallback coords.",
    };
  } catch (err) {
    if (mode === "strict") {
      throw err instanceof Error ? err : new Error("GPS unavailable. Enable location and try again.");
    }
    return {
      latitude: 0,
      longitude: 0,
      warning: "GPS unavailable — using fallback coords.",
    };
  }
}
