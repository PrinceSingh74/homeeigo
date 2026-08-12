"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { SectionErrorBoundary } from "@/components/errors/SectionErrorBoundary";

function SectionFallback() {
  return (
    <div className="mx-auto max-w-[1440px] px-[var(--svc-page-pad)] py-12">
      <div className="h-40 animate-pulse rounded-2xl bg-gray-100/80" aria-hidden />
    </div>
  );
}

const HomeCareSection = dynamic(
  () =>
    import("@/components/services-page/sections/HomeCareSection").then(
      (m) => m.HomeCareSection,
    ),
  { loading: () => <SectionFallback /> },
);
const PremiumCareSection = dynamic(
  () =>
    import("@/components/services-page/sections/PremiumCareSection").then(
      (m) => m.PremiumCareSection,
    ),
  { loading: () => <SectionFallback /> },
);
const LaundrySection = dynamic(
  () =>
    import("@/components/services-page/sections/LaundrySection").then(
      (m) => m.LaundrySection,
    ),
  { loading: () => <SectionFallback /> },
);
const OutdoorSection = dynamic(
  () =>
    import("@/components/services-page/sections/OutdoorSection").then(
      (m) => m.OutdoorSection,
    ),
  { loading: () => <SectionFallback /> },
);
const ExpressSection = dynamic(
  () =>
    import("@/components/services-page/sections/ExpressSection").then(
      (m) => m.ExpressSection,
    ),
  { loading: () => <SectionFallback /> },
);
const FutureServicesSection = dynamic(
  () =>
    import("@/components/services-page/sections/FutureServicesSection").then(
      (m) => m.FutureServicesSection,
    ),
  { loading: () => <SectionFallback /> },
);
const WhyHomigoSection = dynamic(
  () =>
    import("@/components/services-page/sections/WhyHomigoSection").then(
      (m) => m.WhyHomigoSection,
    ),
  { loading: () => <SectionFallback /> },
);
const CitiesSection = dynamic(
  () =>
    import("@/components/services-page/sections/CitiesSection").then(
      (m) => m.CitiesSection,
    ),
  { loading: () => <SectionFallback /> },
);
const HowItWorksSection = dynamic(
  () =>
    import("@/components/services-page/sections/HowItWorksSection").then(
      (m) => m.HowItWorksSection,
    ),
  { loading: () => <SectionFallback /> },
);
const FinalCTASection = dynamic(
  () =>
    import("@/components/services-page/sections/FinalCTASection").then(
      (m) => m.FinalCTASection,
    ),
  { loading: () => <SectionFallback /> },
);
const TransparentPricingSection = dynamic(
  () =>
    import("@/components/services-page/sections/TransparentPricingSection").then(
      (m) => m.TransparentPricingSection,
    ),
  { loading: () => <SectionFallback /> },
);
const CustomerReviewsSection = dynamic(
  () =>
    import("@/components/services-page/sections/CustomerReviewsSection").then(
      (m) => m.CustomerReviewsSection,
    ),
  { loading: () => <SectionFallback /> },
);
const AiSchedulingSection = dynamic(
  () =>
    import("@/components/services-page/sections/AiSchedulingSection").then(
      (m) => m.AiSchedulingSection,
    ),
  { loading: () => <SectionFallback /> },
);

export function ServicesBelowFold() {
  return (
    <Suspense fallback={<SectionFallback />}>
      <SectionErrorBoundary fallbackTitle="Unable to load Home Care services.">
        <HomeCareSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load Premium Care services.">
        <PremiumCareSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load Laundry services.">
        <LaundrySection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load Outdoor services.">
        <OutdoorSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load Express services.">
        <ExpressSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load upcoming services.">
        <FutureServicesSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load pricing section.">
        <TransparentPricingSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load customer reviews.">
        <CustomerReviewsSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load trust section.">
        <WhyHomigoSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load cities section.">
        <CitiesSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load how it works section.">
        <HowItWorksSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load AI scheduling section.">
        <AiSchedulingSection />
      </SectionErrorBoundary>
      <SectionErrorBoundary fallbackTitle="Unable to load CTA section.">
        <FinalCTASection />
      </SectionErrorBoundary>
    </Suspense>
  );
}
