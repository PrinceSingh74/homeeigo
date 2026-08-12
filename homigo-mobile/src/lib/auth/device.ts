import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "homigo_device_id";

function randomId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cachedDeviceId: string | undefined;
let loadPromise: Promise<string> | null = null;

/**
 * Synchronous best-effort id (non-auth uses: fraud headers, telemetry). Prefer
 * ensureDeviceId() for anything that binds a session — it is stable and persisted.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = randomId();
  void AsyncStorage.setItem(DEVICE_ID_KEY, cachedDeviceId).catch(() => undefined);
  return cachedDeviceId;
}

/**
 * Authoritative device id for auth binding. Loads the persisted id (or creates and
 * persists one) exactly once and caches it, so login and EVERY later token refresh
 * use the SAME id.
 *
 * Fixes the race where the sync getDeviceId() minted a throwaway id that bound the
 * refresh token to a device which a later async load then overwrote — the mismatched
 * refresh was rejected (INVALID_TOKEN) and the user was silently logged out mid-session.
 */
export function ensureDeviceId(): Promise<string> {
  if (cachedDeviceId) return Promise.resolve(cachedDeviceId);
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
          id = randomId();
          await AsyncStorage.setItem(DEVICE_ID_KEY, id);
        }
        // If a concurrent getDeviceId() already minted one while we awaited, it wins —
        // both paths must converge on a single value for this app session.
        cachedDeviceId = cachedDeviceId ?? id;
      } catch {
        cachedDeviceId = cachedDeviceId ?? randomId();
      }
      return cachedDeviceId as string;
    })();
  }
  return loadPromise;
}

/** Warm the persisted id into the cache early (called once at app start). */
export async function initDeviceId(): Promise<string | undefined> {
  try {
    return await ensureDeviceId();
  } catch {
    return undefined;
  }
}

export function getDeviceName(): string {
  if (Platform.OS === "ios") return "iOS App";
  if (Platform.OS === "android") return "Android App";
  return "Homeeigo Mobile";
}
