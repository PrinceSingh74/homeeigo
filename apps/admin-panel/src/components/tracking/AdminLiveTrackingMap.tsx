"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useRef } from "react";
import { useGoogleMapsLoader, mapsLoadErrorHint } from "@/hooks/use-google-maps-loader";
import { GpsKalmanFilter } from "@/lib/kalman-gps";

type LatLng = { lat: number; lng: number };

export type AdminRouteInfo = {
  distanceKm: number;
  distanceText: string;
  etaMin: number;
  trafficLevel: "light" | "moderate" | "heavy";
};

/**
 * Admin oversight map for ONE live booking — the same engine the customer and
 * partner apps run (Kalman-smoothed HOMEEIGO rider puck + heading cone + traffic
 * route + home pin), so all three consoles show an identical picture of the trip.
 */
export const AdminLiveTrackingMap = memo(function AdminLiveTrackingMap({
  provider,
  destination,
  bearing,
  routeEnabled = true,
  riderLabel,
  onRoute,
  className = "h-72 w-full",
}: {
  provider: LatLng | null;
  destination?: LatLng;
  bearing?: number | null;
  routeEnabled?: boolean;
  /** Floating name tag above the rider (e.g. "Rahul Sharma · 9 min"). */
  riderLabel?: string | null;
  onRoute?: (r: AdminRouteInfo) => void;
  className?: string;
}) {
  const { loaded, error, configured } = useGoogleMapsLoader();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const coneRef = useRef<any>(null);
  const labelMarkerRef = useRef<any>(null); // floating name pill above the puck
  const riderLabelRef = useRef<string | null>(riderLabel ?? null);
  riderLabelRef.current = riderLabel ?? null;
  const destMarkerRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const animRef = useRef<number | null>(null);
  const kalman = useRef(new GpsKalmanFilter());
  const renderPos = useRef<LatLng | null>(null);
  const targetPos = useRef<LatLng | null>(null);
  const renderHeading = useRef(0);
  const targetHeading = useRef(0);
  const lastConeHeading = useRef(-999);
  const riderUriRef = useRef<string | null>(null);
  const facingRightRef = useRef<boolean | null>(null);
  const routeKey = useRef("");
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  const routeEnabledRef = useRef(routeEnabled);
  routeEnabledRef.current = routeEnabled;

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(divRef.current, {
      center: provider ?? destination ?? { lat: 28.6139, lng: 77.209 },
      zoom: 14, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
      backgroundColor: "#0b1220", styles: DARK_STYLE,
    });

    void loadRiderDataUri().then((uri) => {
      if (!uri) return;
      riderUriRef.current = uri;
      const m = markerRef.current;
      if (m) {
        const face = headingFacesRight(renderHeading.current, null) ?? false;
        facingRightRef.current = face;
        m.setIcon(riderPuckIcon(g, uri, face));
      }
    });

    const tick = () => {
      if (!document.hidden) {
        const gg = (window as any).google;
        const m = markerRef.current;
        if (m && targetPos.current) {
          const rp = renderPos.current ?? targetPos.current;
          const next = { lat: rp.lat + (targetPos.current.lat - rp.lat) * 0.18, lng: rp.lng + (targetPos.current.lng - rp.lng) * 0.18 };
          renderPos.current = next; m.setPosition(next);
          coneRef.current?.setPosition(next);
          labelMarkerRef.current?.setPosition(next);
          let dh = targetHeading.current - renderHeading.current;
          while (dh > 180) dh -= 360; while (dh < -180) dh += 360;
          renderHeading.current = (renderHeading.current + dh * 0.2 + 360) % 360;
          if (Math.abs(renderHeading.current - lastConeHeading.current) >= 3) {
            lastConeHeading.current = renderHeading.current;
            coneRef.current?.setIcon(headingConeIcon(gg, renderHeading.current));
            if (riderUriRef.current) {
              const face = headingFacesRight(renderHeading.current, facingRightRef.current);
              if (face !== null && face !== facingRightRef.current) {
                facingRightRef.current = face;
                m.setIcon(riderPuckIcon(gg, riderUriRef.current, face));
              }
            }
          }
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destination pin.
  useEffect(() => {
    if (!loaded || !mapRef.current || !destination) return;
    const g = (window as any).google;
    if (!destMarkerRef.current) {
      destMarkerRef.current = new g.maps.Marker({ map: mapRef.current, position: destination, title: "Customer address", icon: homePinIcon(g), zIndex: 10 });
    } else {
      destMarkerRef.current.setPosition(destination);
    }
  }, [loaded, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Provider fix → Kalman smooth → marker target + route refresh.
  useEffect(() => {
    if (!loaded || !mapRef.current || !provider) return;
    const g = (window as any).google;
    const f = kalman.current.update(provider);
    const heading = bearing != null && Number.isFinite(bearing) ? bearing : f.headingDeg;
    targetPos.current = f.position;
    if (heading != null) targetHeading.current = heading;

    if (!markerRef.current) {
      renderPos.current = f.position; renderHeading.current = heading ?? 0; lastConeHeading.current = heading ?? 0;
      coneRef.current = new g.maps.Marker({ map: mapRef.current, position: f.position, clickable: false, icon: headingConeIcon(g, heading ?? 0), zIndex: 998, optimized: false });
      const face = headingFacesRight(heading ?? 0, null) ?? false;
      facingRightRef.current = face;
      markerRef.current = new g.maps.Marker({
        map: mapRef.current, position: f.position, title: "Partner", zIndex: 999, optimized: false,
        icon: riderUriRef.current ? riderPuckIcon(g, riderUriRef.current, face) : fallbackPuckIcon(g),
      });
      if (riderLabelRef.current) {
        labelMarkerRef.current = new g.maps.Marker({
          map: mapRef.current, position: f.position, clickable: false,
          icon: namePillIcon(g, riderLabelRef.current), zIndex: 1000, optimized: false,
        });
      }
    }

    if (destination) {
      const b = new g.maps.LatLngBounds();
      b.extend(f.position); b.extend(destination);
      const bounds = mapRef.current.getBounds();
      if (!bounds || !bounds.contains(f.position) || !bounds.contains(destination)) {
        mapRef.current.fitBounds(b, 64);
      }
      if (routeEnabledRef.current) {
        const k = `${f.position.lat.toFixed(3)},${f.position.lng.toFixed(3)}`;
        if (k !== routeKey.current) {
          routeKey.current = k;
          drawRoute(g, mapRef.current, lineRef, f.position, destination, onRouteRef.current);
        }
      }
    } else {
      mapRef.current.panTo(f.position);
    }
  }, [loaded, provider?.lat, provider?.lng, bearing, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the floating name pill in sync (name/ETA text changes over the ride).
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const g = (window as any).google;
    if (!riderLabel) {
      labelMarkerRef.current?.setMap(null);
      labelMarkerRef.current = null;
      return;
    }
    if (labelMarkerRef.current) {
      labelMarkerRef.current.setIcon(namePillIcon(g, riderLabel));
    } else if (markerRef.current) {
      labelMarkerRef.current = new g.maps.Marker({
        map: mapRef.current, position: markerRef.current.getPosition(), clickable: false,
        icon: namePillIcon(g, riderLabel), zIndex: 1000, optimized: false,
      });
    }
  }, [loaded, riderLabel]);

  // Retire the route once the partner has arrived / job started.
  useEffect(() => {
    if (routeEnabled) return;
    routeKey.current = "";
    if (lineRef.current) { lineRef.current.setMap(null); lineRef.current = null; }
  }, [routeEnabled]);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  if (!configured || error) {
    return (
      <div className={`flex items-center justify-center rounded-xl bg-slate-950 text-center text-sm text-slate-400 ${className}`}>
        <p className="max-w-md px-4">{!configured ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable live tracking." : mapsLoadErrorHint(error)}</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`}>
      <div ref={divRef} className="h-full w-full" aria-label="Live booking tracking map" />
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-sm text-slate-400">Loading live map…</div>
      ) : null}
    </div>
  );
});

function drawRoute(g: any, map: any, lineRef: any, origin: LatLng, dest: LatLng, onRoute?: (r: AdminRouteInfo) => void) {
  new g.maps.DirectionsService().route(
    { origin, destination: dest, travelMode: g.maps.TravelMode.DRIVING, drivingOptions: { departureTime: new Date(), trafficModel: "bestguess" } },
    (res: any, status: string) => {
      if (status !== "OK" || !res?.routes?.[0]) return;
      const route = res.routes[0], leg = route.legs?.[0];
      const base = leg?.duration?.value ?? 0, traffic = leg?.duration_in_traffic?.value ?? base;
      const ratio = base > 0 ? traffic / base : 1;
      const level: AdminRouteInfo["trafficLevel"] = ratio > 1.4 ? "heavy" : ratio > 1.15 ? "moderate" : "light";
      const color = level === "heavy" ? "#ef4444" : level === "moderate" ? "#f59e0b" : "#22c55e";
      if (lineRef.current) lineRef.current.setMap(null);
      lineRef.current = new g.maps.Polyline({
        map, path: route.overview_path, geodesic: true, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 5,
        icons: [{ icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.2, fillColor: "#fff", fillOpacity: 1, strokeColor: color, strokeWeight: 1 }, offset: "0%", repeat: "90px" }],
        zIndex: 5,
      });
      onRoute?.({
        distanceKm: leg?.distance?.value ? Math.round((leg.distance.value / 1000) * 10) / 10 : 0,
        distanceText: leg?.distance?.text ?? "",
        etaMin: Math.max(1, Math.round((traffic || base) / 60)),
        trafficLevel: level,
      });
    },
  );
}

/* ---------------- HOMEEIGO rider marker system (same design as customer/partner) ---------------- */

let riderDataUriPromise: Promise<string | null> | null = null;
function loadRiderDataUri(): Promise<string | null> {
  if (!riderDataUriPromise) {
    riderDataUriPromise = fetch("/rider.webp")
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("rider_fetch_failed"))))
      .then((blob) => new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("rider_read_failed"));
        fr.readAsDataURL(blob);
      }))
      .catch(() => null);
  }
  return riderDataUriPromise;
}

