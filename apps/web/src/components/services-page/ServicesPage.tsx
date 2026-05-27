import { ServicesHero } from "@/components/services-page/ServicesHero";
import { ServicesCategoriesSection } from "@/components/services-page/ServicesCategoriesSection";
import { ServicesAiSection } from "@/components/services-page/ServicesAiSection";
import { ServicesTrendingSection } from "@/components/services-page/ServicesTrendingSection";
import { ServicesTrustSection } from "@/components/services-page/ServicesTrustSection";
import { ServicesReviewsSection } from "@/components/services-page/ServicesReviewsSection";
import { ServicesCtaSection } from "@/components/services-page/ServicesCtaSection";
import { ServicesPageBackdrop } from "@/components/services-page/ServicesPageBackdrop";
import { ServicesPremiumStrip } from "@/components/services-page/ServicesPremiumStrip";
import {
  servicesPadX,
  servicesPageRoot,
  servicesShell,
} from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

export function ServicesPage() {
  return (
    <main
      className={cn(
        servicesPageRoot,
        "relative overflow-x-hidden bg-transparent",
        "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-20",
      )}
    >
        <ServicesPageBackdrop />
        <ServicesHero />
        <ServicesPremiumStrip />
        <ServicesCategoriesSection />
        <ServicesAiSection />
        <ServicesTrendingSection />
        <ServicesTrustSection />
        <ServicesReviewsSection />
        <ServicesCtaSection />

        <footer
          className={cn(
            servicesShell,
            servicesPadX,
            "border-t border-line/60 py-10 text-center sm:py-12",
          )}
        >
          <p className="font-display text-base font-bold text-aurora sm:text-lg">
            HOMIGO
          </p>
          <p className="mt-2 text-xs text-muted sm:text-sm">
            Premium home services · Made with 💜 in India
          </p>
      </footer>
    </main>
  );
}
