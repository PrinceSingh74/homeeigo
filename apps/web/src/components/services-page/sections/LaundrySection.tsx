"use client";

import { SectionHeader } from "@/components/services-page/sections/SectionHeader";
import { ServiceMarketplaceCard } from "@/components/services-page/sections/ServiceMarketplaceCard";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function LaundrySection() {
  const { laundry } = useMarketplaceSections();
  return (
    <section id="laundry" className={servicesSection("bg-white py-16 sm:py-20 lg:py-24")}>
      <SectionHeader
        icon={<span className="text-3xl" aria-hidden>👕</span>}
        title="Laundry & Wardrobe"
        subtitle="Fresh, clean & well-organized"
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {laundry.map((service, i) => (
          <ServiceMarketplaceCard
            key={service.id}
            service={service}
            index={i}
            showFreshness
          />
        ))}
      </div>
    </section>
  );
}
