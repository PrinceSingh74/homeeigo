/* eslint-disable @typescript-eslint/no-explicit-any */
import { decodePolyline } from "@/lib/polyline";
import { partnerApi } from "@/services/partner-api";

type LatLng = { lat: number; lng: number };

export type ServerRoute = {
  path: LatLng[];
  distanceKm: number;
  durationMin: number;
  etaMin: number;
};

let inFlight = false;

export async function fetchServerRoute(origin: LatLng, destination: LatLng): Promise<ServerRoute> {
  const fallback: ServerRoute = {
    path: [origin, destination],
    distanceKm: 0,
    durationMin: 1,
    etaMin: 1,
  };
  try {
    const route = await partnerApi.geoIntel.route(origin, destination);
    const decoded = decodePolyline(route.polyline);
    return {
      path: decoded.length >= 2 ? decoded : [origin, destination],
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      etaMin: Math.max(1, Math.round(route.etaMinutes || route.durationMin)),
    };
  } catch {
    return fallback;
  }
}

export function paintRoutePolyline(
  g: any,
  map: any,
  lineRef: { current: any },
  path: LatLng[],
  dashed = false,
) {
  if (lineRef.current) lineRef.current.setMap(null);
  if (dashed) {
    lineRef.current = new g.maps.Polyline({
      map,
      path,
      geodesic: true,
      strokeOpacity: 0,
      icons: [
        {
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#34d399", scale: 3 },
          offset: "0",
          repeat: "14px",
        },
      ],
      zIndex: 5,
    });
    return;
  }
  lineRef.current = new g.maps.Polyline({
    map,
    path,
    geodesic: true,
    strokeColor: "#22c55e",
    strokeOpacity: 0.9,
    strokeWeight: 6,
    icons: [
      {
        icon: {
          path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 2.4,
          fillColor: "#ffffff",
          fillOpacity: 1,
          strokeColor: "#22c55e",
          strokeWeight: 1,
        },
        offset: "0%",
        repeat: "90px",
      },
    ],
    zIndex: 5,
  });
}

export async function drawServerRoute(
  g: any,
  map: any,
  lineRef: { current: any },
  origin: LatLng,
  destination: LatLng,
): Promise<ServerRoute | null> {
  if (inFlight) return null;
  inFlight = true;
  try {
    const route = await fetchServerRoute(origin, destination);
      const dashed = route.path.length === 2;
    paintRoutePolyline(g, map, lineRef, route.path, dashed && route.path.length === 2);
    return route;
  } finally {
    inFlight = false;
  }
}
