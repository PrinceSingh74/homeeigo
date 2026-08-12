import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ServerServiceCard } from "@/components/home/ServerServiceCard";
import { PopularServicesGrid } from "@/components/home/PopularServicesGrid";
import { SERVICES } from "@/lib/services";
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
  const staticServices = SERVICES.length
    ? SERVICES
    : [
        {
          id: "service-unavailable",
          name: "Service",
          price: "₹0",
          priceFrom: 0,
          color: "#7C3AED",
          img: undefined,
          icon: undefined,
          featured: false,
        },
      ];

  const services =
    apiServices?.map((s, i) => {
      const fallback = staticServices[i % staticServices.length]!;
      return {
        id: s.id,
        name: s.name || fallback.name,
        price: `₹${s.basePrice ?? s.minPrice ?? fallback.priceFrom}`,
        color: fallback.color,
        img: s.thumbnail ?? s.icon ?? fallback.img,
        featured: s.isFeatured ?? fallback.featured,
        premiumOnly: s.premiumOnly ?? false,
      };
    }) ?? staticServices;

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {services.slice(0, 8).map((s) => (
            <ServerServiceCard
              key={s.id}
              serviceId={s.id}
              name={s.name}
              price={s.price}
              color={s.color}
              img={s.img}
              featured={s.featured}
              premiumOnly={"premiumOnly" in s ? s.premiumOnly : false}
            />
          ))}
        </div>
      )}
    </PageSection>
  );
}
