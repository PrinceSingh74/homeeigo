"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavMetricEvent = {
  from: string;
  to: string;
  commitMs: number;
  paintMs: number;
  at: number;
};

declare global {
  interface Window {
    __HOMIGO_NAV_METRICS__?: NavMetricEvent[];
    __HOMIGO_NAV_LAST__?: NavMetricEvent;
  }
}

const routeRating = (ms: number) => (ms <= 300 ? "good" : ms <= 1000 ? "needs-improvement" : "poor");

function pushMetric(event: NavMetricEvent): void {
  const list = (window.__HOMIGO_NAV_METRICS__ ??= []);
  list.push(event);
  if (list.length > 100) list.shift();
  window.__HOMIGO_NAV_LAST__ = event;

  if (process.env.NODE_ENV === "development") {
    console.debug(
      `[nav] ${event.from} → ${event.to} commit=${event.commitMs}ms paint=${event.paintMs}ms (${routeRating(event.paintMs)})`,
    );
  }
}

/** Records sidebar/link click → pathname commit → first paint for audit probes. */
export function RouteTransitionTracker() {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const navStart = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (href && href.startsWith("/") && !href.startsWith("//")) {
        navStart.current = performance.now();
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      prevPath.current = pathname;
      return;
    }
    if (navStart.current == null) {
      prevPath.current = pathname;
      return;
    }

    const start = navStart.current;
    const commitMs = Math.round(performance.now() - start);
    navStart.current = null;
    const from = prevPath.current;
    prevPath.current = pathname;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pushMetric({
          from,
          to: pathname,
          commitMs,
          paintMs: Math.round(performance.now() - start),
          at: Date.now(),
        });
      });
    });
  }, [pathname]);

  return null;
}
