"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PREFETCH_ROUTES = [
  "/",
  "/services",
  "/bookings",
  "/wallet",
  "/profile",
  "/ai",
  "/book",
  "/membership",
] as const;

/** Warm route JS on idle so tab navigation feels instant. */
export function RoutePrefetch() {
  const router = useRouter();

  useEffect(() => {
    const run = () => {
      for (const href of PREFETCH_ROUTES) {
        try {
          router.prefetch(href);
        } catch {
          /* ignore prefetch failures in dev */
        }
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
  }, [router]);

  return null;
}
