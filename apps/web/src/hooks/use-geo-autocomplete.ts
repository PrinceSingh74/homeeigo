"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi, type GeoPrediction } from "@/services/core/api";

/**
 * Phase 16.2 — debounced address autocomplete via the backend proxy (/api/geo/autocomplete).
 * Min 3 chars, 300 ms debounce, React-Query cached. The Google key stays server-side.
 */
export function useGeoAutocomplete(input: string, opts?: { lat?: number; lng?: number; sessionToken?: string }) {
  const [debounced, setDebounced] = useState(input);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(input.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [input]);

  const enabled = debounced.length >= 3;
  const query = useQuery({
    queryKey: ["geo-autocomplete", debounced, opts?.lat, opts?.lng],
    queryFn: () => coreApi.geo.autocomplete(debounced, { lat: opts?.lat, lng: opts?.lng, session: opts?.sessionToken }),
    enabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const predictions = useMemo<GeoPrediction[]>(() => query.data?.predictions ?? [], [query.data]);

  return {
    predictions,
    // available === false → backend has no Google key; the UI should fall back to manual entry.
    available: query.data?.available ?? true,
    isLoading: enabled && query.isFetching,
    isError: query.isError,
    isActive: enabled,
  };
}
