"use client";

import { Star, MapPin, Clock, Loader2 } from "lucide-react";
import { useNearbyProviders } from "@/hooks/use-nearby-providers";
import type { NearbyProvider } from "@/services/core/api";

/**
 * Phase 16.2 — "providers near you" with live distance + ETA, reusing the certified
 * matching engine via /api/geo/nearby-providers. Sorted ETA → distance → rating.
 */
export function ProviderETA({
  serviceId,
  latitude,
  longitude,
  onSelect,
  maxDistanceKm,
}: {
  serviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  onSelect?: (p: NearbyProvider) => void;
  maxDistanceKm?: number;
}) {
  const { providers, count, isLoading, isError, refetch } = useNearbyProviders({ serviceId, latitude, longitude, maxDistanceKm });

  if (!serviceId || latitude == null || longitude == null) {
    return <p className="px-1 text-sm text-gray-400">Select a service and location to see nearby pros.</p>;
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Finding pros near you…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-1 py-4 text-sm text-red-600">
        Couldn&apos;t load providers.{" "}
        <button onClick={() => refetch()} className="font-medium underline">Retry</button>
      </div>
    );
  }
  if (count === 0) {
    return <p className="px-1 py-4 text-sm text-gray-500">No providers available near this location right now.</p>;
  }

  return (
    <ul className="space-y-2">
      {providers.map((p) => (
        <li key={p.providerId}>
          <button
            type="button"
            onClick={() => onSelect?.(p)}
            className="flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition hover:border-primary/40 hover:shadow-sm"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-sm font-semibold text-gray-500">
              {p.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.profileImage} alt="" className="h-full w-full object-cover" />
              ) : (
                p.name.slice(0, 1).toUpperCase()
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-gray-900">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-sm text-amber-600">
                  <Star size={14} className="fill-amber-500 text-amber-500" aria-hidden /> {p.rating?.toFixed(1)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><MapPin size={13} aria-hidden /> {p.distance?.toFixed(1)} km</span>
                <span className="flex items-center gap-1 font-medium text-emerald-600"><Clock size={13} aria-hidden /> {p.eta} min ETA</span>
                <span className={p.availability ? "text-emerald-600" : "text-gray-400"}>{p.availability ? "Available" : "Busy"}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
