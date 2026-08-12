"use client";

import { useEffect, useRef, useState } from "react";
import { useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { GpsKalmanFilter } from "@/lib/kalman-gps";
import { HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";

type LatLng = { lat: number; lng: number };

export type RouteInfo = {
  distanceKm: number;
  distanceText: string;
  etaMin: number;
  durationText: string;
  withTraffic: boolean;
  trafficLevel: "light" | "moderate" | "heavy";
};

export type LiveTelemetry = {
  /** Kalman-derived ground speed (km/h) — real fallback when the WS feed has no speed. */
  speedKmh: number;
  /** Travel heading in compass degrees, null while stationary. */
  headingDeg: number | null;
};

/**
 * World-class live-tracking map (customer side).
 * - Kalman-smoothed provider position (no GPS jitter / teleporting)
 * - HOMEEIGO rider photo marker in a branded puck + rotating heading cone
 *   (scooter flips to face its direction of travel, Uber/Zomato style)
 * - 60 fps eased interpolation between fixes
 * - Traffic-aware Directions route: exact road polyline + direction arrows, tinted by congestion
 * - Exact Google route distance + traffic ETA surfaced via `onRoute`
 * - Real speed/heading surfaced via `onTelemetry` (Kalman velocity)
 * - Map JS deferred until visible (LCP), with a premium static preview
 */
export function LiveTrackingMap({
  provider,
  destination,
  bearing,
  accuracy,
  onRoute,
  onTelemetry,
  routeEnabled = true,
  riderLabel,
  className = "h-64 w-full sm:h-80",
}: {
  provider: LatLng | null;
  destination?: LatLng;
  bearing?: number | null;
  accuracy?: number | null;
  onRoute?: (info: RouteInfo) => void;
  onTelemetry?: (t: LiveTelemetry) => void;
  /** Draw the provider→destination route. Turn off once the partner has arrived. */
  routeEnabled?: boolean;
  /** Floating name tag above the rider (e.g. "Rahul · 9 min"). */
  riderLabel?: string | null;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const { loaded, error, configured } = useGoogleMapsLoader(visible);

  const divRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const providerMarkerRef = useRef<any>(null); // rider puck (photo / fallback glyph)
  const headingConeRef = useRef<any>(null); // rotating direction cone under the puck
  const labelMarkerRef = useRef<any>(null); // floating name pill above the puck
  const riderLabelRef = useRef<string | null>(riderLabel ?? null);
  riderLabelRef.current = riderLabel ?? null;
  const destMarkerRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const animRef = useRef<number | null>(null);
  const lastRouteKey = useRef<string>("");
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  const onTelemetryRef = useRef(onTelemetry);
  onTelemetryRef.current = onTelemetry;
  const routeEnabledRef = useRef(routeEnabled);
  routeEnabledRef.current = routeEnabled;

  // Smoothing + animation state (kept in refs so the rAF loop stays stable).
  const kalmanRef = useRef<GpsKalmanFilter>(new GpsKalmanFilter());
  const renderPos = useRef<LatLng | null>(null); // currently-painted marker position
  const targetPos = useRef<LatLng | null>(null); // latest smoothed target
  const renderHeading = useRef<number>(0);
  const targetHeading = useRef<number>(0);
  const lastConeHeading = useRef<number>(-999);
  const riderUriRef = useRef<string | null>(null);
  const facingRightRef = useRef<boolean | null>(null);

  // Init map once the script is loaded.
  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    const start = provider ?? destination ?? { lat: 28.6139, lng: 77.209 };
    mapRef.current = new g.maps.Map(divRef.current, {
      center: start,
      zoom: 15,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
      backgroundColor: "#0b1220",
      styles: PREMIUM_MAP_STYLE,
    });

    // Warm the rider photo → data URI (needed to embed it in an SVG marker).
    void loadRiderDataUri().then((uri) => {
      if (!uri) return;
      riderUriRef.current = uri;
      const m = providerMarkerRef.current;
      if (m) {
        const faceRight = facingRightRef.current ?? headingFacesRight(renderHeading.current, null) ?? false;
        facingRightRef.current = faceRight;
        m.setIcon(riderPuckIcon(g, uri, faceRight));
      }
    });

    // Continuous 60 fps interpolation loop: ease painted position/heading → targets.
    const tick = () => {
      const gg = (window as any).google;
      const m = providerMarkerRef.current;
      if (m && targetPos.current) {
        const rp = renderPos.current ?? targetPos.current;
        // ease-out (alpha) toward target — smaller alpha = smoother/laggier.
        const next = {
          lat: rp.lat + (targetPos.current.lat - rp.lat) * 0.18,
          lng: rp.lng + (targetPos.current.lng - rp.lng) * 0.18,
        };
        renderPos.current = next;
        m.setPosition(next);
        headingConeRef.current?.setPosition(next);
        labelMarkerRef.current?.setPosition(next);
        // Smoothly rotate heading the short way around the circle.
        let dh = targetHeading.current - renderHeading.current;
        while (dh > 180) dh -= 360;
        while (dh < -180) dh += 360;
        renderHeading.current = (renderHeading.current + dh * 0.2 + 360) % 360;
        if (Math.abs(renderHeading.current - lastConeHeading.current) >= 3) {
          lastConeHeading.current = renderHeading.current;
          headingConeRef.current?.setIcon(headingConeIcon(gg, renderHeading.current));
          // Flip the scooter photo to face its travel direction (with hysteresis
          // so it doesn't flicker when riding almost due north/south).
          if (riderUriRef.current) {
            const face = headingFacesRight(renderHeading.current, facingRightRef.current);
            if (face !== null && face !== facingRightRef.current) {
              facingRightRef.current = face;
              m.setIcon(riderPuckIcon(gg, riderUriRef.current, face));
            }
          }
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destination marker — branded "home" pin.
  useEffect(() => {
    if (!loaded || !mapRef.current || !destination) return;
    const g = (window as any).google;
    if (!destMarkerRef.current) {
      destMarkerRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: destination,
        title: "Your home",
        icon: homePinIcon(g),
        zIndex: 10,
      });
    } else {
      destMarkerRef.current.setPosition(destination);
    }
  }, [loaded, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Provider fix → Kalman smooth → set interpolation target + heading + telemetry.
  useEffect(() => {
    if (!loaded || !mapRef.current || !provider) return;
    const g = (window as any).google;

    const filtered = kalmanRef.current.update(provider, accuracy ?? 15);
    const smoothed = filtered.position;
    // Prefer the server-computed bearing; fall back to the Kalman-derived heading.
    const heading = bearing != null && Number.isFinite(bearing) ? bearing : filtered.headingDeg;

    targetPos.current = smoothed;
    if (heading != null) targetHeading.current = heading;

    // Real telemetry for the panel (speed from the Kalman velocity estimate).
    onTelemetryRef.current?.({
      speedKmh: Math.round(filtered.speedMps * 3.6),
      headingDeg: heading,
    });

    if (!providerMarkerRef.current) {
      renderPos.current = smoothed;
      renderHeading.current = heading ?? 0;
      lastConeHeading.current = heading ?? 0;
      headingConeRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: smoothed,
        clickable: false,
        icon: headingConeIcon(g, heading ?? 0),
        zIndex: 998,
        optimized: false,
      });
      const uri = riderUriRef.current;
      const faceRight = headingFacesRight(heading ?? 0, null) ?? false;
      facingRightRef.current = faceRight;
      providerMarkerRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: smoothed,
        title: "Your HOMEEIGO partner",
        icon: uri ? riderPuckIcon(g, uri, faceRight) : fallbackPuckIcon(g),
        zIndex: 999,
        optimized: false,
      });
      if (riderLabelRef.current) {
        labelMarkerRef.current = new g.maps.Marker({
          map: mapRef.current,
          position: smoothed,
          clickable: false,
          icon: namePillIcon(g, riderLabelRef.current),
          zIndex: 1000,
          optimized: false,
        });
      }
    }

    // Keep both points in view (gentle — only when provider drifts near an edge).
    if (destination) {
      const b = new g.maps.LatLngBounds();
      b.extend(smoothed);
      b.extend(destination);
      const bounds = mapRef.current.getBounds();
      if (!bounds || !bounds.contains(smoothed) || !bounds.contains(destination)) {
        mapRef.current.fitBounds(b, 72);
      }
    } else {
      mapRef.current.panTo(smoothed);
    }

    // Refresh the traffic-aware route when the provider has moved enough (~throttled).
    if (destination && routeEnabledRef.current) {
      const key = `${smoothed.lat.toFixed(3)},${smoothed.lng.toFixed(3)}`;
      if (key !== lastRouteKey.current) {
        lastRouteKey.current = key;
        drawRoute(g, mapRef.current, routeLineRef, smoothed, destination, onRouteRef.current);
      }
    }
  }, [loaded, provider?.lat, provider?.lng, bearing, accuracy, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } else if (providerMarkerRef.current) {
      labelMarkerRef.current = new g.maps.Marker({
        map: mapRef.current,
        position: providerMarkerRef.current.getPosition(),
        clickable: false,
        icon: namePillIcon(g, riderLabel),
        zIndex: 1000,
        optimized: false,
      });
    }
  }, [loaded, riderLabel]);

  // Once the partner has arrived / service started, retire the stale route line.
  useEffect(() => {
    if (routeEnabled) return;
    lastRouteKey.current = "";
    if (routeLineRef.current) {
      routeLineRef.current.setMap(null);
      routeLineRef.current = null;
    }
  }, [routeEnabled]);

  // Reset the Kalman filter when the destination (i.e. the tracked trip) changes.
  useEffect(() => {
    kalmanRef.current.reset();
    renderPos.current = null;
    targetPos.current = null;
  }, [destination?.lat, destination?.lng]);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // Load the map only when within 200px of the viewport.
  useEffect(() => {
    if (visible || !wrapRef.current) return;
    const el = wrapRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  if (!configured || error) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-sky-50 to-white text-center ${className}`}>
        <p className="text-sm font-medium text-gray-700">
          {provider ? `Provider at ${provider.lat.toFixed(4)}, ${provider.lng.toFixed(4)}` : "Waiting for provider location…"}
        </p>
        <p className="text-xs text-gray-400">{!configured ? "Map key not configured" : "Map failed to load"}</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`}>
      {!loaded ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-900 to-slate-800">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-sky-400/40 border-t-sky-400" aria-hidden />
          <p className="text-xs text-slate-300">
            {provider ? `Provider near ${provider.lat.toFixed(3)}, ${provider.lng.toFixed(3)}` : "Loading live map…"}
          </p>
        </div>
      ) : null}
      <div ref={divRef} className="h-full w-full" aria-label="Live tracking map" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rider marker system                                                 */
/* ------------------------------------------------------------------ */

/** Fetch the HOMEEIGO rider photo once and cache it as a data URI (SVG <image> needs one). */
let riderDataUriPromise: Promise<string | null> | null = null;
function loadRiderDataUri(): Promise<string | null> {
  if (!riderDataUriPromise) {
    riderDataUriPromise = fetch(HOMIGO_RIDER_IMAGE)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("rider_fetch_failed"))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("rider_read_failed"));
            fr.readAsDataURL(blob);
          }),
      )
      .catch(() => null);
  }
  return riderDataUriPromise;
}

