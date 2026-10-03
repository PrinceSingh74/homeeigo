"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Hexagon, Layers, X } from "lucide-react";
import { mapsLoadErrorHint, useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { googleMapTypeId, MapBasemapBar, type BasemapId } from "@/components/geo/MapBasemapBar";
import type { Geofence } from "@/services/admin-api";

type LatLng = { lat: number; lng: number };

type DrawResult =
  | { shape: "CIRCLE"; centerLat: number; centerLng: number; radiusMeters: number }
  | { shape: "POLYGON"; polygon: Array<LatLng>; centerLat: number; centerLng: number; radiusMeters: number };

type DrawMode = "none" | "circle" | "polygon";

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#334155" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#060b15" }] },
];

const LIGHT_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#eefaf3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#3d5249" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d7eee3" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#c5ddd0" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#7aa38f" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c6ebe0" }] },
];

function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function getGoogle(): any | null {
  const g = (window as Window & { google?: any }).google;
  if (!g?.maps || typeof g.maps.Map !== "function") return null;
  return g;
}

function latLngToObj(ll: { lat: () => number; lng: () => number }): LatLng {
  return { lat: ll.lat(), lng: ll.lng() };
}

function polygonMetrics(g: any, path: LatLng[]) {
  const centerLat = path.reduce((s, p) => s + p.lat, 0) / path.length;
  const centerLng = path.reduce((s, p) => s + p.lng, 0) / path.length;
  const radiusMeters = Math.max(
    ...path.map((p) =>
      g.maps.geometry.spherical.computeDistanceBetween(
        new g.maps.LatLng(centerLat, centerLng),
        new g.maps.LatLng(p.lat, p.lng),
      ),
    ),
    100,
  );
  return { centerLat, centerLng, radiusMeters: Math.round(radiusMeters) };
}

function zonesFingerprint(zones: Geofence[]): string {
  return zones.map((z) => `${z.id}:${z.surgeMultiplier ?? 1}:${z.centerLat}:${z.centerLng}`).join("|");
}

function surgeColor(surge: number, light: boolean) {
  if (surge >= 1.3) return light ? "#b91c1c" : "#ef4444";
  if (surge > 1) return light ? "#b45309" : "#f59e0b";
  return light ? "#047857" : "#10b981";
}

