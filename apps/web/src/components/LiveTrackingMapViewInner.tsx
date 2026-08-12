"use client";

import { memo, useEffect, useState } from "react";
import { APIProvider, Map } from "@vis.gl/react-google-maps";

const DELHI = { lat: 28.6139, lng: 77.209 };

const PREMIUM_DARK = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
];

export const LiveTrackingMapViewInner = memo(function LiveTrackingMapViewInner({
  className,
  position,
}: {
  className?: string;
  position?: { lat: number; lng: number };
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;
  const [center, setCenter] = useState(position ?? DELHI);

  useEffect(() => {
    if (position || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 6_000 },
    );
  }, [position]);

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        center={center}
        defaultZoom={14}
        gestureHandling="greedy"
        disableDefaultUI
        styles={PREMIUM_DARK}
        className={className}
      />
    </APIProvider>
  );
});
