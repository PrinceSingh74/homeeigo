import * as Location from "expo-location";

export type DeviceFix =
  | { ok: true; latitude: number; longitude: number; accuracy: number | null }
  | { ok: false; reason: "denied" | "services_off" | "unavailable" };

const FIX_TIMEOUT_MS = 15_000;

/**
 * One real GPS fix for "use my current location". Never falls back to a default point:
 * a denied permission, disabled location services or no fix are reported so the caller can
 * send the customer to the address search instead.
 */
export async function getDeviceFix(): Promise<DeviceFix> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return { ok: false, reason: "denied" };
    const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!enabled) return { ok: false, reason: "services_off" };
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!pos) return { ok: false, reason: "unavailable" };
    const { latitude, longitude, accuracy } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, reason: "unavailable" };
    return { ok: true, latitude, longitude, accuracy: accuracy ?? null };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function deviceFixFailureMessage(reason: "denied" | "services_off" | "unavailable"): string {
  if (reason === "denied") return "Location permission is off — search for your address instead.";
  if (reason === "services_off") return "Your phone's location (GPS) is turned off — search for your address instead.";
  return "Couldn't get your current location — search for your address instead.";
}
