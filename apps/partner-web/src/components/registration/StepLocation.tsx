"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, Search } from "lucide-react";
import { useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";

type LocationValue = {
  city: string;
  serviceRegions: string[];
  serviceRadiusKm: number;
  baseLatitude?: number;
  baseLongitude?: number;
};

export function StepLocation({
  loading,
  initialValues,
  onSubmit,
}: {
  loading: boolean;
  initialValues?: LocationValue;
  onSubmit: (data: LocationValue) => void;
}) {
  const maps = useGoogleMapsLoader();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<{ panTo: (p: { lat: number; lng: number }) => void } | null>(null);
  const marker = useRef<{
    setPosition: (p: { lat: number; lng: number }) => void;
    getPosition: () => { lat: () => number; lng: () => number } | null;
    addListener: (event: string, fn: () => void) => void;
  } | null>(null);
  const circle = useRef<{
    setCenter: (p: { lat: number; lng: number }) => void;
    setRadius: (m: number) => void;
  } | null>(null);
  const [city, setCity] = useState(initialValues?.city ?? "");
  const [regions, setRegions] = useState(initialValues?.serviceRegions?.join(", ") ?? "");
  const [radius, setRadius] = useState(initialValues?.serviceRadiusKm ?? 5);
  const [lat, setLat] = useState<number | undefined>(initialValues?.baseLatitude);
  const [lng, setLng] = useState<number | undefined>(initialValues?.baseLongitude);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<Array<{ id: string; name: string }>>([]);
  const [geoHint, setGeoHint] = useState<string | null>(null);

  const applyPoint = useCallback(async (nextLat: number, nextLng: number, nextCity?: string) => {
    setLat(nextLat);
    setLng(nextLng);
    try {
      const geo = await partnerRegistrationApi.reverseGeocode(nextLat, nextLng);
      if (geo.address?.city) setCity(geo.address.city);
      else if (nextCity) setCity(nextCity);
      if (geo.address?.formattedAddress && !regions) {
        setRegions(geo.address.formattedAddress);
      }
      setZones((geo.coverageZones ?? []).map((z) => ({ id: z.id, name: z.name })));
      setGeoHint(geo.available ? null : "Live geocoding is not configured — city can be entered manually.");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [regions]);

  useEffect(() => {
    const g = window.google?.maps as {
      Map: new (el: HTMLElement, opts: Record<string, unknown>) => { panTo: (p: { lat: number; lng: number }) => void; addListener: (e: string, fn: (ev: { latLng?: { lat: () => number; lng: () => number } }) => void) => void };
      Marker: new (opts: Record<string, unknown>) => NonNullable<typeof marker.current>;
      Circle: new (opts: Record<string, unknown>) => NonNullable<typeof circle.current>;
    } | undefined;
    if (!maps.loaded || !mapRef.current || !g) return;
    const start = { lat: lat ?? 19.076, lng: lng ?? 72.8777 };
    const map = new g.Map(mapRef.current, {
      center: start,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapObj.current = map;
    marker.current = new g.Marker({ map, position: start, draggable: true });
    circle.current = new g.Circle({
      map,
      center: start,
      radius: radius * 1000,
      fillColor: "#2563eb",
      fillOpacity: 0.12,
      strokeColor: "#2563eb",
      strokeOpacity: 0.6,
    });
    map.addListener("click", (e) => {
      if (!e.latLng) return;
      void applyPoint(e.latLng.lat(), e.latLng.lng());
    });
    marker.current.addListener("dragend", () => {
      const pos = marker.current?.getPosition();
      if (pos) void applyPoint(pos.lat(), pos.lng());
    });
  }, [maps.loaded]);

  useEffect(() => {
    const pos = lat != null && lng != null ? { lat, lng } : null;
    if (!pos) return;
    marker.current?.setPosition(pos);
    circle.current?.setCenter(pos);
    mapObj.current?.panTo(pos);
  }, [lat, lng]);

  useEffect(() => {
    circle.current?.setRadius(radius * 1000);
  }, [radius]);

  async function applyBrowserLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Location is unavailable in this browser. Search an address instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void applyPoint(pos.coords.latitude, pos.coords.longitude),
      () => setError("Location permission denied. Search an address instead."),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  async function search() {
    const q = query.trim();
    if (q.length < 3) return;
    setError(null);
    try {
      const result = await partnerRegistrationApi.searchLocation(q);
      if (!result.address) {
        setError("No matching location found. Enter city and areas manually.");
        setLat(undefined);
        setLng(undefined);
        return;
      }
      setCity(result.address.city ?? q);
      await applyPoint(result.address.latitude, result.address.longitude, result.address.city ?? q);
    } catch (err) {
      setError(getErrorMessage(err));
      setLat(undefined);
      setLng(undefined);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = regions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        onSubmit({
          city,
          serviceRegions: parsed.length ? parsed : [city],
          serviceRadiusKm: radius,
          baseLatitude: lat,
          baseLongitude: lng,
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Service location</h2>
        <p className="text-sm text-partner-muted">Pin your base, set a radius, and confirm coverage.</p>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-partner-line">
        <div ref={mapRef} className="h-[280px] w-full bg-[#e8eef5] md:h-[360px]" />
        {!maps.configured || maps.error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-6 text-center text-sm text-partner-muted">
            Map preview unavailable. Search or enter your city — coordinates are still validated on save.
          </div>
        ) : null}
        <div className="absolute left-3 right-3 top-3 flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search address</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-partner-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search area or landmark"
              className="w-full rounded-xl border border-white/70 bg-white/95 py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none"
            />
          </label>
          <button type="button" onClick={() => void search()} className="rounded-xl bg-white/95 px-3 text-sm font-semibold shadow-sm">
            Search
          </button>
          <button type="button" onClick={() => void applyBrowserLocation()} className="rounded-xl bg-white/95 px-3 shadow-sm" aria-label="Use current location">
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Base city</span>
        <input
          name="city"
          required
          placeholder="Gurugram"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Service areas (comma separated)</span>
        <input
          name="serviceRegions"
          placeholder="Sector 45, Sector 46, Golf Course Road"
          value={regions}
          onChange={(e) => setRegions(e.target.value)}
          className="w-full rounded-xl border border-partner-border bg-partner-surface px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Preferred radius ({radius} km)</span>
        <input
          name="serviceRadiusKm"
          type="range"
          min={1}
          max={50}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-full"
        />
      </label>
      {zones.length ? (
        <p className="text-xs text-partner-muted">Coverage zones: {zones.map((z) => z.name).join(", ")}</p>
      ) : null}
      {geoHint ? <p className="text-xs text-partner-muted">{geoHint}</p> : null}
      {error ? <p role="alert" className="text-sm text-partner-danger">{error}</p> : null}
      <button type="submit" disabled={loading} className="w-full rounded-xl bg-partner-primary py-3 font-semibold text-white disabled:opacity-60">
        {loading ? "Saving…" : "Save & Continue"}
      </button>
    </form>
  );
}
