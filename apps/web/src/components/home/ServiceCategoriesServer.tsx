import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PopularServicesGrid } from "@/components/home/PopularServicesGrid";
import { PopularServicesLive } from "@/components/home/PopularServicesLive";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { sectionAction } from "@/lib/page-layout";
import type { BackendService } from "@/types/backend";
import { cn } from "@/lib/utils";

export function ServiceCategoriesServer({
  services: apiServices,
}: {
  services: BackendService[] | null;
}) {
  // Backend-curated marketplace wall (services flagged isPopular, already
  // popularity-ranked by the API) — the full 20-service catalog grid.
  const popular =
    apiServices
      ?.filter((s) => s.isPopular)
      .map((s) => ({
        id: s.id,
        name: s.name ?? "Service",
        price: `₹${s.basePrice ?? s.minPrice ?? 0}`,
        featured: s.isFeatured ?? false,
        thumbnail: s.thumbnail ?? null,
      })) ?? [];

  return (
    <PageSection>
      <SectionHeader
        title="Popular Services"
        action={
          <Link
            href="/services"
            className={cn(sectionAction, "inline-flex items-center gap-1")}
          >
            Explore full catalog
            <ArrowRight size={16} aria-hidden />
          </Link>
        }
      />
      {popular.length > 0 ? (
        <PopularServicesGrid services={popular} />
      ) : (
        // SSR fetch failed (backend down/slow at render time) — recover on the
        // client with live data instead of static demo cards.
        <PopularServicesLive />
      )}
    </PageSection>
  );
}
