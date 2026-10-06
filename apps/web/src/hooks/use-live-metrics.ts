"use client";

import { useEffect, useState } from "react";
import { useStatsOverview } from "@/hooks/use-core-data";
import { liveMetricsFromStats, type LiveMetric } from "@/lib/live-metrics";

export type { LiveMetric };

/**
 * Marketplace metrics backed by GET /api/stats/overview. Empty while loading, when the API is
 * down, or when the server has no real value — see liveMetricsFromStats.
 */
export function useLiveMetrics(): LiveMetric[] {
  const { data: stats } = useStatsOverview();

  // Same hydration guard as elsewhere: keep server + first client paint identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return liveMetricsFromStats(mounted ? stats : undefined);
}
