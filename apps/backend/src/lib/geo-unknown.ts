/**
 * "We do not know where the partner is" must never be confused with "the partner is at 0°,0°".
 *
 * Clients used to send `{latitude: 0, longitude: 0}` when GPS was unavailable, and the server
 * computed a real distance from the Gulf of Guinea, stored it as `distanceKm` and fed it to ETA
 * labels. Coordinates are now optional on the flows that do not require a proof of presence
 * (en-route, complete), and this helper is the single place that decides whether a pair is a
 * usable fix. Arrive/start keep their strict `assertJobProximity` gate, which already rejects 0,0.
 */
export type KnownCoords = { latitude: number; longitude: number };

export function knownCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): KnownCoords | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
