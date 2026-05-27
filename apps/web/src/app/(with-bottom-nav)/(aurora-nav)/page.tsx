import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";
import { FeatureBanner } from "@/components/FeatureBanner";
import { OffersSection } from "@/components/OffersSection";
import { RecommendedSection } from "@/components/RecommendedSection";
import { TrustSection } from "@/components/TrustSection";
import { PremiumSection } from "@/components/PremiumSection";
import { LiveTrackingSection } from "@/components/LiveTrackingSection";
import { FinalCtaSection } from "@/components/FinalCtaSection";
import { pageMainBottom, pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className={cn("bg-transparent", pageMainBottom)}>
      <HeroSection />
      <SearchBar />
      <div id="services">
        <ServiceCategories />
      </div>
      <FeatureBanner />
      <div id="offers">
        <OffersSection />
      </div>
      <div id="recommended">
        <RecommendedSection />
      </div>
      <TrustSection />
      <PremiumSection />
      <div id="tracking">
        <LiveTrackingSection />
      </div>
      <FinalCtaSection />

      <footer
        className={`${pageSection} mt-16 pb-12 text-center sm:mt-20`}
      >
        <p className="font-display text-lg font-bold text-aurora">HOMIGO</p>
        <p className="mt-1 text-sm text-muted">
          The Future of Home Services · Made with 💜 in India
        </p>
      </footer>
    </main>
  );
}
