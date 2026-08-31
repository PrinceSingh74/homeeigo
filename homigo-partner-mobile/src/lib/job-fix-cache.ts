/** Process-local last GPS fix shared by tracking publisher → lifecycle CTAs. */
let lastFix: { latitude: number; longitude: number; at: number } | null = null;

export function rememberJobFix(latitude: number, longitude: number) {
  if (latitude === 0 && longitude === 0) return;
  lastFix = { latitude, longitude, at: Date.now() };
}

export function readRememberedJobFix(maxAgeMs = 60_000): { latitude: number; longitude: number } | null {
  if (!lastFix) return null;
  if (Date.now() - lastFix.at > maxAgeMs) return null;
  return { latitude: lastFix.latitude, longitude: lastFix.longitude };
}
