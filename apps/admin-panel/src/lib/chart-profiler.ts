"use client";

import { useEffect, useRef } from "react";

export type ChartRenderMetric = {
  label: string;
  renders: number;
  lastDataKey: string;
  skippedRedraws: number;
};

declare global {
  interface Window {
    __HOMIGO_CHART_METRICS__?: Record<string, ChartRenderMetric>;
  }
}

/** Tracks chart render count and data-unchanged skips for audit probes. */
export function useChartProfiler(label: string, dataKey: string): { shouldRedraw: boolean } {
  const prevKey = useRef<string | null>(null);
  const metrics = (typeof window !== "undefined"
    ? (window.__HOMIGO_CHART_METRICS__ ??= {})
    : {}) as Record<string, ChartRenderMetric>;

  const entry = metrics[label] ?? {
    label,
    renders: 0,
    lastDataKey: "",
    skippedRedraws: 0,
  };
  entry.renders += 1;

  const unchanged = prevKey.current !== null && prevKey.current === dataKey;
  if (unchanged) entry.skippedRedraws += 1;
  entry.lastDataKey = dataKey;
  metrics[label] = entry;
  prevKey.current = dataKey;

  useEffect(() => {
    metrics[label] = entry;
  });

  return { shouldRedraw: !unchanged };
}
