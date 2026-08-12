"use client";

import { SectionHeader } from "@/components/services-page/sections/SectionHeader";
import { ServiceMarketplaceCard } from "@/components/services-page/sections/ServiceMarketplaceCard";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function OutdoorSection() {
  const nav = useServicesNavigation();
  const { outdoor } = useMarketplaceSections();

  return (
    <section
      id="outdoor"
      className={servicesSection(
        "bg-gradient-to-br from-emerald-50/80 via-white to-sky-50/60 py-16 sm:py-20 lg:py-24",
      )}
    >
      <SectionHeader
        icon={<span className="text-3xl" aria-hidden>🌳</span>}
        title="Outdoor"
        subtitle="Care beyond your home"
        onViewAll={nav.openCategories}
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {outdoor.map((service, i) => (
          <ServiceMarketplaceCard
            key={service.id}
            service={service}
            index={i}
            variant="outdoor"
          />
        ))}
      </div>
    </section>
  );
}
