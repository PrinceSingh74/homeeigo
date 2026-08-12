"use client";

import { memo, useEffect, useRef, type ReactNode } from "react";

export type MapDOMMetric = {
  label: string;
  totalDom: number;
  mapSubtree: number;
  reactDom: number;
  at: number;
};

declare global {
  interface Window {
    __HOMIGO_MAP_DOM__?: MapDOMMetric[];
  }
}

function MapDOMIsolationBoundaryInner({
  label,
  children,
  className = "h-full w-full",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const t = window.setTimeout(() => {
      const mapSubtree = root.querySelectorAll("*").length;
      const totalDom = document.querySelectorAll("*").length;
      const reactDom = Math.max(0, totalDom - mapSubtree);
      const metric: MapDOMMetric = {
        label,
        totalDom,
        mapSubtree,
        reactDom,
        at: Date.now(),
      };
      const list = (window.__HOMIGO_MAP_DOM__ ??= []);
      list.push(metric);
      if (list.length > 20) list.shift();
    }, 800);
    return () => window.clearTimeout(t);
  }, [label]);

  return (
    <div ref={rootRef} data-homigo-map-isolation={label} className={className}>
      {children}
    </div>
  );
}

export const MapDOMIsolationBoundary = memo(MapDOMIsolationBoundaryInner);
