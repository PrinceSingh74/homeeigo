"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Hexagon, X } from "lucide-react";
import { mapsLoadErrorHint, useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import type { Geofence } from "@/services/admin-api";

type LatLng = { lat: number; lng: number };

type DrawResult =
  | { shape: "CIRCLE"; centerLat: number; centerLng: number; radiusMeters: number }
  | { shape: "POLYGON"; polygon: Array<LatLng>; centerLat: number; centerLng: number; radiusMeters: number };

type DrawMode = "none" | "circle" | "polygon";

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

/**
 * Geospatial console: renders geofences on Google Maps and supports drawing new
 * circle/polygon zones via click interactions (DrawingManager was removed in
 * Maps JS API v3.65).
 */
function GeospatialMapInner({
  zones,
  onDraw,
  className = "h-[460px] w-full rounded-2xl",
}: {
  zones: Geofence[];
  onDraw: (d: DrawResult) => void;
  className?: string;
}) {
  const { loaded, error, configured } = useGoogleMapsLoader();
  const [initError, setInitError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
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

  // Init map once.
  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;

    const g = getGoogle();
    if (!g) {
      console.error("[GeospatialMap] Map constructor unavailable after loader signaled ready");
      setInitError("maps_not_ready");
      return;
    }

    try {
      mapRef.current = new g.maps.Map(divRef.current, {
        center: { lat: 28.5355, lng: 77.291 },
        zoom: 10,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: true,
      });
      setInitError(null);
    } catch (e) {
      console.error("[GeospatialMap] map init failed:", e);
      setInitError(e instanceof Error ? e.message : "map_init_failed");
    }
  }, [loaded]);

  // Custom draw interactions (replaces deprecated DrawingManager).
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
            fillColor: "#2563eb",
            fillOpacity: 0.15,
            strokeColor: "#2563eb",
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
            fillColor: "#7c3aed",
            fillOpacity: 0.15,
            strokeColor: "#7c3aed",
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
  }, [loaded, drawMode, clearListeners, clearPreview, cancelDraw]);

  // Escape cancels draw mode.
  useEffect(() => {
    if (drawMode === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, cancelDraw]);

  const zoneKey = useMemo(() => zonesFingerprint(zones), [zones]);

  // Render existing zones.
  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    const g = getGoogle();
    if (!g) return;

    try {
      shapesRef.current.forEach((s) => s.setMap(null));
      shapesRef.current = [];

      for (const z of zones) {
        const surge = z.surgeMultiplier ?? 1;
        const color = surge >= 1.3 ? "#ef4444" : surge > 1 ? "#f59e0b" : "#10b981";
        const opts = { fillColor: color, fillOpacity: 0.12, strokeColor: color, strokeWeight: 2, map: mapRef.current };
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
  }, [loaded, zoneKey, zones]);

  const showError = !configured || error || initError;

  if (showError) {
    const code = error ?? initError;
    return (
      <div className={`flex flex-col items-center justify-center gap-2 border border-zinc-700 bg-zinc-900/40 p-4 text-center text-zinc-400 ${className}`}>
        <p className="text-sm font-medium text-zinc-200">Map unavailable</p>
        <p className="max-w-md text-xs leading-relaxed opacity-80">
          {!configured
            ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in apps/admin-panel/.env.local and restart npm run dev."
            : mapsLoadErrorHint(code)}
        </p>
      </div>
    );
  }

  const drawHint =
    drawMode === "circle"
      ? "Click center, then click edge to set radius"
      : drawMode === "polygon"
        ? `Click vertices (${polygonPoints} placed) · Finish when ≥ 3 · Esc to cancel`
        : null;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={divRef}
        className={`h-full w-full rounded-2xl ${drawMode !== "none" ? "cursor-crosshair" : ""}`}
        aria-label="Geospatial map"
      />

      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-3">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-zinc-600/80 bg-zinc-900/95 p-1.5 shadow-lg backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setDrawMode((m) => (m === "circle" ? "none" : "circle"))}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              drawMode === "circle" ? "bg-blue-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <Circle className="h-3.5 w-3.5" />
            Circle
          </button>
          <button
            type="button"
            onClick={() => setDrawMode((m) => (m === "polygon" ? "none" : "polygon"))}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              drawMode === "polygon" ? "bg-purple-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <Hexagon className="h-3.5 w-3.5" />
            Polygon
          </button>
          {drawMode === "polygon" && polygonPoints >= 3 ? (
            <button
              type="button"
              onClick={finishPolygon}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Finish
            </button>
          ) : null}
          {drawMode !== "none" ? (
            <button
              type="button"
              onClick={cancelDraw}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Cancel drawing"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {drawHint ? (
          <p className="rounded-lg bg-zinc-900/90 px-3 py-1 text-[11px] text-zinc-400 shadow">{drawHint}</p>
        ) : null}
      </div>

      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-zinc-900/80 text-sm text-zinc-500">
          Loading map…
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
