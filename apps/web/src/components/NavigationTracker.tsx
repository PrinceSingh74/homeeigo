"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { resolveApiBase } from "@/lib/api-base";
import { rumContext } from "@/lib/telemetry/context";

/**
 * Real-user navigation telemetry that complements Core Web Vitals:
 *   • RouteChange — soft client-side navigation time (link click → new route committed).
 *   • PageLoad    — full document load time (Navigation Timing) on first paint.
 * Beaconed to /api/vitals → Prometheus (web_vitals_route_change_seconds /
 * web_vitals_page_load_seconds) → Grafana Customer-Experience dashboard.
 */
function beacon(name: string, ms: number, rating: string): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const body = JSON.stringify({ name, value: ms, rating, ...rumContext() });
  const url = `${resolveApiBase()}/api/vitals`;
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    /* best-effort telemetry */
  }
}

const routeRating = (ms: number) => (ms <= 300 ? "good" : ms <= 1000 ? "needs-improvement" : "poor");
const loadRating = (ms: number) => (ms <= 2000 ? "good" : ms <= 4000 ? "needs-improvement" : "poor");

declare global {
  interface Window {
    __HOMIGO_NAV_METRICS__?: Array<{ from: string; to: string; commitMs: number; paintMs: number; at: number }>;
    __HOMIGO_NAV_LAST__?: { from: string; to: string; commitMs: number; paintMs: number; at: number };
  }
}

export function NavigationTracker() {
  const pathname = usePathname();
  const navStart = useRef<number | null>(null);
  const first = useRef(true);

  // Record the moment an internal navigation begins (link click), to measure commit time.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (href && href.startsWith("/") && !href.startsWith("//")) navStart.current = performance.now();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      const report = () => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (nav && nav.loadEventEnd > 0) beacon("PageLoad", nav.loadEventEnd - nav.startTime, loadRating(nav.loadEventEnd - nav.startTime));
      };
      if (document.readyState === "complete") report();
      else window.addEventListener("load", report, { once: true });
      return;
    }
    if (navStart.current != null) {
      const start = navStart.current;
      const commitMs = Math.round(performance.now() - start);
      navStart.current = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paintMs = Math.round(performance.now() - start);
          beacon("RouteChange", commitMs, routeRating(commitMs));
          const event = { from: "", to: pathname, commitMs, paintMs, at: Date.now() };
          const list = (window.__HOMIGO_NAV_METRICS__ ??= []);
          list.push(event);
          if (list.length > 100) list.shift();
          window.__HOMIGO_NAV_LAST__ = event;
        });
      });
    }
  }, [pathname]);

  return null;
}
