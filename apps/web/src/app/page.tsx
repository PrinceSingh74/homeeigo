import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";
import { FeatureBanner } from "@/components/FeatureBanner";
import { OffersSection } from "@/components/OffersSection";
import { BottomNav } from "@/components/BottomNav";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="bg-canvas pb-28 lg:pb-0">
        <HeroSection />
        <SearchBar />
        <ServiceCategories />
        <FeatureBanner />
        <OffersSection />

        <footer className="mx-auto mt-20 max-w-content px-6 pb-12 text-center">
          <p className="font-display text-lg font-bold text-aurora">HOMIGO</p>
          <p className="mt-1 text-sm text-muted">
            The Future of Home Services · Made with 💜 in India
          </p>
        </footer>
      </main>
      <BottomNav />
    </>
  );
}
