/**
 * Whether this build can draw a native map. Android's Google Maps SDK needs the key that
 * app.config.js writes into the manifest from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY at build time; a build
 * made without it throws "API key not found" the moment a MapView mounts (X-74, emulator 2026-09-29).
 * iOS uses Apple Maps and needs no key. `expoConfig` is the config baked into the same build.
 */
type ExpoConfigLike = { android?: { config?: { googleMaps?: { apiKey?: string | null } | null } | null } | null } | null | undefined;

export function nativeMapAvailable(platform: string, expoConfig: ExpoConfigLike): boolean {
  if (platform !== "android") return true;
  const key = expoConfig?.android?.config?.googleMaps?.apiKey;
  return typeof key === "string" && key.trim().length > 0;
}

export const MAP_UNAVAILABLE_NOTE =
  "The map isn't available in this app build. Your jobs are listed below; Open in Maps gives directions in your maps app.";
