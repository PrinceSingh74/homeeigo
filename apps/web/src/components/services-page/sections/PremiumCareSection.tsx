"use client";

import { SectionHeader } from "@/components/services-page/sections/SectionHeader";
import { ServiceMarketplaceCard } from "@/components/services-page/sections/ServiceMarketplaceCard";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";
import { servicesSection } from "@/components/services-page/services-page-layout";

export function PremiumCareSection() {
  const { premiumCare } = useMarketplaceSections();
  return (
    <section
      id="premium-care"
      className={servicesSection(
        "relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-16 sm:py-20 lg:py-24",
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-10" aria-hidden>
        <div className="absolute top-0 right-0 size-96 rounded-full bg-emerald-500 blur-3xl" />
      </div>

      <div className="relative z-10">
        <SectionHeader
          icon={<span className="text-3xl" aria-hidden>✨</span>}
          title="Premium Care"
          subtitle="Deep cleaning for a healthier home"
          dark
        />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {premiumCare.map((service, i) => (
            <ServiceMarketplaceCard
              key={service.id}
              service={service}
              index={i}
              variant="premium"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
