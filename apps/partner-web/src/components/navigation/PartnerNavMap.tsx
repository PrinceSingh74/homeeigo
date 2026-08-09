"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useRef } from "react";
import { useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { GpsKalmanFilter } from "@/lib/kalman-gps";

type LatLng = { lat: number; lng: number };

export type NavRoute = {
  distanceKm: number;
  distanceText: string;
  etaMin: number;
  durationText: string;
  trafficLevel: "light" | "moderate" | "heavy";
  /** Road summary from Google, e.g. "NH 48 and Sohna Rd" — tells the partner WHICH route. */
  summary: string;
};
export type NavStep = { instruction: string; maneuver: string; distanceText: string; distanceM: number };
export type NavGuidance = {
  /** All remaining steps of the exact Google route (index 0 = first step of the leg). */
  steps: NavStep[];
  /** Index of the step the rider is currently on. */
  stepIndex: number;
  /** Live straight-line metres from the rider to the upcoming maneuver. */
  distToTurnM: number | null;
  /** Kalman ground speed (km/h). */
  speedKmh: number;
  /** True while the rider has left the route (a reroute is being fetched). */
  offRoute: boolean;
};

const OFF_ROUTE_M = 55; // >55 m from the polyline = off the route
const OFF_ROUTE_FIXES = 2; // consecutive fixes before we reroute (kills GPS blips)
const STEP_ADVANCE_M = 28; // within 28 m of the maneuver point = step done

/**
 * Partner turn-by-turn navigation engine — the exact Google route, followed live.
 * - Traffic-aware Directions route (exact road polyline, congestion-tinted, arrows)
 * - LIVE step tracking: advances the current instruction as the rider passes each
 *   maneuver, with a metres-to-turn countdown (Uber/Google-nav behaviour)
 * - Off-route detection → instant automatic reroute (not just periodic refresh)
 * - HOMEEIGO rider photo marker in a branded puck + rotating heading cone
 * - Kalman GPS smoothing + 60 fps eased interpolation, speed-adaptive camera zoom
 * - Live Google TrafficLayer so the partner sees congestion on every road
 */
export const PartnerNavMap = memo(function PartnerNavMap({
  position, accuracy, destination, destLabel, onRoute, onStep, onGuidance, onArrival, onReroute, className = "h-full w-full",
}: {
  position: LatLng | null;
  accuracy?: number | null;
  destination?: LatLng;
  /** Floating name tag above the destination pin (the customer's name). */
  destLabel?: string | null;
  onRoute?: (r: NavRoute) => void;
  onStep?: (s: NavStep | null) => void;
  onGuidance?: (g: NavGuidance) => void;
  onArrival?: () => void;
  onReroute?: () => void;
  className?: string;
}) {
  const { loaded, error, configured } = useGoogleMapsLoader();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null); // rider puck
  const coneRef = useRef<any>(null); // rotating heading cone
  const destMarkerRef = useRef<any>(null);
  const destLabelMarkerRef = useRef<any>(null); // customer-name pill above the home pin
  const lineRef = useRef<any>(null);
  const trafficRef = useRef<any>(null);
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
  const gStepsRef = useRef<any[]>([]); // raw google steps (with .path/.end_location)
  const navStepsRef = useRef<NavStep[]>([]);
  const stepIdxRef = useRef(0);
  const offRouteCount = useRef(0);
  const reroutingRef = useRef(false);
  const arrivedRef = useRef(false);
  const zoomBucket = useRef(0);
  const cb = useRef({ onRoute, onStep, onGuidance, onArrival, onReroute });
  cb.current = { onRoute, onStep, onGuidance, onArrival, onReroute };

  // Init map + 60fps interpolation loop.
  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(divRef.current, {
      center: position ?? destination ?? { lat: 28.6139, lng: 77.209 },
      zoom: 16, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
      backgroundColor: "#0b1220", styles: DARK,
    });
    // Live congestion on every road — the partner sees WHY a route was chosen.
    trafficRef.current = new g.maps.TrafficLayer();
    trafficRef.current.setMap(mapRef.current);

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
      if (document.hidden) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }
      const gg = (window as any).google;
      const m = markerRef.current;
      if (m && targetPos.current) {
        const rp = renderPos.current ?? targetPos.current;
        const next = { lat: rp.lat + (targetPos.current.lat - rp.lat) * 0.18, lng: rp.lng + (targetPos.current.lng - rp.lng) * 0.18 };
        renderPos.current = next; m.setPosition(next);
        coneRef.current?.setPosition(next);
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
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Destination marker — branded "home" pin + customer-name tag above it.
  useEffect(() => {
    if (!loaded || !mapRef.current || !destination) return;
    const g = (window as any).google;
    if (!destMarkerRef.current) destMarkerRef.current = new g.maps.Marker({ map: mapRef.current, position: destination, icon: homePinIcon(g), zIndex: 10 });
    else destMarkerRef.current.setPosition(destination);
    if (destLabel) {
      if (!destLabelMarkerRef.current) {
        destLabelMarkerRef.current = new g.maps.Marker({
          map: mapRef.current, position: destination, clickable: false,
          icon: namePillIcon(g, destLabel, 26), zIndex: 11, optimized: false,
        });
      } else {
        destLabelMarkerRef.current.setPosition(destination);
        destLabelMarkerRef.current.setIcon(namePillIcon(g, destLabel, 26));
      }
    } else if (destLabelMarkerRef.current) {
      destLabelMarkerRef.current.setMap(null);
      destLabelMarkerRef.current = null;
    }
  }, [loaded, destination?.lat, destination?.lng, destLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Partner GPS fix → Kalman → guidance (steps/off-route/camera) + route + arrival.
  useEffect(() => {
    if (!loaded || !mapRef.current || !position) return;
    const g = (window as any).google;
    const f = kalman.current.update(position, accuracy ?? 15);
    targetPos.current = f.position;
    if (f.headingDeg != null) targetHeading.current = f.headingDeg;
    const speedKmh = Math.round(f.speedMps * 3.6);

    if (!markerRef.current) {
      renderPos.current = f.position; renderHeading.current = f.headingDeg ?? 0; lastConeHeading.current = f.headingDeg ?? 0;
      coneRef.current = new g.maps.Marker({ map: mapRef.current, position: f.position, clickable: false, icon: headingConeIcon(g, f.headingDeg ?? 0), zIndex: 998, optimized: false });
      const face = headingFacesRight(f.headingDeg ?? 0, null) ?? false;
      facingRightRef.current = face;
      markerRef.current = new g.maps.Marker({
        map: mapRef.current, position: f.position, zIndex: 999, optimized: false,
        icon: riderUriRef.current ? riderPuckIcon(g, riderUriRef.current, face) : fallbackPuckIcon(g),
      });
    }
    // Camera follows the rider (Uber nav feel).
    mapRef.current.panTo(f.position);

    if (destination) {
      // Arrival detection (within ~80m, once).
      const distM = haversineM(f.position, destination);
      if (distM < 80 && !arrivedRef.current) { arrivedRef.current = true; cb.current.onArrival?.(); }
      if (distM >= 120) arrivedRef.current = false;

      // ---- LIVE guidance against the exact Google route ----
      const gSteps = gStepsRef.current;
      if (gSteps.length) {
        // Current step = the step whose polyline is closest to the rider.
        let bestStep = stepIdxRef.current, bestD = Infinity;
        for (let i = 0; i < gSteps.length; i++) {
          const d = distToPathM(f.position, gSteps[i].path ?? []);
          if (d < bestD) { bestD = d; bestStep = i; }
        }
        // Never jump backwards on GPS noise; only move back if clearly closer there.
        if (bestStep < stepIdxRef.current && bestD > 20) bestStep = stepIdxRef.current;
        stepIdxRef.current = bestStep;

        const cur = gSteps[bestStep];
        let distToTurn = cur?.end_location
          ? haversineM(f.position, { lat: cur.end_location.lat(), lng: cur.end_location.lng() })
          : null;
        // Passed the maneuver point → advance to the next instruction.
        if (distToTurn != null && distToTurn < STEP_ADVANCE_M && bestStep < gSteps.length - 1) {
          stepIdxRef.current = bestStep + 1;
          const nx = gSteps[bestStep + 1];
          distToTurn = nx?.end_location
            ? haversineM(f.position, { lat: nx.end_location.lat(), lng: nx.end_location.lng() })
            : null;
        }

        // Off-route: far from EVERY step polyline for consecutive fixes → instant reroute.
        const offRoute = bestD > OFF_ROUTE_M;
        offRouteCount.current = offRoute ? offRouteCount.current + 1 : 0;
        if (offRouteCount.current >= OFF_ROUTE_FIXES && !reroutingRef.current) {
          reroutingRef.current = true;
          offRouteCount.current = 0;
          drawRoute(g, mapRef.current, lineRef, gStepsRef, navStepsRef, stepIdxRef, f.position, destination, cb.current, () => { reroutingRef.current = false; });
          cb.current.onReroute?.();
        }

        const idx = stepIdxRef.current;
        cb.current.onGuidance?.({
          steps: navStepsRef.current,
          stepIndex: idx,
          distToTurnM: distToTurn != null ? Math.round(distToTurn) : null,
          speedKmh,
          offRoute: offRouteCount.current > 0 || reroutingRef.current,
        });
        cb.current.onStep?.(navStepsRef.current[idx] ?? null);

        // Speed/turn-adaptive camera: zoom into maneuvers, out on fast straights.
        const bucket = distToTurn != null && distToTurn < 180 ? 3 : speedKmh > 45 ? 1 : 2;
        if (bucket !== zoomBucket.current) {
          zoomBucket.current = bucket;
          mapRef.current.setZoom(bucket === 3 ? 17 : bucket === 1 ? 15 : 16);
        }
      }

      // Periodic traffic/ETA refresh when the rider has moved ~a city block.
      const key = `${f.position.lat.toFixed(3)},${f.position.lng.toFixed(3)}`;
      if (key !== routeKey.current && !reroutingRef.current) {
        routeKey.current = key;
        drawRoute(g, mapRef.current, lineRef, gStepsRef, navStepsRef, stepIdxRef, f.position, destination, cb.current);
      }
    }
  }, [loaded, position?.lat, position?.lng, accuracy, destination?.lat, destination?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  if (!configured || error) {
    return <div className={`flex items-center justify-center bg-slate-950 text-center text-sm text-slate-400 ${className}`}>Map unavailable</div>;
  }
  return <div ref={divRef} className={className} aria-label="Partner navigation map" />;
});

function drawRoute(
  g: any, map: any, lineRef: any, gStepsRef: any, navStepsRef: { current: NavStep[] }, stepIdxRef: { current: number },
  origin: LatLng, dest: LatLng,
  cbs: { onRoute?: (r: NavRoute) => void; onStep?: (s: NavStep | null) => void; onGuidance?: (g: NavGuidance) => void },
  onDone?: () => void,
) {
  new g.maps.DirectionsService().route(
    { origin, destination: dest, travelMode: g.maps.TravelMode.DRIVING, drivingOptions: { departureTime: new Date(), trafficModel: "bestguess" } },
    (res: any, status: string) => {
      onDone?.();
      if (status !== "OK" || !res?.routes?.[0]) return;
      const route = res.routes[0], leg = route.legs?.[0];
      const base = leg?.duration?.value ?? 0, traffic = leg?.duration_in_traffic?.value ?? base;
      const ratio = base > 0 ? traffic / base : 1;
      const level: NavRoute["trafficLevel"] = ratio > 1.4 ? "heavy" : ratio > 1.15 ? "moderate" : "light";
      const color = level === "heavy" ? "#ef4444" : level === "moderate" ? "#f59e0b" : "#22c55e";
      if (lineRef.current) lineRef.current.setMap(null);
      lineRef.current = new g.maps.Polyline({ map, path: route.overview_path, geodesic: true, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 6, icons: [{ icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.4, fillColor: "#fff", fillOpacity: 1, strokeColor: color, strokeWeight: 1 }, offset: "0%", repeat: "90px" }], zIndex: 5 });

      // Fresh route ⇒ fresh step list; guidance restarts from step 0.
      const steps = leg?.steps ?? [];
      gStepsRef.current = steps;
      stepIdxRef.current = 0;
      navStepsRef.current = steps.map((s: any): NavStep => ({
        instruction: String(s.instructions ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        maneuver: s.maneuver || "straight",
        distanceText: s.distance?.text ?? "",
        distanceM: s.distance?.value ?? 0,
      }));
      cbs.onStep?.(navStepsRef.current[0] ?? null);
      cbs.onRoute?.({
        distanceKm: leg?.distance?.value ? Math.round((leg.distance.value / 1000) * 10) / 10 : 0,
        distanceText: leg?.distance?.text ?? "",
        etaMin: Math.max(1, Math.round((traffic || base) / 60)),
        durationText: leg?.duration_in_traffic?.text ?? leg?.duration?.text ?? "",
        trafficLevel: level,
        summary: String(route.summary ?? ""),
      });
    },
  );
}

/** Min straight-line metres from a point to a step polyline (vertex-sampled — ample for 50 m gates). */
function distToPathM(p: LatLng, path: Array<{ lat: () => number; lng: () => number }>): number {
  let best = Infinity;
  for (const v of path) {
    const d = haversineM(p, { lat: v.lat(), lng: v.lng() });
    if (d < best) best = d;
  }
  return best;
}

function haversineM(a: LatLng, b: LatLng) { const R = 6371000, t = (d: number) => (d * Math.PI) / 180; const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2; return R * 2 * Math.asin(Math.sqrt(s)); }

/* ---------------- HOMEEIGO rider marker system (same design as customer map) ---------------- */

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

/** The source photo faces left; flip to face right when clearly eastbound (with hysteresis). */
function headingFacesRight(heading: number, current: boolean | null): boolean | null {
  const h = ((heading % 360) + 360) % 360;
  if (h > 20 && h < 160) return true;
  if (h > 200 && h < 340) return false;
  return current;
}

const riderIconCache = new Map<string, string>();
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
  return { url, scaledSize: new g.maps.Size(92, 92), anchor: new g.maps.Point(46, 46) };
}

/**
 * Floating dark-glass name pill with a pointer notch (customer name above the
 * home pin / rider tags). Cached per text; `dropPx` sets how far above the
 * anchored point the pill floats.
 */
const namePillCache = new Map<string, { url: string; w: number; h: number }>();
function namePillIcon(g: any, text: string, dropPx = 42) {
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
    <rect x="1.5" y="1.5" width="${w - 3}" height="27" rx="13.5" fill="#0f172a" fill-opacity="0.94" stroke="#10b981" stroke-width="1.6"/>
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
    anchor: new g.maps.Point(entry.w / 2, entry.h + dropPx),
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

const DARK = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
];
