"use client";

import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/stores/app-store";
import { LOCATIONS } from "@/lib/services";

/**
 * Customer weather warnings for the currently-selected service location.
 * Polls /api/weather/alerts (Redis-cached server-side). Returns nothing
 * actionable when weather is unavailable or conditions are clear/mild.
 */
export function useWeatherAlerts() {
  const locationId = useAppStore((s) => s.locationId);
  const loc = LOCATIONS.find((l) => l.id === locationId) ?? LOCATIONS[0];

  const query = useQuery({
    queryKey: ["weather-alerts", loc?.id],
    enabled: Boolean(loc),
    staleTime: 10 * 60 * 1000, // matches server cache (10m)
    refetchInterval: 10 * 60 * 1000,
    queryFn: () => coreApi.weather.alerts(loc!.latitude, loc!.longitude),
  });

  const data = query.data;
  const alerts = data?.available ? (data.alerts ?? []) : [];
  const severity = data?.severity ?? "clear";
  const shouldWarn = data?.available === true && (severity === "moderate" || severity === "severe" || severity === "extreme") && alerts.length > 0;

  return {
    loading: query.isLoading,
    available: data?.available ?? false,
    severity,
    alerts,
    vendorImpact: data?.vendorImpact,
    etaFactor: data?.etaFactor ?? 1,
    shouldWarn,
    cityName: loc?.city ?? null,
  };
}
