export type PartnerCoords = { latitude: number; longitude: number };

let remembered: { coords: PartnerCoords; at: number; pinned?: boolean } | null = null;

function isUsable(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
}

export function browserGpsAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.isSecureContext && navigator.geolocation);
}

/** Last browser/watch fix. Shared so Arrive/Start can reuse GPS already running for tracking. */
export function rememberPartnerFix(latitude: number, longitude: number, pinned = false): void {
  if (!isUsable(latitude, longitude)) return;
  remembered = { coords: { latitude, longitude }, at: Date.now(), pinned };
}

export function readRememberedPartnerFix(maxAgeMs: number): PartnerCoords | null {
  if (!remembered) return null;
  if (!remembered.pinned && Date.now() - remembered.at > maxAgeMs) return null;
  return remembered.coords;
}

export function readBrowserPosition(options: PositionOptions): Promise<PartnerCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!isUsable(latitude, longitude)) {
          resolve(null);
          return;
        }
        rememberPartnerFix(latitude, longitude);
        resolve({ latitude, longitude });
      },
      () => resolve(null),
      options,
    );
  });
}

export async function requestLiveGps(): Promise<PartnerCoords | null> {
  if (!browserGpsAvailable()) return null;
  const coarse = await readBrowserPosition({
    enableHighAccuracy: false,
    maximumAge: 15_000,
    timeout: 25_000,
  });
  if (coarse) return coarse;
  return readBrowserPosition({
    enableHighAccuracy: true,
    maximumAge: 10_000,
    timeout: 12_000,
  });
}

async function readPresenceFix(maxAgeMs: number): Promise<PartnerCoords | null> {
  try {
    const { partnerApi } = await import("@/services/partner-api");
    const snap = await partnerApi.presenceSnapshot();
    const loc = snap.location;
    if (!loc || !isUsable(loc.latitude, loc.longitude)) return null;
    if (loc.capturedAt) {
      const age = Date.now() - Date.parse(loc.capturedAt);
      if (Number.isFinite(age) && age > maxAgeMs) return null;
    }
    rememberPartnerFix(loc.latitude, loc.longitude);
    return { latitude: loc.latitude, longitude: loc.longitude };
  } catch {
    return null;
  }
}

/**
 * Resolve the partner's current GPS fix, or `null` when none is available.
 *
 * UNKNOWN is `null`, never `{0,0}`. Soft flows may proceed without a fix; strict
 * flows (arrive, start) need a real position. A pinned check-in from the GPS dropdown wins.
 */
export async function getPartnerCoords(mode: "soft" | "strict" = "soft"): Promise<PartnerCoords | null> {
  const cacheMs = mode === "strict" ? 120_000 : 240_000;
  const cached = readRememberedPartnerFix(cacheMs);
  if (cached) return cached;

  const live = await requestLiveGps();
  if (live) return live;

  return readPresenceFix(mode === "strict" ? 15 * 60_000 : 30 * 60_000);
}

export const LOCATION_REQUIRED_MESSAGE =
  "Turn on GPS from the location dropdown, then try again.";

export function getLocationRequiredMessage(): string {
  return LOCATION_REQUIRED_MESSAGE;
}
