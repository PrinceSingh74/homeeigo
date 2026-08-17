"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Layers, MapPin } from "lucide-react";
import { useGoogleMapsLoader, mapsLoadErrorHint } from "@/hooks/use-google-maps-loader";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import {
  BookingMarker,
  GeofenceMarker,
  ProviderMarker,
  type MapBounds,
} from "@/components/operations/OpsMapMarkers";
import type { OpsMapData } from "@/services/admin-api";

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

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "#10b981",
  BUSY: "#f59e0b",
  OFFLINE: "#94a3b8",
};

const MARKER_CAP = 80;

type LayerKey = "providers" | "bookings" | "zones";

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

function sample<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const step = items.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i += 1) out.push(items[Math.floor(i * step)]!);
  return out;
}

function boundsOf(pts: { lat: number; lng: number }[]): MapBounds {
  if (pts.length === 0) return { minLat: 8, maxLat: 37, minLng: 68, maxLng: 97 };
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.02;
  return {
    minLat: Math.min(...lats) - pad,
    maxLat: Math.max(...lats) + pad,
    minLng: Math.min(...lngs) - pad,
    maxLng: Math.max(...lngs) + pad,
  };
}

function dataFingerprint(data: OpsMapData): string {
  return [
    data.providers.map((p) => `${p.providerId}:${p.status}:${p.lat.toFixed(4)}`).join("|"),
    data.bookings.map((b) => `${b.bookingId}:${b.status}:${b.lat.toFixed(4)}`).join("|"),
    data.geofences.map((g) => g.id).join("|"),
  ].join("::");
}

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: "providers", label: "Providers" },
  { key: "bookings", label: "Bookings" },
  { key: "zones", label: "Zones" },
];

function OpsTacticalCanvas({ data, light }: { data: OpsMapData; light: boolean }) {
  const allPoints = useMemo(
    () => [...(data.providers ?? []), ...(data.bookings ?? [])],
    [data.providers, data.bookings],
  );
  const b = useMemo(() => boundsOf(allPoints), [allPoints]);
  const geofences = useMemo(() => sample(data.geofences ?? [], MARKER_CAP), [data.geofences]);
  const bookings = useMemo(() => sample(data.bookings ?? [], MARKER_CAP), [data.bookings]);
  const providers = useMemo(() => sample(data.providers ?? [], MARKER_CAP), [data.providers]);

  return (
    <div
      className="ops-tactical-canvas absolute inset-0"
      data-theme-map={light ? "light" : "dark"}
      style={{
        backgroundColor: light ? "#eefaf3" : "#0b1220",
        backgroundImage: light
          ? "radial-gradient(circle at 50% 38%, rgba(16,185,129,0.14), transparent 58%), linear-gradient(rgba(6,95,70,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(6,95,70,0.08) 1px, transparent 1px)"
          : "radial-gradient(circle at 50% 40%, rgba(56,189,248,0.10), transparent 60%), linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)",
        backgroundSize: "100% 100%, 40px 40px, 40px 40px",
      }}
    >
      {geofences.map((g) => (
        <GeofenceMarker
          key={g.id}
          id={g.id}
          name={g.name}
          centerLat={g.centerLat}
          centerLng={g.centerLng}
          bounds={b}
        />
      ))}
      {bookings.map((bk) => (
        <BookingMarker
          key={bk.bookingId}
          bookingId={bk.bookingId}
          status={bk.status}
          lat={bk.lat}
          lng={bk.lng}
          bounds={b}
        />
      ))}
      {providers.map((p) => (
        <ProviderMarker
          key={p.providerId}
          providerId={p.providerId}
          name={p.name}
          status={p.status}
          lat={p.lat}
          lng={p.lng}
          bounds={b}
        />
      ))}
      {allPoints.length === 0 ? (
        <div className="grid h-full place-items-center text-sm" style={{ color: "var(--cmd-muted)" }}>
          No live providers or bookings on the map.
        </div>
      ) : null}
    </div>
  );
}