function headingFacesRight(heading: number, current: boolean | null): boolean | null {
  const h = ((heading % 360) + 360) % 360;
  if (h > 20 && h < 160) return true;
  if (h > 200 && h < 340) return false;
  return current;
}

const riderIconCache = new Map<string, string>();
function riderPuckIcon(g: any, dataUri: string, faceRight: boolean) {
  const cacheKey = faceRight ? "R" : "L";
  let url = riderIconCache.get(cacheKey);
  if (!url) {
    const flip = faceRight ? `transform="translate(92 0) scale(-1 1)"` : "";
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92" viewBox="0 0 92 92">
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.32"/>
      <stop offset="65%" stop-color="#3b82f6" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="puck"><circle cx="46" cy="46" r="29"/></clipPath>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.4"/>
    </filter>
  </defs>
  <circle cx="46" cy="46" r="45" fill="url(#halo)"/>
  <circle cx="46" cy="46" r="31" fill="#ffffff" filter="url(#shadow)"/>
  <g clip-path="url(#puck)">
    <circle cx="46" cy="46" r="29" fill="#eff6ff"/>
    <g ${flip}>
      <image href="${dataUri}" x="12" y="15" width="68" height="68" preserveAspectRatio="xMidYMid meet"/>
    </g>
  </g>
  <circle cx="46" cy="46" r="31" fill="none" stroke="#2563eb" stroke-width="2.5"/>
  <circle cx="46" cy="46" r="33.5" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.9"/>
</svg>`.trim();
    url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    riderIconCache.set(cacheKey, url);
  }
  return { url, scaledSize: new g.maps.Size(92, 92), anchor: new g.maps.Point(46, 46) };
}

/**
 * Floating dark-glass name pill with a pointer notch, rendered above the rider
 * puck ("Rahul Sharma · 9 min" — Uber-style). Cached per text.
 */
const namePillCache = new Map<string, { url: string; w: number; h: number }>();
function namePillIcon(g: any, text: string) {
  const t = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  let entry = namePillCache.get(t);
  if (!entry) {
    const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const w = Math.max(68, Math.round(30 + t.length * 7.4));
    const h = 40;
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="ps" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.55"/>
    </filter>
  </defs>
  <g filter="url(#ps)">
    <rect x="1.5" y="1.5" width="${w - 3}" height="27" rx="13.5" fill="#0f172a" fill-opacity="0.94" stroke="#3b82f6" stroke-width="1.6"/>
    <path d="M${w / 2 - 6} 28.5 L${w / 2} 37 L${w / 2 + 6} 28.5 Z" fill="#0f172a" fill-opacity="0.94"/>
  </g>
  <text x="${w / 2}" y="19.5" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12.5" font-weight="700" fill="#ffffff">${esc}</text>
</svg>`.trim();
    entry = { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, w, h };
    if (namePillCache.size > 40) namePillCache.clear();
    namePillCache.set(t, entry);
  }
  return {
    url: entry.url,
    scaledSize: new g.maps.Size(entry.w, entry.h),
    anchor: new g.maps.Point(entry.w / 2, entry.h + 42),
  };
}

