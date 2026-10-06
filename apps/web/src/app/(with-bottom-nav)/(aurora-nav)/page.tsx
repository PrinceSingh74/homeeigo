import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { HomeBelowFold } from "@/components/home/HomeBelowFold";
import { HeroSectionServer } from "@/components/home/HeroSectionServer";
import { ServiceCategoriesServer } from "@/components/home/ServiceCategoriesServer";
import { CategoryShowcase } from "@/components/home/CategoryShowcase";
import { ReviewsSectionServer } from "@/components/home/ReviewsSectionServer";
import { pageMainBottom } from "@/lib/page-layout";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { WeatherWarningBanner } from "@/components/weather/WeatherWarningBanner";
import { BrandMesh } from "@/components/layout/BrandCanvas";
import { cn } from "@/lib/utils";

const HomeSearchBar = dynamic(
  () => import("@/components/SearchBar").then((m) => ({ default: m.SearchBar })),
  { loading: () => <div className="mx-auto h-16 max-w-content animate-pulse rounded-2xl bg-surface/40 px-4" /> },
);

export const revalidate = 60;

export const metadata: Metadata = {
  title: "HOMEEIGO — Book Trusted Home Services Online",
  description:
    "Book approved professionals for cleaning, AC repair, plumbing, electrical work and more. Matched to your service, area and time, with real-time tracking and secure payments across India.",
  alternates: { canonical: "/" },
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "HOMEEIGO",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app",
  description: "Home services marketplace in India.",
  areaServed: "IN",
  sameAs: [],
};

export default function Home() {
  return (
    <main className={cn("bg-transparent", pageMainBottom)}>
      <BrandMesh />
      <div className="px-4 pt-3">
        <WeatherWarningBanner />
      </div>
      <HeroSectionServer stats={null} />
      <HomeSearchBar />
      <div id="services">
        <ServiceCategoriesServer services={null} />
      </div>
      <div id="recommended">
        <CategoryShowcase />
      </div>
      <ReviewsSectionServer />
      <HomeBelowFold />

      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSONLD) }}
      />
    </main>
  );
}
