"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi, type NearbyProvider } from "@/services/core/api";

/**
 * Phase 16.2 — nearby providers for a service at a location. Reuses the certified backend
 * matching engine (/api/geo/nearby-providers). Sorted ETA → distance → rating.
 */
export function useNearbyProviders(
  params: { serviceId?: string | null; latitude?: number | null; longitude?: number | null; maxDistanceKm?: number },
  opts?: { enabled?: boolean },
) {
  const ready = Boolean(params.serviceId && params.latitude != null && params.longitude != null);
  const query = useQuery({
    queryKey: ["nearby-providers", params.serviceId, params.latitude, params.longitude, params.maxDistanceKm],
    queryFn: () =>
      coreApi.geo.nearbyProviders({
        serviceId: params.serviceId!,
        latitude: params.latitude!,
        longitude: params.longitude!,
        maxDistanceKm: params.maxDistanceKm,
      }),
    enabled: ready && opts?.enabled !== false,
    staleTime: 30_000,
  });

  const providers = useMemo<NearbyProvider[]>(() => {
    const list = query.data?.providers ?? [];
    return [...list].sort((a, b) => a.eta - b.eta || a.distance - b.distance || b.rating - a.rating);
  }, [query.data]);

  return { providers, count: providers.length, isLoading: ready && query.isFetching, isError: query.isError, refetch: query.refetch };
}
