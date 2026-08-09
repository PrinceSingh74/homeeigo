"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useRef, useState } from "react";
import { mapsLoadErrorHint, useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { useGeolocationWatcher } from "@/hooks/use-geolocation-watcher";

type LatLng = { lat: number; lng: number };

function getGoogle(): any | null {
  const g = (window as Window & { google?: any }).google;
  if (!g?.maps || typeof g.maps.Map !== "function") {
    return null;
  }
  return g;
}

/**
 * Real Google Maps JS partner map — the partner's live GPS position + (optional)
 * active-job destination + driving route polyline between them. Replaces the
 * previous fake SVG placeholder. Falls back to a status panel without a key.
 */
export const PartnerLiveMap = memo(function PartnerLiveMap({
  destination,
  className = "h-full w-full",
}: {
  destination?: LatLng | null;
  className?: string;
}) {
  const { loaded, error, configured } = useGoogleMapsLoader();
  const coords = useGeolocationWatcher({ minMoveMeters: 25 });
  const [initError, setInitError] = useState<string | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const meRef = useRef<any>(null);
  const destRef = useRef<any>(null);
  const dirRef = useRef<any>(null);
  const lastRoute = useRef("");

  const me: LatLng | null = coords ? { lat: coords.latitude, lng: coords.longitude } : null;

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;

    const g = getGoogle();
    if (!g) {
      const msg = "maps_not_ready";
      console.error("[PartnerLiveMap] Map constructor unavailable after loader signaled ready");
      setInitError(msg);
      return;
    }

    try {
      mapRef.current = new g.maps.Map(divRef.current, {
        center: me ?? destination ?? { lat: 28.6139, lng: 77.209 },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        clickableIcons: false,
        styles: [{ elementType: "geometry", stylers: [{ color: "#0a1628" }] }],
      });
      dirRef.current = new g.maps.DirectionsRenderer({
        map: mapRef.current,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: "#22c55e", strokeWeight: 5, strokeOpacity: 0.9 },
      });
      setInitError(null);
    } catch (e) {
      console.error("[PartnerLiveMap] map init failed:", e);
      setInitError("maps_init_failed");
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Partner (you) marker.
  useEffect(() => {
    if (!loaded || !mapRef.current || !me) return;
    const g = getGoogle();
    if (!g) return;

    try {
      if (!meRef.current) {
        meRef.current = new g.maps.Marker({
          map: mapRef.current,
          position: me,
          title: "You",
          zIndex: 999,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#2563eb",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
      } else {
        meRef.current.setPosition(me);
      }
      if (destination) {
        const b = new g.maps.LatLngBounds();
        b.extend(me);
        b.extend(destination);
        mapRef.current.fitBounds(b, 56);
      } else {
        mapRef.current.panTo(me);
      }
      if (destination && dirRef.current) {
        const key = `${me.lat.toFixed(3)},${me.lng.toFixed(3)}`;
        if (key !== lastRoute.current) {
          lastRoute.current = key;
          new g.maps.DirectionsService().route(
            {
              origin: me,
              destination,
              travelMode: g.maps.TravelMode.DRIVING,
              drivingOptions: { departureTime: new Date() },
            },
            (res: any, status: string) => {
              if (status === "OK" && res) dirRef.current.setDirections(res);
            },
          );
        }
      }
    } catch (e) {
      console.error("[PartnerLiveMap] marker/route update failed:", e);
    }
  }, [loaded, me?.lat, me?.lng, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destination marker.
  useEffect(() => {
    if (!loaded || !mapRef.current || !destination) return;
    const g = getGoogle();
    if (!g) return;

    try {
      if (!destRef.current) {
        destRef.current = new g.maps.Marker({
          map: mapRef.current,
          position: destination,
          title: "Job",
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
      } else {
        destRef.current.setPosition(destination);
      }
    } catch (e) {
      console.error("[PartnerLiveMap] destination marker failed:", e);
    }
  }, [loaded, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const failureCode = error ?? initError;
  if (!configured || failureCode) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-[#0a1628] text-center text-partner-muted ${className}`}
      >
        <p className="text-sm font-medium">
          {me ? `You: ${me.lat.toFixed(4)}, ${me.lng.toFixed(4)}` : "Enable location to see the map"}
        </p>
        <p className="text-xs opacity-70">
          {!configured ? "Map key not configured" : mapsLoadErrorHint(failureCode)}
        </p>
      </div>
    );
  }

  return <div ref={divRef} className={className} aria-label="Partner live map" />;
});
