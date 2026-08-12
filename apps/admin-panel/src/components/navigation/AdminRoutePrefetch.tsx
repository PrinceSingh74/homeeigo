"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAllNavHrefs } from "@/lib/hq-navigation";

/** High-traffic admin routes — warmed first, before the rest of the nav tree. */
const PRIORITY_ROUTES = [
  "/",
  "/hq/operations",
  "/hq/marketplace",
  "/hq/finance",
  "/command-center",
  "/operations",
  "/bookings",
  "/customers",
  "/vendors",
  "/finance/dashboard",
  "/observability",
  "/analytics",
] as const;

const IDLE_BATCH_SIZE = 8;

export function AdminRoutePrefetch() {
  const router = useRouter();

  // Warm ALL nav routes on idle, in small batches so we never burst the network.
  useEffect(() => {
    const routes = [...new Set([...PRIORITY_ROUTES, ...getAllNavHrefs()])];
    let cursor = 0;
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const schedule = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(fn, { timeout: 3000 });
      } else {
        timerId = setTimeout(fn, 400);
      }
    };

    const runBatch = () => {
      if (cancelled) return;
      const batch = routes.slice(cursor, cursor + IDLE_BATCH_SIZE);
      cursor += IDLE_BATCH_SIZE;
      for (const href of batch) {
        try {
          router.prefetch(href);
        } catch {
          /* dev-only */
        }
      }
      if (cursor < routes.length) schedule(runBatch);
    };

    schedule(runBatch);
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, [router]);

  // Hover / touch intent → prefetch immediately, before the click lands.
  useEffect(() => {
    const seen = new Set<string>();

    const warm = (target: EventTarget | null) => {
      const a = (target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (a?.target === "_blank" || a?.hasAttribute("download")) return;
      const path = href.split("#")[0]!.split("?")[0]!;
      if (seen.has(path)) return;
      seen.add(path);
      try {
        router.prefetch(path);
      } catch {
        /* dev-only */
      }
    };

    const onMouseOver = (e: MouseEvent) => warm(e.target);
    const onTouchStart = (e: TouchEvent) => warm(e.target);

    document.addEventListener("mouseover", onMouseOver, { passive: true });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("touchstart", onTouchStart);
    };
  }, [router]);

  return null;
}
