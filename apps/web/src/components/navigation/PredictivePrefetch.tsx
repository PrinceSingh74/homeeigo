"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Only warm the primary tabs. Prefetching every in-viewport service URL
 * (`/services/vehicle-care/...`) made Turbopack compile dozens of catch-all
 * routes at once, so Home ↔ Services waited 10–120s in the compiler queue.
 */
const PREFETCH_ALLOW = new Set([
  "/",
  "/services",
  "/bookings",
  "/wallet",
  "/profile",
  "/ai",
  "/book",
  "/membership",
  "/login",
  "/providers",
  "/support",
]);

/**
 * Predictive navigation. Warms a route's RSC the moment the user shows intent
 * — pointerover / touchstart — so the click can commit from cache.
 */
export function PredictivePrefetch() {
  const router = useRouter();
  const done = useRef<Set<string>>(new Set());

  useEffect(() => {
    const warm = (href: string | null | undefined) => {
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      const path = href.split(/[?#]/)[0];
      if (!PREFETCH_ALLOW.has(path)) return;
      if (done.current.has(path)) return;
      done.current.add(path);
      try {
        router.prefetch(path);
      } catch {
        /* prefetch is best-effort; never break interaction */
      }
    };
    const onIntent = (e: Event) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && a.target !== "_blank") warm(a.getAttribute("href"));
    };
    document.addEventListener("pointerover", onIntent, { capture: true });
    document.addEventListener("touchstart", onIntent, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerover", onIntent, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchstart", onIntent, { capture: true } as EventListenerOptions);
    };
  }, [router]);

  return null;
}