/**
 * Should the scooter photo face right (eastbound)? The source photo faces left.
 * Hysteresis: near due-north/south (±20°) keep the current facing to avoid flicker.
 */
function headingFacesRight(heading: number, current: boolean | null): boolean | null {
  const h = ((heading % 360) + 360) % 360;
  if (h > 20 && h < 160) return true; // clearly eastbound
  if (h > 200 && h < 340) return false; // clearly westbound
  return current; // ambiguous — keep whatever we show now
}

/** Cache the two (left/right) rider puck data-URIs — they embed an ~90 KB photo. */
const riderIconCache = new Map<string, string>();

/**
 * The hero marker: HOMEEIGO rider photo in a white puck with brand ring,
 * soft halo and drop shadow. The photo stays upright; direction is shown
 * by the separate rotating cone underneath.
 */
function riderPuckIcon(g: any, dataUri: string, faceRight: boolean) {
  const key = faceRight ? "R" : "L";
  let url = riderIconCache.get(key);
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
    riderIconCache.set(key, url);
  }
  return {
    url,
    scaledSize: new g.maps.Size(92, 92),
    anchor: new g.maps.Point(46, 46),
  };
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
    // Anchor below the SVG so the pill floats just above the 92px rider puck.
    anchor: new g.maps.Point(entry.w / 2, entry.h + 42),
  };
}

