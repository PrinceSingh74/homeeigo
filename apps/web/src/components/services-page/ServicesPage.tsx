import { ServicesHero } from "@/components/services-page/ServicesHero";
import { ServicesBelowFold } from "@/components/services-page/ServicesBelowFold";
import { SectionErrorBoundary } from "@/components/errors/SectionErrorBoundary";
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
        "relative overflow-x-hidden bg-white",
        "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-20",
      )}
    >
      <SectionErrorBoundary fallbackTitle="Unable to render hero section.">
        <ServicesHero />
      </SectionErrorBoundary>

      <ServicesBelowFold />

      <footer
        className={cn(
          servicesShell,
          servicesPadX,
          "border-t border-gray-200 bg-white py-10 text-center sm:py-12",
        )}
      >
        <p className="font-display text-base font-bold text-[#1B5E4F] sm:text-lg">
          HOMEEIGO
        </p>
        <p className="mt-2 text-xs text-gray-500 sm:text-sm">
          Premium home services · Made with care in India
        </p>
      </footer>
    </main>
  );
}
