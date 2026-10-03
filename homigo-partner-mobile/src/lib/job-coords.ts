import * as Location from "expo-location";
import { getE2eGeoOverride } from "@/lib/e2e-geo";
import { readRememberedJobFix, rememberJobFix } from "@/lib/job-fix-cache";

export type JobCoords = {
  latitude: number;
  longitude: number;
};

/** Shown when a proximity-gated action (arrive / start) has no usable fix. */
export const LOCATION_REQUIRED_MESSAGE =
  "Location is required for this step. Turn on GPS / allow location access and try again.";

/** Shown when a non-gated action (en route / complete) was sent without a fix. */
export const LOCATION_UNAVAILABLE_NOTE = "Sent without GPS — location unavailable right now.";

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
 * Resolves the partner's current fix, or `null` when none is available.
 *
 * UNKNOWN is `null`, never `0,0`: the server treats a null fix as "no location"
 * (no distance, no completion fix), whereas `0,0` is a real point in the Gulf of
 * Guinea. Soft mode (en route / complete) tolerates a null; strict mode (arrive /
 * start) waits longer because the server owns the proximity gate and will refuse
 * a request without a fix.
 */
export async function getJobCoords(mode: "soft" | "strict" = "soft"): Promise<JobCoords | null> {
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
    if (status !== "granted") return null;

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
    return null;
  } catch {
    return null;
  }
}
