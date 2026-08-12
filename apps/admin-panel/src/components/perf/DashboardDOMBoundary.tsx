"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
  rootMargin?: string;
};

declare global {
  interface Window {
    __HOMIGO_DASHBOARD_DOM__?: Array<{ label: string; mountedAt: number }>;
  }
}

function DashboardDOMBoundaryInner({
  label,
  children,
  fallback = null,
  rootMargin = "160px",
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          const list = (window.__HOMIGO_DASHBOARD_DOM__ ??= []);
          list.push({ label, mountedAt: performance.now() });
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, label, rootMargin]);

  return (
    <div ref={ref} data-dashboard-boundary={label}>
      {visible ? children : fallback}
    </div>
  );
}

export const DashboardDOMBoundary = memo(DashboardDOMBoundaryInner);
