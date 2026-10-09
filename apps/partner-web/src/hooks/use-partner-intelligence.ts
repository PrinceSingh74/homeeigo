"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { partnerApi, type SurgeZone } from "@/services/partner-api";

export type SmartZone = {
  zoneId: string; name: string; city: string | null;
  centerLat: number; centerLng: number; distanceKm: number | null;
  providers: number;
  supply: number;
  /** Platform zone scores are admin-only. Null means the partner view does not have them — never a measured zero. */
  demand24h: number | null; revenue24h: number | null; riskScore: number | null; earningScore: number | null; serviceHealth: number | null;
  predictedSurge: number; weatherSurge: number; demandDeltaPct: number | null;
  opportunityScore: number | null;
  gap: number | null;
  expectedEarnings2h: { lo: number; hi: number } | null;
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

/**
 * Partner geo-intelligence from the endpoints a partner is allowed to read: surge,
 * provider density and demand forecast. Platform zone scores (`/api/geo-intel/zone-scoring`)
 * are admin-only; calling them is a 403 and their revenue and risk figures are not
 * invented here as zeros.
 */
export function usePartnerIntelligence(location: { lat: number; lng: number } | null) {
  const surgeQ = useQuery({ queryKey: ["pi-surge"], queryFn: () => partnerApi.geoIntel.surge(), refetchInterval: 60_000 });
  const densityQ = useQuery({ queryKey: ["pi-density"], queryFn: () => partnerApi.geoIntel.density(), refetchInterval: 60_000 });
  const demandQ = useQuery({ queryKey: ["pi-demand"], queryFn: () => partnerApi.geoIntel.demandForecast(6), refetchInterval: 300_000 });

  const zones: SmartZone[] = useMemo(() => {
    const density = densityQ.data?.data ?? [];
    const surge = new Map<string, SurgeZone>((surgeQ.data?.data ?? []).map((z) => [z.zoneId, z]));
    return density.map((d) => {
      const su = surge.get(d.zoneId);
      return {
        zoneId: d.zoneId, name: d.name, city: d.city, centerLat: d.centerLat, centerLng: d.centerLng,
        distanceKm: location ? Math.round(haversineKm(location, { lat: d.centerLat, lng: d.centerLng }) * 10) / 10 : null,
        providers: d.providers,
        supply: d.providers,
        demand24h: null,
        revenue24h: null,
        riskScore: null,
        earningScore: null,
        serviceHealth: null,
        opportunityScore: null,
        gap: null,
        predictedSurge: su?.predictedSurge ?? 1,
        weatherSurge: su?.weatherSurge ?? 1,
        demandDeltaPct: su?.demandDeltaPct ?? null,
        expectedEarnings2h: null,
      };
    });
  }, [densityQ.data, surgeQ.data, location]);

  const freshness = surgeQ.data?.freshness;
  const confidence = surgeQ.data?.confidence ?? null;

  return {
    zones,
    bestEarning: [] as SmartZone[],
    bestOpportunity: [] as SmartZone[],
    highRisk: [] as SmartZone[],
    worstService: [] as SmartZone[],
    demand: demandQ.data?.data,
    surgeConfidence: surgeQ.data?.confidence ?? null,
    freshness,
    confidence,
    isLoading: surgeQ.isLoading || densityQ.isLoading,
  };
}
