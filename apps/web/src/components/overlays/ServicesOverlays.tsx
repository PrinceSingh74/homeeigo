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

  return (
    <>
      {CATALOG_MODES.map((m) => (
        <ServicesCatalogModal
          key={m}
          open={overlay === m}
          mode={m}
        />
      ))}
    </>
  );
}
