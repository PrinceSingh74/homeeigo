import { PopularServicesGrid } from "@/components/home/PopularServicesGrid";
import { PopularServicesLive } from "@/components/home/PopularServicesLive";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { SectionActionLink } from "@/components/layout/SectionActionLink";
import type { BackendService } from "@/types/backend";

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
        action={<SectionActionLink href="/services">Explore full catalog</SectionActionLink>}
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
