import * as Location from "expo-location";
import { getE2eGeoOverride } from "@/lib/e2e-geo";
import { readRememberedJobFix, rememberJobFix } from "@/lib/job-fix-cache";
import { removeQuietly } from "@/lib/safe-subscription";

export type JobCoords = {
  latitude: number;
  longitude: number;
};

/**
 * A device with no fix still SENDS arrive / start / the on-site check, with `null` coordinates
 * (tracker P0-6b): the server lets it through when the customer or an admin has vouched for this
 * partner, and otherwise answers with its own sentence (`LOCATION_REQUIRED`, …). So there is no
 * "location is required" refusal on the phone any more — the phone cannot know about the exception.
 */

/** Shown when a non-gated action (en route / complete) was sent without a fix. */
export const LOCATION_UNAVAILABLE_NOTE = "Sent without your location. It was not available just now.";

/** What "Turn on location" did, so the screen can say what to do next. */
export type LocationAccessResult =
  /** Permission is granted and location services are on: try the step again. */
  | "ready"
  /** The OS settings were opened: the partner has to switch it on there. */
  | "opened_settings"
  /** Nothing could be opened. */
  | "unavailable";

/**
 * The partner asked to turn location on (the button under a position refusal). Asks for the
 * permission when the OS will still show its prompt, asks Android to switch location services on,
 * and otherwise opens the app's settings page. Only ever called from a tap: this is the one place on
 * the job screen that may raise a system dialog (X-62).
 */
export async function requestJobLocationAccess(openSettings: () => Promise<void>): Promise<LocationAccessResult> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted" && permission.canAskAgain) {
      permission = await withTimeout(Location.requestForegroundPermissionsAsync(), 30_000, "Location permission");
    }
    if (permission.status !== "granted") {
      await openSettings();
      return "opened_settings";
    }
    if (await Location.hasServicesEnabledAsync().catch(() => true)) return "ready";
    // Android only: the system "turn on location" dialog. Elsewhere it rejects and settings open.
    try {
      await Location.enableNetworkProviderAsync();
      if (await Location.hasServicesEnabledAsync().catch(() => false)) return "ready";
    } catch {
      /* declined, or not Android */
    }
    await openSettings();
    return "opened_settings";
  } catch {
    try {
      await openSettings();
      return "opened_settings";
    } catch {
      return "unavailable";
    }
  }
}

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
    // READ the permission, never ask for it here: a system prompt raised from a lifecycle tap raced
    // its own timeout and the request went out with no position while the partner was still
    // answering it. Not granted is "no fix"; the server's refusal then offers "Turn on location"
    // (`requestJobLocationAccess`), the one place that may raise the prompt.
    const { status } = await withTimeout(Location.getForegroundPermissionsAsync(), 8_000, "Location permission");
    if (status !== "granted") return null;

    // A last-known fix is used only when it is recent and tight, and is never remembered: an
    // hours-old point sent as "I've arrived" was refused as too far from the door, and the cache
    // then resent the same point for two minutes.
    // Bounded: on some platforms this read waits for a new fix instead of answering from memory,
    // and a tap on "I've arrived" must not sit behind it.
    const last = await withTimeout(Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 }), 2_000, "Last known position").catch(() => null);
    if (last && !isNullIsland(last.coords.latitude, last.coords.longitude)) {
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }

    const watched = await new Promise<Location.LocationObject | null>((resolve) => {
      let sub: Location.LocationSubscription | null = null;
      // The timer or the first fix can win before `watchPositionAsync` hands the subscription over;
      // it is then removed the moment it arrives, so no high-accuracy watch is left running.
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        removeQuietly(sub);
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
          settled = true;
          removeQuietly(sub);
          resolve(pos);
        },
      )
        .then((s) => {
          sub = s;
          if (settled) removeQuietly(s);
        })
        .catch(() => {
          clearTimeout(timer);
          settled = true;
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
