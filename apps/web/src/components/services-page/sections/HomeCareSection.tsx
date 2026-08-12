"use client";

import { SectionHeader } from "@/components/services-page/sections/SectionHeader";
import { ServiceMarketplaceCard } from "@/components/services-page/sections/ServiceMarketplaceCard";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function HomeCareSection() {
  const nav = useServicesNavigation();
  const { homeCare } = useMarketplaceSections();

  return (
    <section id="home-care" className={servicesSection("bg-white py-16 sm:py-20 lg:py-24")}>
      <SectionHeader
        icon={<span className="text-3xl" aria-hidden>🏠</span>}
        title="Home Care"
        subtitle="Daily cleaning essentials for your home"
        onViewAll={nav.openCategories}
      />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {homeCare.map((service, i) => (
          <ServiceMarketplaceCard key={service.id} service={service} index={i} />
        ))}
      </div>
    </section>
  );
}