function headingConeIcon(g: any, heading: number) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g transform="rotate(${heading.toFixed(1)} 60 60)">
    <path d="M60 6 L76 46 A34 34 0 0 0 44 46 Z" fill="url(#cone)"/>
  </g>
</svg>`.trim();
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new g.maps.Size(120, 120), anchor: new g.maps.Point(60, 60) };
}

function fallbackPuckIcon(g: any) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92" viewBox="0 0 92 92">
  <defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/></linearGradient></defs>
  <circle cx="46" cy="46" r="31" fill="#ffffff"/>
  <circle cx="46" cy="46" r="29" fill="url(#body)"/>
  <g fill="#ffffff" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round">
    <circle cx="46" cy="37" r="3.2"/><circle cx="46" cy="56" r="3.2"/>
    <line x1="46" y1="37" x2="46" y2="56"/><line x1="41" y1="41" x2="51" y2="41"/>
  </g>
</svg>`.trim();
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new g.maps.Size(92, 92), anchor: new g.maps.Point(46, 46) };
}

function homePinIcon(g: any) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="hp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#059669"/></linearGradient>
    <filter id="hs" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#022c22" flood-opacity="0.45"/></filter>
  </defs>
  <circle cx="24" cy="24" r="15" fill="url(#hp)" filter="url(#hs)"/>
  <circle cx="24" cy="24" r="15" fill="none" stroke="#ffffff" stroke-width="3"/>
  <path d="M24 16.5 L31 22.5 V31 H26.5 V26 H21.5 V31 H17 V22.5 Z" fill="#ffffff"/>
</svg>`.trim();
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new g.maps.Size(48, 48), anchor: new g.maps.Point(24, 24) };
}

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
];
