import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import type { LatLng } from "@/components/track/HomeLiveMap";
import { parityApi } from "@/services/core/parity-api";
import { coreApi } from "@/services/core/api";
import { decodePolyline } from "@/lib/polyline";
import { toJourneyStage, STAGE_ORDER } from "@/lib/journey-stage";

/** Preview coordinates for the always-on home card when nothing is tracking. */
const DEMO_PROVIDER: LatLng = { latitude: 28.4512, longitude: 77.0723 };
const DEMO_DEST: LatLng = { latitude: 28.4689, longitude: 77.0619 };

/** Straight-line km between two coords. */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Bearing provider→destination as an 8-point compass label. */
function compass(a: LatLng, b: LatLng): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x =
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/**
 * Everything a live-tracking map needs, derived once.
 *
 * Provider position comes from the tracking WebSocket, the destination from the
 * same backend booking detail the website reads, and the road polyline plus real
 * distance/duration from the backend Directions proxy. Extracted from
 * `LiveTrackingSection` so the home card and the AI assistant card cannot drift
 * apart — duplicating this derivation is how two surfaces end up disagreeing
 * about where the same professional is.
 */
export function useLiveTrackingView() {
  const { activeBooking, tracking, connected } = useActiveTracking();
  const hasLive = !!activeBooking;

  // Destination coords come from the SAME backend booking detail the website
  // reads (address.latitude/longitude) — the app store only keeps a display string.
  const bookingDetailQ = useQuery({
    queryKey: ["booking-detail-track", activeBooking?.id],
    queryFn: () => coreApi.bookings.byId(activeBooking!.id),
    enabled: !!activeBooking?.id,
    staleTime: 60_000,
  });
  const detailAddr = (
    bookingDetailQ.data?.booking as unknown as {
      address?: { latitude?: number; longitude?: number };
    } | undefined
  )?.address;

  const t = tracking as
    | {
        providerLatitude?: number;
        providerLongitude?: number;
        eta?: number;
        distance?: number;
        status?: string;
        bearing?: number;
        speed?: number;
      }
    | undefined;

  // Live heading (Uber-style marker rotation) + ground speed (m/s → km/h).
  const bearing = t?.bearing ?? null;
  const speedKmh = t?.speed != null ? Math.round(t.speed * 3.6) : null;

  // Status-driven journey — SAME mapping as the website, so progress is never
  // hardcoded.
  const stage = toJourneyStage(t?.status ?? activeBooking?.status);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const enRoute = hasLive && stageIdx <= STAGE_ORDER.indexOf("EN_ROUTE");
  const arrived = stage === "ARRIVED";
  const inService = stage === "STARTED";
  const completed = stage === "COMPLETED";

  const liveProvider: LatLng | null =
    t?.providerLatitude != null && t?.providerLongitude != null
      ? { latitude: t.providerLatitude, longitude: t.providerLongitude }
      : null;
  const liveDest: LatLng | null =
    detailAddr?.latitude != null && detailAddr?.longitude != null
      ? { latitude: detailAddr.latitude, longitude: detailAddr.longitude }
      : null;

  const provider = liveProvider ?? DEMO_PROVIDER;
  const destination = liveDest ?? DEMO_DEST;
  const region = {
    latitude: (provider.latitude + destination.latitude) / 2,
    longitude: (provider.longitude + destination.longitude) / 2,
    latitudeDelta: Math.max(Math.abs(provider.latitude - destination.latitude) * 2.4, 0.03),
    longitudeDelta: Math.max(Math.abs(provider.longitude - destination.longitude) * 2.4, 0.03),
  };

  // Accurate ROAD route (Google Directions via backend) — real distance/time +
  // the on-map road polyline. Cached; refreshes as coords move.
  const routeQ = useQuery({
    queryKey: [
      "geo-route",
      provider.latitude.toFixed(4),
      provider.longitude.toFixed(4),
      destination.latitude.toFixed(4),
      destination.longitude.toFixed(4),
    ],
    queryFn: () =>
      parityApi.geo.route(
        { lat: provider.latitude, lng: provider.longitude },
        { lat: destination.latitude, lng: destination.longitude },
      ),
    staleTime: 60_000,
    // Inherits the client's status-aware retry policy.
  });
  const routePoints = React.useMemo(
    () => decodePolyline(routeQ.data?.polyline),
    [routeQ.data?.polyline],
  );

  // Prefer real road numbers; fall back to live WS values, then straight-line.
  const distanceKm = routeQ.data?.distanceKm ?? t?.distance ?? haversineKm(provider, destination);
  const etaMin =
    t?.eta != null
      ? Math.round(t.eta)
      : routeQ.data?.durationMin ?? (hasLive ? null : Math.max(1, Math.round(distanceKm * 3.2)));
  const direction = compass(provider, destination);

  /** True only when the coordinates on screen are the user's real ones. */
  const isRealPosition = !!liveProvider;

  return {
    activeBooking,
    connected,
    hasLive,
    provider,
    destination,
    region,
    routePoints,
    bearing,
    speedKmh,
    stage,
    stageIdx,
    enRoute,
    arrived,
    inService,
    completed,
    distanceKm,
    etaMin,
    direction,
    isRealPosition,
  };
}
