"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __HOMIGO_RENDER_COUNTS__?: Record<string, number>;
    __HOMIGO_RENDER_IDLE__?: Record<string, number>;
    __HOMIGO_MOUNT_COUNTS__?: Record<string, number>;
    __HOMIGO_EFFECT_COUNTS__?: Record<string, number>;
  }
}

/** Increments on every render — read via audit probe after idle window. */
export function useRenderProbe(label: string): void {
  if (typeof window === "undefined") return;
  const counts = (window.__HOMIGO_RENDER_COUNTS__ ??= {});
  counts[label] = (counts[label] ?? 0) + 1;
  window.__HOMIGO_RENDER_IDLE__ = { ...counts };
}

/** Increments once per mount — detects StrictMode double-mount / remount churn. */
export function useMountProbe(label: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const counts = (window.__HOMIGO_MOUNT_COUNTS__ ??= {});
    counts[label] = (counts[label] ?? 0) + 1;
  }, [label]);
}

/** Increments on every effect run — surfaces unnecessary useEffect churn during navigation. */
export function useEffectProbe(label: string, deps?: unknown[]): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const counts = (window.__HOMIGO_EFFECT_COUNTS__ ??= {});
    counts[label] = (counts[label] ?? 0) + 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional probe hook
  }, deps ?? []);
}

/** Returns top-N components by render count for audit scripts. */
export function getTopRenderCounts(limit = 50): Array<{ component: string; renders: number }> {
  if (typeof window === "undefined") return [];
  const counts = window.__HOMIGO_RENDER_IDLE__ ?? window.__HOMIGO_RENDER_COUNTS__ ?? {};
  return Object.entries(counts)
    .map(([component, renders]) => ({ component, renders }))
    .sort((a, b) => b.renders - a.renders)
    .slice(0, limit);
}
