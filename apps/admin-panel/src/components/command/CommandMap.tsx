"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useEffect, useMemo, useRef } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { useGoogleMapsLoader, mapsLoadErrorHint } from "@/hooks/use-google-maps-loader";

export type LayerKey = "density" | "demand" | "revenue" | "surge" | "fraud" | "geofence" | "traffic" | "weather";

/** Merged per-zone record the map renders (joined by zoneId in the page). */
export type CmdZone = {
  zoneId: string; name: string; city: string | null;
  centerLat: number; centerLng: number; radiusM: number;
  providers: number; densityPerKm2: number;
  demand24h: number; demandScore: number; revenue24h: number; riskScore: number;
  predictedSurge: number; weatherSurge: number;
};
export type FraudPin = { lat: number; lng: number; implied_kmh: number };

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

const heat = (t: number, a = 0.55) => {
  const c = t < 0.5 ? [34 + t * 2 * (245 - 34), 197 + t * 2 * (158 - 197), 94 + t * 2 * (11 - 94)]
                    : [245 + (t - 0.5) * 2 * (239 - 245), 158 + (t - 0.5) * 2 * (68 - 158), 11 + (t - 0.5) * 2 * (68 - 11)];
  return `rgba(${c.map((x) => Math.round(x)).join(",")},${a})`;
};

function zonesFingerprint(zones: CmdZone[]): string {
  return zones.map((z) => `${z.zoneId}:${z.providers}:${z.demandScore}:${z.revenue24h}:${z.predictedSurge}`).join("|");
}

function fraudFingerprint(fraud: FraudPin[]): string {
  return fraud.map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`).join("|");
}

/** Grid-cluster fraud pins to cap marker DOM when count is high. */
function clusterFraudPins(fraud: FraudPin[], cellDeg = 0.08): FraudPin[] {
  if (fraud.length <= 40) return fraud;
  const buckets = new Map<string, FraudPin[]>();
  for (const f of fraud) {
    const key = `${Math.floor(f.lat / cellDeg)}:${Math.floor(f.lng / cellDeg)}`;
    const list = buckets.get(key) ?? [];
    list.push(f);
    buckets.set(key, list);
  }
  const out: FraudPin[] = [];
  for (const list of buckets.values()) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    const lat = list.reduce((s, p) => s + p.lat, 0) / list.length;
    const lng = list.reduce((s, p) => s + p.lng, 0) / list.length;
    const maxKmh = Math.max(...list.map((p) => p.implied_kmh));
    out.push({ lat, lng, implied_kmh: maxKmh });
  }
  return out;
}

function CommandMapInner({
  zones,
  fraud,
  layers,
  className = "h-full w-full",
}: {
  zones: CmdZone[];
  fraud: FraudPin[];
  layers: Set<LayerKey>;
  className?: string;
}) {
  useRenderProbe("CommandMap");
  useMountProbe("CommandMap");
  const { loaded, error, configured } = useGoogleMapsLoader();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const trafficRef = useRef<any>(null);

  const layerKey = useMemo(() => [...layers].sort().join(","), [layers]);
  const zoneKey = useMemo(() => zonesFingerprint(zones), [zones]);
  const fraudKey = useMemo(() => fraudFingerprint(fraud), [fraud]);
  const clusteredFraud = useMemo(() => clusterFraudPins(fraud), [fraud]);

  useEffect(() => {
    if (!loaded || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(divRef.current, {
      center: { lat: 23.5, lng: 80 },
      zoom: 5,
      disableDefaultUI: true,
      zoomControl: true,
      backgroundColor: "#0b1220",
      styles: DARK_STYLE,
      minZoom: 4,
    });
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const g = (window as any).google;
    const map = mapRef.current;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const maxRev = Math.max(1, ...zones.map((z) => z.revenue24h));
    const maxDens = Math.max(0.001, ...zones.map((z) => z.densityPerKm2));

    const add = (o: any) => { overlaysRef.current.push(o); };

    for (const z of zones) {
      const center = { lat: z.centerLat, lng: z.centerLng };

      if (layers.has("geofence")) {
        add(new g.maps.Circle({ map, center, radius: z.radiusM, fillOpacity: 0, strokeColor: "#38bdf8", strokeOpacity: 0.5, strokeWeight: 1.5 }));
      }
      if (layers.has("density")) {
        add(new g.maps.Circle({ map, center, radius: z.radiusM * 0.6, fillColor: "#3b82f6", fillOpacity: 0.12 + 0.5 * (z.densityPerKm2 / maxDens), strokeColor: "#60a5fa", strokeOpacity: 0.6, strokeWeight: 1 }));
      }
      if (layers.has("demand")) {
        add(new g.maps.Circle({ map, center, radius: z.radiusM * 0.7, fillColor: heat(z.demandScore / 100, 1).replace(/[\d.]+\)$/, "0.35)"), fillOpacity: 0.1 + 0.5 * (z.demandScore / 100), strokeOpacity: 0, strokeWeight: 0 }));
      }
      if (layers.has("revenue")) {
        add(new g.maps.Circle({ map, center, radius: z.radiusM * 0.5, fillColor: "#22c55e", fillOpacity: 0.12 + 0.55 * (z.revenue24h / maxRev), strokeColor: "#4ade80", strokeOpacity: 0.5, strokeWeight: 1 }));
      }
      if (layers.has("surge") && z.predictedSurge > 1) {
        const t = Math.min(1, (z.predictedSurge - 1) / 2);
        add(new g.maps.Circle({ map, center, radius: z.radiusM * (0.5 + 0.5 * t), fillColor: heat(t, 1).slice(0, -4) + "0.22)", fillOpacity: 1, strokeColor: heat(t, 1).slice(0, -4) + "0.9)", strokeOpacity: 1, strokeWeight: 2 }));
      }
      if (layers.has("weather") && z.weatherSurge > 1) {
        add(new g.maps.Circle({ map, center, radius: z.radiusM * 0.9, fillColor: "#f59e0b", fillOpacity: 0.06 + 0.2 * Math.min(1, (z.weatherSurge - 1) / 0.5), strokeOpacity: 0, strokeWeight: 0 }));
      }
    }

    if (layers.has("fraud")) {
      for (const f of clusteredFraud) {
        add(new g.maps.Marker({
          map, position: { lat: f.lat, lng: f.lng }, title: `Fake GPS · ${f.implied_kmh} km/h`,
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#ef4444", fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 1.5 },
          zIndex: 999,
        }));
      }
    }

    if (layers.has("traffic")) {
      if (!trafficRef.current) trafficRef.current = new g.maps.TrafficLayer();
      trafficRef.current.setMap(map);
    } else if (trafficRef.current) {
      trafficRef.current.setMap(null);
    }
  }, [loaded, layerKey, zoneKey, fraudKey, zones, clusteredFraud, layers]);

  if (!configured || error) {
    return (
      <div className={`flex items-center justify-center bg-slate-950 text-center text-sm text-slate-400 ${className}`}>
        <p className="max-w-md px-4">{!configured ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable the command map." : mapsLoadErrorHint(error)}</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div ref={divRef} className="h-full w-full" aria-label="India operations command map" />
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-sm text-slate-400">Loading command map…</div>
      ) : null}
    </div>
  );
}

export const CommandMap = memo(CommandMapInner, (prev, next) =>
  prev.className === next.className &&
  zonesFingerprint(prev.zones) === zonesFingerprint(next.zones) &&
  fraudFingerprint(prev.fraud) === fraudFingerprint(next.fraud) &&
  [...prev.layers].sort().join(",") === [...next.layers].sort().join(","),
);