function OpsGoogleMap({ data, light }: { data: OpsMapData; light: boolean }) {
  const { loaded, error, configured } = useGoogleMapsLoader();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const fittedRef = useRef(false);
  const [layers, setLayers] = useState<Set<LayerKey>>(new Set(["providers", "bookings", "zones"]));
  const fp = useMemo(() => dataFingerprint(data), [data]);
  const layerKey = useMemo(() => [...layers].sort().join(","), [layers]);

  const providers = useMemo(() => sample(data.providers ?? [], MARKER_CAP), [data.providers]);
  const bookings = useMemo(() => sample(data.bookings ?? [], MARKER_CAP), [data.bookings]);
  const geofences = useMemo(() => sample(data.geofences ?? [], MARKER_CAP), [data.geofences]);

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(divRef.current, {
      center: { lat: 28.61, lng: 77.21 },
      zoom: 10,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: g.maps.ControlPosition.RIGHT_BOTTOM },
      backgroundColor: light ? "#eefaf3" : "#0b1220",
      styles: light ? LIGHT_STYLE : DARK_STYLE,
      minZoom: 4,
    });
  }, [loaded, light]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      backgroundColor: light ? "#eefaf3" : "#0b1220",
      styles: light ? LIGHT_STYLE : DARK_STYLE,
    });
  }, [light]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const g = (window as any).google;
    const map = mapRef.current;
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const stroke = light ? "#ffffff" : "#0b1220";
    const fence = light ? "#0f766e" : "#38bdf8";
    const add = (o: any) => overlaysRef.current.push(o);
    const extent = new g.maps.LatLngBounds();
    let plotted = 0;

    if (layers.has("zones")) {
      for (const zone of geofences) {
        add(
          new g.maps.Circle({
            map,
            center: { lat: zone.centerLat, lng: zone.centerLng },
            radius: Math.max(zone.radiusMeters || 1200, 400),
            fillColor: fence,
            fillOpacity: light ? 0.08 : 0.1,
            strokeColor: fence,
            strokeOpacity: 0.55,
            strokeWeight: 1.4,
          }),
        );
        extent.extend({ lat: zone.centerLat, lng: zone.centerLng });
        plotted += 1;
      }
    }

    if (layers.has("bookings")) {
      for (const booking of bookings) {
        add(
          new g.maps.Marker({
            map,
            position: { lat: booking.lat, lng: booking.lng },
            title: `Booking ${booking.status}`,
            icon: {
              path: "M 0,-7 L 6,0 L 0,7 L -6,0 z",
              fillColor: light ? "#0f766e" : "#38bdf8",
              fillOpacity: 0.95,
              strokeColor: stroke,
              strokeWeight: 1.2,
              scale: 1,
            },
            zIndex: 20,
          }),
        );
        extent.extend({ lat: booking.lat, lng: booking.lng });
        plotted += 1;
      }
    }

    if (layers.has("providers")) {
      for (const provider of providers) {
        const color = STATUS_COLOR[provider.status] ?? STATUS_COLOR.OFFLINE;
        add(
          new g.maps.Marker({
            map,
            position: { lat: provider.lat, lng: provider.lng },
            title: `${provider.name} · ${provider.status}`,
            icon: {
              path: g.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: color,
              fillOpacity: 0.95,
              strokeColor: stroke,
              strokeWeight: 1.6,
            },
            zIndex: 30,
          }),
        );
        extent.extend({ lat: provider.lat, lng: provider.lng });
        plotted += 1;
      }
    }

    if (!fittedRef.current && plotted > 0 && !extent.isEmpty()) {
      map.fitBounds(extent, 56);
      fittedRef.current = true;
    }
  }, [loaded, fp, layerKey, light, providers, bookings, geofences, layers]);

  const toggle = (key: LayerKey) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!configured || error) {
    return (
      <>
        <OpsTacticalCanvas data={data} light={light} />
        {error ? (
          <p className="pointer-events-none absolute bottom-12 left-3 z-10 max-w-sm text-[11px]" style={{ color: "var(--cmd-muted)" }}>
            {mapsLoadErrorHint(error)}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div ref={divRef} className="absolute inset-0" aria-label="Live operations map" />
      {!loaded ? (
        <div className="absolute inset-0 grid place-items-center text-sm" style={{ background: "var(--cmd-card)", color: "var(--cmd-muted)" }}>
          Loading live map…
        </div>
      ) : null}
      <div className="cmd-layer-bar absolute left-3 top-3 z-10">
        <span className="cmd-layer-kicker">
          <Layers size={12} /> Layers
        </span>
        {LAYERS.map((layer) => (
          <button
            key={layer.key}
            type="button"
            onClick={() => toggle(layer.key)}
            className={`cmd-layer-btn${layers.has(layer.key) ? " is-on" : ""}`}
          >
            {layer.label}
          </button>
        ))}
      </div>
    </>
  );
}

function OpsLiveMapInner({ data }: { data: OpsMapData }) {
  useRenderProbe("OpsLiveMap");
  useMountProbe("OpsLiveMap");
  const theme = useDocumentTheme();
  const light = theme === "light";
  const units = (data.providers?.length ?? 0) + (data.bookings?.length ?? 0);

  return (
    <div className="cmd-card cmd-map-frame ops-live-map">
      <OpsGoogleMap data={data} light={light} />

      <div className="cmd-map-chip absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="cmd-live-dot" aria-hidden />
          {units} units
        </span>
        <span className="flex items-center gap-1.5">
          <Circle size={9} fill="#10b981" className="text-emerald-500" /> Online
        </span>
        <span className="flex items-center gap-1.5">
          <Circle size={9} fill="#f59e0b" className="text-amber-500" /> Busy
        </span>
        <span className="flex items-center gap-1.5">
          <Circle size={9} fill="#94a3b8" className="text-slate-400" /> Offline
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rotate-45 bg-teal-600" /> Booking
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin size={11} /> Zone
        </span>
      </div>
    </div>
  );
}

export const OpsLiveMap = memo(OpsLiveMapInner, (prev, next) => dataFingerprint(prev.data) === dataFingerprint(next.data));
