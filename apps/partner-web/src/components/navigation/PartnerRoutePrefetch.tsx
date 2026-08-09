"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Primary console tabs — warmed on idle so every tab opens instantly.
const PREFETCH_ROUTES = [
  "/",
  "/requests",
  "/earnings",
  "/wallet",
  "/map",
  "/navigation",
  "/analytics",
  "/availability",
  "/notifications",
  "/profile",
  "/support",
] as const;

export function PartnerRoutePrefetch() {
  const router = useRouter();

  useEffect(() => {
    const run = () => {
      for (const href of PREFETCH_ROUTES) {
        try {
          router.prefetch(href);
        } catch {
          /* dev-only */
        }
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 500);
    return () => clearTimeout(t);
  }, [router]);

  return null;
}
