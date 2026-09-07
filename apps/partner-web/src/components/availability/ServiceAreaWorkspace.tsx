"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { useGoogleMapsLoader } from "@/hooks/use-google-maps-loader";
import { partnerKeys, usePartnerOperationsQuery } from "@/hooks/use-partner-data";
import { partnerApi } from "@/services/partner-api";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

export function ServiceAreaWorkspace() {
  const maps = useGoogleMapsLoader();
  const ops = usePartnerOperationsQuery();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.showToast);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapHost, setMapHost] = useState<HTMLDivElement | null>(null);
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

  const [city, setCity] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [radius, setRadius] = useState(5);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [geoHint, setGeoHint] = useState<string | null>(null);

  useEffect(() => {
    const d = ops.data;
    if (!d) return;
    setCity(d.city ?? "");
    setRegions(d.serviceRegions ?? []);
    setRadius(d.serviceRadiusKm ?? 5);
    setLat(d.baseLatitude ?? undefined);
    setLng(d.baseLongitude ?? undefined);
  }, [ops.data]);

  const zones = useQuery({
    queryKey: ["partner", "zones", lat, lng],
    queryFn: () => partnerApi.nearbyServiceZones(lat, lng),
    enabled: lat != null && lng != null,
  });

  const applyPoint = useCallback(async (nextLat: number, nextLng: number) => {
    setLat(nextLat);
    setLng(nextLng);
    setError(null);
    try {
      const geo = await partnerRegistrationApi.reverseGeocode(nextLat, nextLng);
      if (geo.address?.city) setCity(geo.address.city);
      setGeoHint(geo.available ? null : "Search or pick a zone manually — live geocoding is limited.");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const g = window.google?.maps as {
      Map: new (el: HTMLElement, opts: Record<string, unknown>) => { panTo: (p: { lat: number; lng: number }) => void; addListener: (e: string, fn: (ev: { latLng?: { lat: () => number; lng: () => number } }) => void) => void };
      Marker: new (opts: Record<string, unknown>) => NonNullable<typeof marker.current>;
      Circle: new (opts: Record<string, unknown>) => NonNullable<typeof circle.current>;
    } | undefined;
    const host = mapHost ?? mapRef.current;
    if (!maps.loaded || !host || !g) return;
    const start = { lat: lat ?? 28.57, lng: lng ?? 77.32 };
    const map = new g.Map(host, {
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
      strokeOpacity: 0.55,
    });
    map.addListener("click", (e) => {
      if (!e.latLng) return;
      void applyPoint(e.latLng.lat(), e.latLng.lng());
    });
    marker.current.addListener("dragend", () => {
      const pos = marker.current?.getPosition();
      if (pos) void applyPoint(pos.lat(), pos.lng());
    });
  }, [maps.loaded, applyPoint, mapHost]);

  useEffect(() => {
    if (lat == null || lng == null) return;
    const pos = { lat, lng };
    marker.current?.setPosition(pos);
    circle.current?.setCenter(pos);
    mapObj.current?.panTo(pos);
  }, [lat, lng]);

  useEffect(() => {
    circle.current?.setRadius(radius * 1000);
  }, [radius]);

  const save = useMutation({
    mutationFn: () => {
      if (regions.length === 0 && !city) throw new Error("Add your first service area to receive location-matched jobs.");
      if (radius < 1 || radius > 50) throw new Error("Choose a radius within the allowed range.");
      return partnerApi.updateServiceArea({
        city: city || undefined,
        serviceRegions: regions,
        serviceRadiusKm: radius,
        baseLatitude: lat,
        baseLongitude: lng,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.operations });
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
      toast("Service areas saved", "success");
    },
    onError: (e) => toast(getErrorMessage(e), "error"),
  });

  function toggleRegion(name: string) {
    setRegions((prev) => (prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name]));
  }

  async function locateCurrentPosition() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. Search an area instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void applyPoint(pos.coords.latitude, pos.coords.longitude),
      () => setError("Location permission denied. Search or select an area manually."),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  async function search() {
    if (query.trim().length < 3) return;
    try {
      const result = await partnerRegistrationApi.searchLocation(query.trim());
      if (!result.address) {
        setError("No matching location found. Enter an area name manually.");
        return;
      }
      if (result.address.city) setCity(result.address.city);
      await applyPoint(result.address.latitude, result.address.longitude);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (ops.isLoading) {
    return (
      <PartnerCard className="min-h-[320px]">
        <p className="text-sm text-partner-muted">Loading service areas…</p>
      </PartnerCard>
    );
  }

  const nearby = zones.data?.zones ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
      <PartnerCard padded={false} className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-partner-line p-3">
          <div className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-partner-line px-3">
            <Search className="h-4 w-4 text-partner-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="Search area"
              className="h-10 w-full bg-transparent text-sm outline-none"
              aria-label="Search service area"
            />
          </div>
          <PartnerButton variant="outline" className="min-h-11" onClick={() => void locateCurrentPosition()}>
            <LocateFixed className="h-4 w-4" /> Current location
          </PartnerButton>
        </div>
        <div
          ref={(el) => {
            mapRef.current = el;
            setMapHost(el);
          }}
          className="h-[360px] w-full bg-partner-bg-secondary sm:h-[420px]"
          role="img"
          aria-label="Service area map"
        />
        {!maps.loaded ? (
          <p className="px-4 py-3 text-xs text-partner-muted">Map loading — you can still search and save areas.</p>
        ) : null}
      </PartnerCard>

      <PartnerCard glass className="space-y-5">
        <div>
          <h2 className="font-display text-lg font-semibold">My service areas</h2>
          <p className="mt-1 text-sm text-partner-muted">{city || "Add your first service area to receive location-matched jobs."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {regions.length === 0 ? (
            <p className="text-sm text-partner-muted">No areas selected yet.</p>
          ) : (
            regions.map((r) => (
              <button
                key={r}
                type="button"
                className="min-h-11 rounded-full bg-partner-success/10 px-3 text-sm font-semibold text-partner-success"
                onClick={() => toggleRegion(r)}
              >
                {r} ✓
              </button>
            ))
          )}
        </div>
        {nearby.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-partner-muted">Nearby zones</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {nearby.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  className={cn(
                    "min-h-11 rounded-full border px-3 text-sm",
                    regions.includes(z.name) ? "border-partner-primary text-partner-primary" : "border-partner-line",
                  )}
                  onClick={() => toggleRegion(z.name)}
                >
                  {regions.includes(z.name) ? `${z.name} ✓` : `Add ${z.name}`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="text-partner-muted">Preferred areas (comma separated)</span>
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-partner-line bg-transparent px-3"
              value={regions.join(", ")}
              onChange={(e) => setRegions(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-partner-muted">Radius {radius} km</span>
          <input type="range" min={1} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-2 w-full" />
        </label>
        {error || geoHint ? <p className="text-sm text-partner-warning">{error ?? geoHint}</p> : null}
        <PartnerButton className="min-h-11 w-full" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </PartnerButton>
      </PartnerCard>
    </div>
  );
}
