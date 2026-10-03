import type { PartnerBooking, RouteStop } from "@/types/partner";

export type LatLng = { latitude: number; longitude: number };

/** How old a GPS fix may be before it must be labelled stale rather than shown as live. */
export const STALE_LOCATION_MS = 60_000;

export type PartnerLocationState =
  | { kind: "loading" }
  | { kind: "permission_denied" }
  | { kind: "unavailable" }
  | { kind: "live"; coords: LatLng; at: number }
  | { kind: "stale"; coords: LatLng; at: number };

/**
 * A job that can actually be drawn. Bookings without real coordinates are excluded rather than
 * defaulted to (0,0) — null-island markers would place a partner's job off the coast of Africa and
 * read as real. The rest of the app already treats 0,0 as "no fix" (see `job-coords.ts`).
 */
export type MapJob = {
  bookingId: string;
  bookingNumber: string;
  serviceName: string;
  status: string;
  addressLabel: string;
  coords: LatLng;
  /** Populated from the route API when this job is part of the optimized sequence. */
  order?: number;
  cumulativeEtaMin?: number;
};

function hasRealCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Exact null-island is the platform's existing "no fix" sentinel, not a real Indian location.
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Build drawable job markers from authorized bookings, enriched with route order/ETA when known. */
export function buildMapJobs(
  bookings: readonly PartnerBooking[] | undefined,
  routeStops?: readonly RouteStop[] | undefined,
): MapJob[] {
  if (!bookings?.length) return [];
  const byBookingId = new Map<string, RouteStop>();
  for (const stop of routeStops ?? []) byBookingId.set(stop.bookingId, stop);

  const jobs: MapJob[] = [];
  for (const b of bookings) {
    if (!hasRealCoords(b.address?.latitude, b.address?.longitude)) continue;
    const stop = byBookingId.get(b.id);
    jobs.push({
      bookingId: b.id,
      bookingNumber: b.bookingNumber,
      serviceName: b.service?.name ?? "Job",
      status: b.status,
      addressLabel: b.address?.fullAddress ?? "",
      coords: { latitude: b.address!.latitude as number, longitude: b.address!.longitude as number },
      order: stop?.order,
      cumulativeEtaMin: stop?.cumulativeEtaMin,
    });
  }

  // Route order first (so the drawn sequence reads 1,2,3...), then anything not in the route.
  return jobs.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return a.bookingNumber.localeCompare(b.bookingNumber);
  });
}

/** Classify a GPS fix as live or stale. Never presents an old fix as current. */
export function classifyLocation(
  coords: LatLng | null,
  fixedAt: number | null,
  now: number = Date.now(),
  staleAfterMs: number = STALE_LOCATION_MS,
): PartnerLocationState {
  if (!coords || fixedAt == null) return { kind: "unavailable" };
  if (!hasRealCoords(coords.latitude, coords.longitude)) return { kind: "unavailable" };
  const age = now - fixedAt;
  if (age > staleAfterMs) return { kind: "stale", coords, at: fixedAt };
  return { kind: "live", coords, at: fixedAt };
}

/**
 * A map region containing the partner and every job, with padding. Falls back to the partner
 * alone, then to the first job, then null (caller shows the empty state rather than a world view).
 */
export function fitRegion(
  partner: LatLng | null,
  jobs: readonly MapJob[],
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null {
  const points: LatLng[] = [];
  if (partner && hasRealCoords(partner.latitude, partner.longitude)) points.push(partner);
  for (const j of jobs) points.push(j.coords);
  if (points.length === 0) return null;

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // A single point has zero span — use a sensible neighbourhood zoom instead of an invalid delta.
  const latitudeDelta = Math.max((maxLat - minLat) * 1.5, 0.02);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.5, 0.02);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

export function formatEta(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
