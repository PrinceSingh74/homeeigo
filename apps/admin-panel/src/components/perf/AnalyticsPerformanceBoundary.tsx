"use client";

import { memo, useEffect, useState, type ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
};

declare global {
  interface Window {
    __HOMIGO_ANALYTICS_DEFER__?: Array<{ label: string; deferMs: number }>;
  }
}

function AnalyticsPerformanceBoundaryInner({
  label,
  children,
  fallback = <div className="biz-card h-44" aria-hidden />,
}: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t0 = performance.now();
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setReady(true);
        const list = (window.__HOMIGO_ANALYTICS_DEFER__ ??= []);
        list.push({ label, deferMs: Math.round(performance.now() - t0) });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [label]);

  return ready ? children : fallback;
}

export const AnalyticsPerformanceBoundary = memo(AnalyticsPerformanceBoundaryInner);