function GeospatialMapInner({
  zones,
  onDraw,
  className = "geo-map-frame",
}: {
  zones: Geofence[];
  onDraw: (d: DrawResult) => void;
  className?: string;
}) {
  const theme = useDocumentTheme();
  const light = theme === "light";
  const { loaded, error, configured } = useGoogleMapsLoader();
  const [initError, setInitError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [basemap, setBasemap] = useState<BasemapId>("map");
  const [polygonPoints, setPolygonPoints] = useState(0);

  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const shapesRef = useRef<any[]>([]);
  const previewRef = useRef<any>(null);
  const listenersRef = useRef<any[]>([]);
  const circleCenterRef = useRef<any>(null);
  const polygonDraftRef = useRef<any[]>([]);
  const onDrawRef = useRef(onDraw);
  onDrawRef.current = onDraw;

  const circleStroke = light ? "#0f766e" : "#38bdf8";
  const polygonStroke = light ? "#6d28d9" : "#a78bfa";

  const clearListeners = useCallback(() => {
    listenersRef.current.forEach((l) => l.remove());
    listenersRef.current = [];
  }, []);

  const clearPreview = useCallback(() => {
    previewRef.current?.setMap(null);
    previewRef.current = null;
    circleCenterRef.current = null;
    polygonDraftRef.current = [];
    setPolygonPoints(0);
  }, []);

  const cancelDraw = useCallback(() => {
    clearListeners();
    clearPreview();
    setDrawMode("none");
  }, [clearListeners, clearPreview]);

  const finishPolygon = useCallback(() => {
    const g = getGoogle();
    const points = polygonDraftRef.current;
    if (!g || points.length < 3) return;

    const path = points.map(latLngToObj);
    const metrics = polygonMetrics(g, path);
    onDrawRef.current({ shape: "POLYGON", polygon: path, ...metrics });
    cancelDraw();
  }, [cancelDraw]);

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;

    const g = getGoogle();
    if (!g) {
      setInitError("maps_not_ready");
      return;
    }

    try {
      mapRef.current = new g.maps.Map(divRef.current, {
        center: { lat: 28.5355, lng: 77.291 },
        zoom: 10,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        backgroundColor: light ? "#eefaf3" : "#0b1220",
        styles: light ? LIGHT_STYLE : DARK_STYLE,
        minZoom: 5,
        mapTypeId: g.maps.MapTypeId.ROADMAP,
      });
      setInitError(null);
    } catch (e) {
      setInitError(e instanceof Error ? e.message : "map_init_failed");
    }
  }, [loaded, light]);

  useEffect(() => {
    const g = getGoogle();
    if (!mapRef.current || !g) return;
    const styled = basemap === "map";
    mapRef.current.setMapTypeId(googleMapTypeId(g, basemap));
    mapRef.current.setOptions({
      backgroundColor: styled ? (light ? "#eefaf3" : "#0b1220") : "#0b1220",
      styles: styled ? (light ? LIGHT_STYLE : DARK_STYLE) : [],
    });
  }, [light, basemap]);

  useEffect(() => {
    if (!loaded || !mapRef.current || drawMode === "none") {
      clearListeners();
      clearPreview();
      return;
    }

    const g = getGoogle();
    const map = mapRef.current;
    if (!g) return;

    clearListeners();
    clearPreview();

    if (drawMode === "circle") {
      const clickListener = map.addListener("click", (e: any) => {
        if (!circleCenterRef.current) {
          circleCenterRef.current = e.latLng;
          previewRef.current = new g.maps.Circle({
            map,
            center: e.latLng,
            radius: 1,
            fillColor: circleStroke,
            fillOpacity: 0.14,
            strokeColor: circleStroke,
            strokeWeight: 2,
            clickable: false,
          });
          return;
        }

        const radius = g.maps.geometry.spherical.computeDistanceBetween(circleCenterRef.current, e.latLng);
        if (radius < 50) return;

        const center = latLngToObj(circleCenterRef.current);
        onDrawRef.current({
          shape: "CIRCLE",
          centerLat: center.lat,
          centerLng: center.lng,
          radiusMeters: Math.round(radius),
        });
        cancelDraw();
      });

      const moveListener = map.addListener("mousemove", (e: any) => {
        if (!circleCenterRef.current || !previewRef.current) return;
        const radius = g.maps.geometry.spherical.computeDistanceBetween(circleCenterRef.current, e.latLng);
        previewRef.current.setRadius(Math.max(radius, 1));
      });

      listenersRef.current = [clickListener, moveListener];
    }

    if (drawMode === "polygon") {
      const clickListener = map.addListener("click", (e: any) => {
        polygonDraftRef.current.push(e.latLng);
        setPolygonPoints(polygonDraftRef.current.length);

        if (!previewRef.current) {
          previewRef.current = new g.maps.Polygon({
            map,
            paths: polygonDraftRef.current,
            fillColor: polygonStroke,
            fillOpacity: 0.14,
            strokeColor: polygonStroke,
            strokeWeight: 2,
            clickable: false,
          });
        } else {
          previewRef.current.setPath(polygonDraftRef.current);
        }
      });

      const moveListener = map.addListener("mousemove", (e: any) => {
        if (polygonDraftRef.current.length === 0 || !previewRef.current) return;
        previewRef.current.setPath([...polygonDraftRef.current, e.latLng]);
      });

      listenersRef.current = [clickListener, moveListener];
    }

    return () => clearListeners();
  }, [loaded, drawMode, clearListeners, clearPreview, cancelDraw, circleStroke, polygonStroke]);

  useEffect(() => {
    if (drawMode === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, cancelDraw]);

  const zoneKey = useMemo(() => zonesFingerprint(zones), [zones]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    const g = getGoogle();
    if (!g) return;

    try {
      shapesRef.current.forEach((s) => s.setMap(null));
      shapesRef.current = [];

      for (const z of zones) {
        const surge = z.surgeMultiplier ?? 1;
        const color = surgeColor(surge, light);
        const opts = { fillColor: color, fillOpacity: light ? 0.1 : 0.14, strokeColor: color, strokeWeight: 2, map: mapRef.current };
        if (z.shape === "POLYGON" && Array.isArray(z.polygon) && z.polygon.length >= 3) {
          shapesRef.current.push(new g.maps.Polygon({ ...opts, paths: z.polygon }));
        } else {
          shapesRef.current.push(
            new g.maps.Circle({ ...opts, center: { lat: z.centerLat, lng: z.centerLng }, radius: z.radiusMeters }),
          );
        }
      }
    } catch (e) {
      setInitError(e instanceof Error ? e.message : "zone_render_failed");
    }
  }, [loaded, zoneKey, zones, light]);

  const showError = !configured || error || initError;

  if (showError) {
    const code = error ?? initError;
    return (
      <div
        className={`cmd-card cmd-map-frame geo-map-frame grid place-items-center p-6 text-center text-sm ${className}`}
        style={{ color: "var(--cmd-muted)" }}
      >
        <p className="font-semibold" style={{ color: "var(--cmd-ink)" }}>
          Map unavailable
        </p>
        <p className="mt-2 max-w-md text-xs leading-relaxed">
          {!configured
            ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in apps/admin-panel/.env.local and restart the dev server."
            : mapsLoadErrorHint(code)}
        </p>
      </div>
    );
  }

  const drawHint =
    drawMode === "circle"
      ? "Click center, then edge to set radius · Esc to cancel"
      : drawMode === "polygon"
        ? `${polygonPoints} vertices · Finish when ≥ 3 · Esc to cancel`
        : null;

  return (
    <div className={`cmd-card cmd-map-frame geo-map-frame relative ${className}`}>
      <div
        ref={divRef}
        className={`absolute inset-0 ${drawMode !== "none" ? "cursor-crosshair" : ""}`}
        role="region"
        aria-label="Geospatial map"
      />

      <div className="cmd-layer-bar absolute left-3 top-3 z-10">
        <span className="cmd-layer-kicker">
          <Layers size={12} /> Draw
        </span>
        <button
          type="button"
          onClick={() => setDrawMode((m) => (m === "circle" ? "none" : "circle"))}
          className={`cmd-layer-btn${drawMode === "circle" ? " is-on" : ""}`}
        >
          <Circle size={13} />
          Circle
        </button>
        <button
          type="button"
          onClick={() => setDrawMode((m) => (m === "polygon" ? "none" : "polygon"))}
          className={`cmd-layer-btn${drawMode === "polygon" ? " is-on" : ""}`}
        >
          <Hexagon size={13} />
          Polygon
        </button>
        {drawMode === "polygon" && polygonPoints >= 3 ? (
          <button type="button" onClick={finishPolygon} className="cmd-layer-btn is-on">
            Finish
          </button>
        ) : null}
        {drawMode !== "none" ? (
          <button type="button" onClick={cancelDraw} className="cmd-layer-btn" aria-label="Cancel drawing">
            <X size={13} />
          </button>
        ) : null}
      </div>

      <MapBasemapBar value={basemap} onChange={setBasemap} />

      {drawHint ? (
        <div className="cmd-map-chip absolute bottom-3 left-3 z-10 max-w-sm text-[11px]">{drawHint}</div>
      ) : (
        <div className="cmd-map-chip absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-3">
          <span>{zones.length} zones</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Stable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Surge
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Hot
          </span>
        </div>
      )}

      {!loaded ? (
        <div
          className="absolute inset-0 grid place-items-center text-sm"
          style={{ background: "var(--cmd-card)", color: "var(--cmd-muted)" }}
        >
          Loading geo map…
        </div>
      ) : null}
    </div>
  );
}

export const GeospatialMap = memo(GeospatialMapInner, (prev, next) =>
  prev.className === next.className &&
  zonesFingerprint(prev.zones) === zonesFingerprint(next.zones) &&
  prev.onDraw === next.onDraw,
);