/** Rotating direction cone rendered under the rider puck (cheap to rebuild per ~3°). */
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
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new g.maps.Size(120, 120),
    anchor: new g.maps.Point(60, 60),
  };
}

/** Simple branded puck shown for the first frames until the rider photo is ready. */
function fallbackPuckIcon(g: any) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92" viewBox="0 0 92 92">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <circle cx="46" cy="46" r="31" fill="#ffffff"/>
  <circle cx="46" cy="46" r="29" fill="url(#body)"/>
  <g fill="#ffffff" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round">
    <circle cx="46" cy="37" r="3.2"/>
    <circle cx="46" cy="56" r="3.2"/>
    <line x1="46" y1="37" x2="46" y2="56"/>
    <line x1="41" y1="41" x2="51" y2="41"/>
  </g>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new g.maps.Size(92, 92),
    anchor: new g.maps.Point(46, 46),
  };
}

/** Destination: emerald "home" pin with white ring — reads instantly as "your place". */
function homePinIcon(g: any) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="hp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <filter id="hs" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#022c22" flood-opacity="0.45"/>
    </filter>
  </defs>
  <circle cx="24" cy="24" r="15" fill="url(#hp)" filter="url(#hs)"/>
  <circle cx="24" cy="24" r="15" fill="none" stroke="#ffffff" stroke-width="3"/>
  <path d="M24 16.5 L31 22.5 V31 H26.5 V26 H21.5 V31 H17 V22.5 Z" fill="#ffffff"/>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new g.maps.Size(48, 48),
    anchor: new g.maps.Point(24, 24),
  };
}

