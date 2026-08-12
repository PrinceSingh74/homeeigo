"use client";

import { useAppStore } from "@/stores/app-store";
import { ServicesCatalogModal } from "@/components/overlays/ServicesCatalogModal";

const CATALOG_MODES = [
  "services-categories",
  "services-trending",
  "services-ai",
  "services-reviews",
] as const;

export function ServicesOverlays() {
  const overlay = useAppStore((s) => s.overlay);
  // Mount only the ACTIVE catalog modal — rendering all four just to pass
  // open={false} forces their chunks to load on every page.
  const active = CATALOG_MODES.find((m) => m === overlay);
  if (!active) return null;
  return <ServicesCatalogModal open mode={active} />;
}
