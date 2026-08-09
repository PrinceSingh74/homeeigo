"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { usePartnerTheme } from "@/components/theme/ThemeProvider";
import { mapsLoadErrorHint, useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import type { DensityZone, SurgeZone } from "@/services/partner-api";

export type HeatmapZone = SurgeZone &
  Pick<DensityZone, "centerLat" | "centerLng" | "areaKm2" | "densityPerKm2">;

type TerritoryHeatmapMapProps = {
  zones: HeatmapZone[];
  selectedZoneId?: string | null;
  onZoneSelect?: (zoneId: string) => void;
  className?: string;
};

function getGoogle(): any | null {
  const g = (window as Window & { google?: any }).google;
  return g?.maps && typeof g.maps.Map === "function" ? g : null;
}

function surgePalette(surge: number) {
  if (surge >= 2) return { fill: "#ef4444", stroke: "#b91c1c", label: "High surge" };
  if (surge >= 1.5) return { fill: "#f97316", stroke: "#c2410c", label: "Elevated" };
  if (surge >= 1.2) return { fill: "#eab308", stroke: "#a16207", label: "Moderate" };
  return { fill: "#22c55e", stroke: "#15803d", label: "Normal" };
}

function radiusMeters(areaKm2: number) {
  const fromArea = Math.sqrt(Math.max(areaKm2, 0.05) / Math.PI) * 1000;
  return Math.min(Math.max(fromArea, 450), 2800);
}

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c4a6e" }] },
];

const LIGHT_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#f8faf5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbeafe" }] },
];

export const TerritoryHeatmapMap = memo(function TerritoryHeatmapMap({
  zones,
  selectedZoneId,
  onZoneSelect,
  className = "h-[min(68vh,560px)] w-full",
}: TerritoryHeatmapMapProps) {
  const { theme } = usePartnerTheme();
  const { loaded, error, configured } = useGoogleMapsLoader();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const zonesKey = useMemo(
    () => zones.map((z) => `${z.zoneId}:${z.predictedSurge}:${z.centerLat}:${z.centerLng}`).join("|"),
    [zones],
  );

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = getGoogle();
    if (!g) {
      setInitError("maps_not_ready");
      return;
    }
    const center =
      zones.length > 0
        ? { lat: zones[0].centerLat, lng: zones[0].centerLng }
        : { lat: 28.6139, lng: 77.209 };
    try {
      mapRef.current = new g.maps.Map(divRef.current, {
        center,
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: "greedy",
        styles: theme === "dark" ? DARK_MAP_STYLES : LIGHT_MAP_STYLES,
      });
      infoRef.current = new g.maps.InfoWindow();
      setInitError(null);
    } catch (e) {
      console.error("[TerritoryHeatmapMap] init failed:", e);
      setInitError("maps_init_failed");
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setOptions({
      styles: theme === "dark" ? DARK_MAP_STYLES : LIGHT_MAP_STYLES,
    });
  }, [theme]);

  useEffect(() => {
    if (!loaded || !mapRef.current || zones.length === 0) return;
    const g = getGoogle();
    if (!g) return;

    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    const bounds = new g.maps.LatLngBounds();
    for (const zone of zones) {
      const palette = surgePalette(zone.predictedSurge);
      const circle = new g.maps.Circle({
        map: mapRef.current,
        center: { lat: zone.centerLat, lng: zone.centerLng },
        radius: radiusMeters(zone.areaKm2 ?? 1),
        fillColor: palette.fill,
        fillOpacity: selectedZoneId === zone.zoneId ? 0.42 : 0.28,
        strokeColor: palette.stroke,
        strokeOpacity: selectedZoneId === zone.zoneId ? 0.95 : 0.7,
        strokeWeight: selectedZoneId === zone.zoneId ? 3 : 2,
        clickable: true,
        zIndex: Math.round(zone.predictedSurge * 100),
      });
      bounds.extend({ lat: zone.centerLat, lng: zone.centerLng });
      circle.addListener("click", () => {
        onZoneSelect?.(zone.zoneId);
        const html = `
          <div style="font-family:system-ui,sans-serif;min-width:180px;padding:2px 0">
            <p style="margin:0 0 4px;font-weight:700;font-size:14px">${zone.name}</p>
            <p style="margin:0 0 6px;font-size:12px;color:#64748b">${zone.city ?? "—"}</p>
            <p style="margin:0;font-size:13px"><strong>Surge</strong> ${zone.predictedSurge.toFixed(2)}× · ${palette.label}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#475569">Supply ${zone.supply} · Active ${zone.activeBookings}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#475569">Density ${zone.densityPerKm2?.toFixed(1) ?? "—"}/km²</p>
          </div>`;
        infoRef.current?.setContent(html);
        infoRef.current?.setPosition({ lat: zone.centerLat, lng: zone.centerLng });
        infoRef.current?.open({ map: mapRef.current });
      });
      circlesRef.current.push(circle);
    }

    if (zones.length === 1) {
      mapRef.current.setCenter({ lat: zones[0].centerLat, lng: zones[0].centerLng });
      mapRef.current.setZoom(12);
    } else {
      mapRef.current.fitBounds(bounds, 48);
    }
  }, [loaded, zonesKey, selectedZoneId, onZoneSelect, zones]);

  if (!configured) {
    return (
      <div className={`partner-card flex flex-col items-center justify-center gap-3 p-8 text-center ${className}`}>
        <MapPin className="h-8 w-8 text-partner-muted" />
        <p className="text-sm font-medium text-partner-text">Map unavailable</p>
        <p className="max-w-sm text-xs text-partner-muted">
          Set <code className="rounded bg-black/5 px-1 py-0.5">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable the
          interactive territory heatmap.
        </p>
      </div>
    );
  }

  if (error || initError) {
    return (
      <div className={`partner-card flex flex-col items-center justify-center gap-2 p-8 text-center ${className}`}>
        <p className="text-sm font-medium text-partner-danger">Could not load map</p>
        <p className="max-w-md text-xs text-partner-muted">{mapsLoadErrorHint(error ?? initError)}</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-partner-line ${className}`}>
      {!loaded ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-partner-surface/80 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-partner-primary" />
        </div>
      ) : null}
      <div ref={divRef} className="h-full w-full" aria-label="Territory demand heatmap" />
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-lg border border-partner-line/80 bg-white/90 px-2.5 py-2 text-[10px] font-medium shadow-sm dark:bg-slate-900/90">
        {[
          { c: "#22c55e", l: "Normal" },
          { c: "#eab308", l: "Moderate" },
          { c: "#f97316", l: "Elevated" },
          { c: "#ef4444", l: "High" },
        ].map(({ c, l }) => (
          <span key={l} className="flex items-center gap-1 text-partner-text-secondary">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
});