/**
 * Draw a traffic-aware route (provider → destination) with the exact road polyline,
 * repeated direction arrows, and a colour tint reflecting congestion. Reports the exact
 * Google route distance + traffic ETA via `onRoute`.
 */
function drawRoute(
  g: any,
  map: any,
  lineRef: React.MutableRefObject<any>,
  origin: LatLng,
  destination: LatLng,
  onRoute?: (info: RouteInfo) => void,
) {
  new g.maps.DirectionsService().route(
    {
      origin,
      destination,
      travelMode: g.maps.TravelMode.DRIVING,
      provideRouteAlternatives: false,
      drivingOptions: { departureTime: new Date(), trafficModel: "bestguess" },
    },
    (res: any, status: string) => {
      if (status !== "OK" || !res?.routes?.[0]) return;
      const route = res.routes[0];
      const leg = route.legs?.[0];
      const path = route.overview_path as Array<{ lat: () => number; lng: () => number }>;

      // Congestion = traffic duration / free-flow duration.
      const base = leg?.duration?.value ?? 0;
      const traffic = leg?.duration_in_traffic?.value ?? base;
      const ratio = base > 0 ? traffic / base : 1;
      const level: RouteInfo["trafficLevel"] = ratio > 1.4 ? "heavy" : ratio > 1.15 ? "moderate" : "light";
      const color = level === "heavy" ? "#ef4444" : level === "moderate" ? "#f59e0b" : "#22c55e";

      if (lineRef.current) lineRef.current.setMap(null);
      lineRef.current = new g.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 6,
        icons: [
          {
            icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.4, fillColor: "#ffffff", fillOpacity: 1, strokeColor: color, strokeWeight: 1 },
            offset: "0%",
            repeat: "90px",
          },
        ],
        zIndex: 5,
      });

      onRoute?.({
        distanceKm: leg?.distance?.value ? Math.round((leg.distance.value / 1000) * 10) / 10 : 0,
        distanceText: leg?.distance?.text ?? "",
        etaMin: Math.max(1, Math.round((traffic || base) / 60)),
        durationText: leg?.duration_in_traffic?.text ?? leg?.duration?.text ?? "",
        withTraffic: Boolean(leg?.duration_in_traffic),
        trafficLevel: level,
      });
    },
  );
}

/** Dark, low-chrome basemap so the route + branded marker pop (Uber/Tesla aesthetic). */
const PREMIUM_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#243049" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
];
