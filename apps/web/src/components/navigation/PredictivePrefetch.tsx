"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Predictive navigation (Phase 1 + 3). Warms a route's RSC payload the moment the user shows INTENT
 * — `pointerover` (mouse hover, ~100–300ms before the click) and `touchstart` (mobile, fires ~80ms
 * before the click) on any internal link. By the time the click lands, the RSC + route chunks are
 * cached, so the commit is instant instead of paying the ~600ms cold network fetch (the measured
 * 77–96%-idle bottleneck). Each route is prefetched once (deduped); the handlers are cheap.
 */
export function PredictivePrefetch() {
  const router = useRouter();
  const done = useRef<Set<string>>(new Set());

  useEffect(() => {
    const warm = (href: string | null | undefined) => {
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      const path = href.split(/[?#]/)[0];
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
    // pointerover bubbles (pointerenter does not) → one document listener covers every link.
    document.addEventListener("pointerover", onIntent, { capture: true });
    document.addEventListener("touchstart", onIntent, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerover", onIntent, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchstart", onIntent, { capture: true } as EventListenerOptions);
    };
  }, [router]);

  return null;
}
