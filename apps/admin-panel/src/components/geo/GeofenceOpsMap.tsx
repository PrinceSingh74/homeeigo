"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Hexagon, Layers, LocateFixed, X } from "lucide-react";
import { mapsLoadErrorHint, useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { googleMapTypeId, MapBasemapBar, type BasemapId } from "@/components/geo/MapBasemapBar";
import type { Geofence } from "@/services/admin-api";

type LatLng = { lat: number; lng: number };

export type GeofenceDraft =
  | { shape: "CIRCLE"; centerLat: number; centerLng: number; radiusMeters: number }
  | { shape: "POLYGON"; polygon: Array<LatLng>; centerLat: number; centerLng: number; radiusMeters: number };

export type GeofencePreview = {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  visible: boolean;
};

export type DrawMode = "none" | "circle" | "polygon";

export const ZONE_PALETTE: Record<string, { light: string; dark: string; label: string }> = {
  SERVICE_ZONE: { light: "#0f766e", dark: "#2dd4bf", label: "Service" },
  SOCIETY: { light: "#b45309", dark: "#fbbf24", label: "Society" },
  PREMIUM_AREA: { light: "#6d28d9", dark: "#c4b5fd", label: "Premium" },
  CITY: { light: "#0369a1", dark: "#38bdf8", label: "City" },
};

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

function zoneColor(zoneType: string, light: boolean) {
  const pal = ZONE_PALETTE[zoneType] ?? ZONE_PALETTE.SERVICE_ZONE!;
  return light ? pal.light : pal.dark;
}

function zonesFingerprint(zones: Geofence[], selectedId: string | null): string {
  return `${selectedId ?? ""}|${zones.map((z) => `${z.id}:${z.zoneType}:${z.isActive}:${z.centerLat}:${z.centerLng}:${z.radiusMeters}:${z.shape}`).join("|")}`;
}

function radiusToZoom(meters: number) {
  if (meters > 20_000) return 10;
  if (meters > 8_000) return 11;
  if (meters > 2_500) return 12;
  if (meters > 900) return 13;
  if (meters > 400) return 14;
  return 15;
}

function GeofenceOpsMapInner({
  zones,
  selectedId,
  preview,
  drawMode: drawModeProp,
  onDrawModeChange,
  onSelect,
  onDraft,
  onPickCenter,
  className = "geo-map-frame",
}: {
  zones: Geofence[];
  selectedId: string | null;
  preview?: GeofencePreview;
  drawMode?: DrawMode;
  onDrawModeChange?: (mode: DrawMode) => void;
  onSelect: (id: string) => void;
  onDraft: (d: GeofenceDraft) => void;
  onPickCenter?: (p: LatLng) => void;
  className?: string;
}) {
  const theme = useDocumentTheme();
  const light = theme === "light";
  const { loaded, error, configured } = useGoogleMapsLoader();
  const [initError, setInitError] = useState<string | null>(null);
  const [localDraw, setLocalDraw] = useState<DrawMode>("none");
  const [polygonPoints, setPolygonPoints] = useState(0);
  const [basemap, setBasemap] = useState<BasemapId>("map");
  const drawMode = drawModeProp ?? localDraw;
  const setDrawMode = useCallback(
    (next: DrawMode | ((prev: DrawMode) => DrawMode)) => {
      const resolved = typeof next === "function" ? next(drawModeProp ?? localDraw) : next;
      setLocalDraw(resolved);
      onDrawModeChange?.(resolved);
    },
    [drawModeProp, localDraw, onDrawModeChange],
  );

  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const shapesRef = useRef<Array<{ id: string; shape: any; listener: any }>>([]);
  const previewRef = useRef<any>(null);
  const formPreviewRef = useRef<any>(null);
  const listenersRef = useRef<any[]>([]);
  const circleCenterRef = useRef<any>(null);
  const polygonDraftRef = useRef<any[]>([]);
  const fittedRef = useRef(false);
  const onDraftRef = useRef(onDraft);
  const onSelectRef = useRef(onSelect);
  const onPickCenterRef = useRef(onPickCenter);
  onDraftRef.current = onDraft;
  onSelectRef.current = onSelect;
  onPickCenterRef.current = onPickCenter;

  const circleStroke = light ? "#0f766e" : "#5eead4";
  const polygonStroke = light ? "#6d28d9" : "#c4b5fd";

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
  }, [clearListeners, clearPreview, setDrawMode]);

  const finishPolygon = useCallback(() => {
    const g = getGoogle();
    const points = polygonDraftRef.current;
    if (!g || points.length < 3) return;
    const path = points.map(latLngToObj);
    const metrics = polygonMetrics(g, path);
    onDraftRef.current({ shape: "POLYGON", polygon: path, ...metrics });
    cancelDraw();
  }, [cancelDraw]);

  const fitAll = useCallback(() => {
    const g = getGoogle();
    const map = mapRef.current;
    if (!g || !map || zones.length === 0) return;
    const bounds = new g.maps.LatLngBounds();
    for (const z of zones) {
      bounds.extend({ lat: z.centerLat, lng: z.centerLng });
      const pad = Math.max(z.radiusMeters, 400) / 111_320;
      bounds.extend({ lat: z.centerLat + pad, lng: z.centerLng + pad });
      bounds.extend({ lat: z.centerLat - pad, lng: z.centerLng - pad });
    }
    map.fitBounds(bounds, 48);
  }, [zones]);

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
            fillOpacity: 0.16,
            strokeColor: circleStroke,
            strokeWeight: 2,
            clickable: false,
          });
          return;
        }
        const radius = g.maps.geometry.spherical.computeDistanceBetween(circleCenterRef.current, e.latLng);
        if (radius < 50) return;
        const center = latLngToObj(circleCenterRef.current);
        onDraftRef.current({
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
            fillOpacity: 0.16,
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

  const zoneKey = useMemo(() => zonesFingerprint(zones, selectedId), [zones, selectedId]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const g = getGoogle();
    if (!g) return;

    try {
      shapesRef.current.forEach((s) => {
        s.listener?.remove();
        s.shape.setMap(null);
      });
      shapesRef.current = [];

      for (const z of zones) {
        const color = zoneColor(z.zoneType, light);
        const on = selectedId === z.id;
        const active = z.isActive;
        const opts = {
          fillColor: color,
          fillOpacity: on ? (light ? 0.22 : 0.28) : active ? (light ? 0.1 : 0.14) : 0.04,
          strokeColor: color,
          strokeWeight: on ? 3.5 : 2,
          strokeOpacity: active ? 1 : 0.45,
          map: mapRef.current,
          zIndex: on ? 20 : 4,
          clickable: drawMode === "none",
        };
        const shape =
          z.shape === "POLYGON" && Array.isArray(z.polygon) && z.polygon.length >= 3
            ? new g.maps.Polygon({ ...opts, paths: z.polygon })
            : new g.maps.Circle({ ...opts, center: { lat: z.centerLat, lng: z.centerLng }, radius: z.radiusMeters });
        const listener = shape.addListener("click", () => onSelectRef.current(z.id));
        shapesRef.current.push({ id: z.id, shape, listener });
      }

      if (!fittedRef.current && zones.length > 0) {
        fittedRef.current = true;
        fitAll();
      }
    } catch (e) {
      setInitError(e instanceof Error ? e.message : "zone_render_failed");
    }
  }, [loaded, zoneKey, zones, light, selectedId, drawMode, fitAll]);

  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const z = zonesRef.current.find((x) => x.id === selectedId);
    if (!z) return;
    map.panTo({ lat: z.centerLat, lng: z.centerLng });
    map.setZoom(radiusToZoom(z.radiusMeters));
  }, [selectedId]);

  useEffect(() => {
    const g = getGoogle();
    const map = mapRef.current;
    if (!g || !map) return;
    formPreviewRef.current?.setMap(null);
    formPreviewRef.current = null;
    if (!preview?.visible || drawMode !== "none") return;
    formPreviewRef.current = new g.maps.Circle({
      map,
      center: { lat: preview.centerLat, lng: preview.centerLng },
      radius: Math.max(50, preview.radiusMeters),
      fillColor: circleStroke,
      fillOpacity: 0.08,
      strokeColor: circleStroke,
      strokeWeight: 2,
      strokeOpacity: 0.9,
      clickable: false,
      zIndex: 30,
    });
  }, [preview?.visible, preview?.centerLat, preview?.centerLng, preview?.radiusMeters, drawMode, circleStroke, loaded]);

  useEffect(() => {
    if (!loaded || !mapRef.current || drawMode !== "none") return;
    const map = mapRef.current;
    const listener = map.addListener("click", (e: any) => {
      const ll = latLngToObj(e.latLng);
      onPickCenterRef.current?.(ll);
    });
    return () => listener.remove();
  }, [loaded, drawMode]);

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
      ? "Click centre, then the edge to set radius · Esc to cancel"
      : drawMode === "polygon"
        ? `${polygonPoints} vertices · Finish when ≥ 3 · Esc to cancel`
        : "Click a zone to inspect · click empty map to place a new centre";

  return (
    <div className={`cmd-card cmd-map-frame geo-map-frame relative ${className}`}>
      <div
        ref={divRef}
        className={`absolute inset-0 ${drawMode !== "none" ? "cursor-crosshair" : ""}`}
        aria-label="Geofence operations map"
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
        <button type="button" onClick={fitAll} className="cmd-layer-btn" aria-label="Fit all zones">
          <LocateFixed size={13} />
          Fit
        </button>
      </div>

      <MapBasemapBar value={basemap} onChange={setBasemap} />

      {drawMode !== "none" ? (
        <div className="gf-draw-banner absolute inset-x-3 bottom-14 z-20 mx-auto max-w-md">
          <span className="gf-draw-banner__pulse" aria-hidden />
          {drawMode === "circle" ? "Click the centre, then the edge" : "Click vertices · Finish when ≥ 3"}
        </div>
      ) : null}

      <div className="cmd-map-chip absolute bottom-3 left-3 z-10 max-w-[min(100%,28rem)] text-[11px]">{drawHint}</div>

      <div className="cmd-map-chip absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-2.5">
        {Object.entries(ZONE_PALETTE).map(([key, pal]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: light ? pal.light : pal.dark }} />
            {pal.label}
          </span>
        ))}
      </div>

      {!loaded ? (
        <div
          className="absolute inset-0 grid place-items-center text-sm"
          style={{ background: "var(--cmd-card)", color: "var(--cmd-muted)" }}
        >
          Loading zone map…
        </div>
      ) : null}
    </div>
  );
}

export const GeofenceOpsMap = memo(GeofenceOpsMapInner, (prev, next) =>
  prev.className === next.className &&
  prev.selectedId === next.selectedId &&
  prev.drawMode === next.drawMode &&
  prev.preview?.visible === next.preview?.visible &&
  prev.preview?.centerLat === next.preview?.centerLat &&
  prev.preview?.centerLng === next.preview?.centerLng &&
  prev.preview?.radiusMeters === next.preview?.radiusMeters &&
  zonesFingerprint(prev.zones, prev.selectedId) === zonesFingerprint(next.zones, next.selectedId) &&
  prev.onDraft === next.onDraft &&
  prev.onSelect === next.onSelect &&
  prev.onPickCenter === next.onPickCenter &&
  prev.onDrawModeChange === next.onDrawModeChange,
);
