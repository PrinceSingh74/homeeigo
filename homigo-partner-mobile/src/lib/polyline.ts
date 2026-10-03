export type LatLng = { latitude: number; longitude: number };

/**
 * Decode a Google "encoded polyline" string into lat/lng points (precision 1e5).
 *
 * Ported verbatim from the customer app (`homigo-mobile/src/lib/polyline.ts`) so both clients
 * decode the SAME server-produced polyline identically — the partner map draws the route returned
 * by `/api/providers/me/route/optimize`, which uses the same encoding as the customer tracking map.
 */
export function decodePolyline(encoded: string | null | undefined): LatLng[] {
  if (!encoded) return [];
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}
