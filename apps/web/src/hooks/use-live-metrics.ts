"use client";

import { useEffect, useState } from "react";
import { useStatsOverview } from "@/hooks/use-core-data";

export type LiveMetric = { number: string; label: string; icon: string };

const nf = (n: number) => n.toLocaleString("en-IN");

/**
 * Marketplace hero/cities metrics backed by GET /api/stats/overview.
 * Falls back to the marketing defaults while loading or if the API is down.
 */
export function useLiveMetrics(): LiveMetric[] {
  const { data: stats } = useStatsOverview();

  // Same hydration guard as elsewhere: keep server + first client paint identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const live = mounted ? stats : undefined;

  return [
    { number: "11+", label: "Cities", icon: "🏙" },
    {
      number: live && live.completedBookings > 0 ? `${nf(live.completedBookings)}+` : "50,000+",
      label: "Homes Served",
      icon: "🏠",
    },
    {
      number: live && live.activeProviders > 0 ? `${nf(live.activeProviders)}+` : "10,000+",
      label: "Verified Partners",
      icon: "👥",
    },
    {
      number: live?.averageRating != null ? `${live.averageRating}★` : "4.9★",
      label: "Customer Rating",
      icon: "⭐",
    },
  ];
}
