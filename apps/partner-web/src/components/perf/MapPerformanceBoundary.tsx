"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
  deferAfterPaint?: boolean;
  rootMargin?: string;
  skeleton?: ReactNode;
};

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
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  const ready = visible && paintReady;
  const fallback = skeleton ?? <div className={`rounded-2xl bg-white/[0.03] ${className}`} aria-hidden />;

  return (
    <div ref={containerRef} className={className} data-map-boundary={label}>
      {ready ? children : fallback}
    </div>
  );
}

export const MapPerformanceBoundary = memo(MapPerformanceBoundaryInner);
