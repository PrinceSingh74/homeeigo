"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";

export type MapMountMetric = {
  label: string;
  visibleAt: number;
  mountedAt: number;
  deferMs: number;
};

declare global {
  interface Window {
    __HOMIGO_MAP_METRICS__?: MapMountMetric[];
  }
}

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
  /** Wait for first paint before mounting map (keeps route transitions fast). */
  deferAfterPaint?: boolean;
  /** IntersectionObserver root margin — maps load slightly before entering viewport. */
  rootMargin?: string;
  skeleton?: ReactNode;
};

function pushMetric(metric: MapMountMetric): void {
  const list = (window.__HOMIGO_MAP_METRICS__ ??= []);
  list.push(metric);
  if (list.length > 50) list.shift();
}

function MapPerformanceBoundaryInner({
  label,
  children,
  className = "h-full w-full",
  deferAfterPaint = true,
  rootMargin = "120px",
  skeleton,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [paintReady, setPaintReady] = useState(!deferAfterPaint);
  const visibleAt = useRef<number | null>(null);

  useEffect(() => {
    if (!deferAfterPaint) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setPaintReady(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deferAfterPaint]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visibleAt.current = performance.now();
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  useEffect(() => {
    if (!visible || !paintReady || visibleAt.current == null) return;
    pushMetric({
      label,
      visibleAt: visibleAt.current,
      mountedAt: performance.now(),
      deferMs: Math.round(performance.now() - visibleAt.current),
    });
  }, [visible, paintReady, label]);

  const ready = visible && paintReady;
  const fallback =
    skeleton ?? (
      <div className={`rounded-2xl bg-white/5 ${className}`} aria-hidden />
    );

  return (
    <div ref={containerRef} className={className}>
      {ready ? children : fallback}
    </div>
  );
}

export const MapPerformanceBoundary = memo(MapPerformanceBoundaryInner);
