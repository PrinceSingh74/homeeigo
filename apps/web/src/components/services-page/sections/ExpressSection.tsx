"use client";

import { Zap } from "lucide-react";
import { SectionHeader } from "@/components/services-page/sections/SectionHeader";
import { ServiceMarketplaceCard } from "@/components/services-page/sections/ServiceMarketplaceCard";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function ExpressSection() {
  const nav = useServicesNavigation();
  const { express } = useMarketplaceSections();

  return (
    <section id="express" className={servicesSection("bg-white py-16 sm:py-20 lg:py-24")}>
      <SectionHeader
        icon={<Zap className="size-8 text-amber-500" aria-hidden />}
        title="Express Services"
        subtitle="For your special occasions"
        onViewAll={nav.openTrending}
      />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {express.map((service, i) => (
          <ServiceMarketplaceCard
            key={service.id}
            service={service}
            index={i}
            variant="express"
          />
        ))}
      </div>
    </section>
  );
}
