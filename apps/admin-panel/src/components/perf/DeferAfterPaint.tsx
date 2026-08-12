"use client";

import { memo, useEffect, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
};

declare global {
  interface Window {
    __HOMIGO_DEFER_METRICS__?: Array<{ label: string; deferMs: number }>;
  }
}

function DeferAfterPaintInner({ children, fallback = null, label = "defer" }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t0 = performance.now();
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setReady(true);
        const list = (window.__HOMIGO_DEFER_METRICS__ ??= []);
        list.push({ label, deferMs: Math.round(performance.now() - t0) });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [label]);

  return ready ? children : fallback;
}

export const DeferAfterPaint = memo(DeferAfterPaintInner);
