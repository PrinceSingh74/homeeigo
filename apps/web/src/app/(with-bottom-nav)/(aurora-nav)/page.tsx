import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { HomeBelowFold } from "@/components/home/HomeBelowFold";
import { HeroSectionServer } from "@/components/home/HeroSectionServer";
import { ServiceCategoriesServer } from "@/components/home/ServiceCategoriesServer";
import { CategoryShowcase } from "@/components/home/CategoryShowcase";
import { ReviewsSectionServer } from "@/components/home/ReviewsSectionServer";
import {
  fetchServicesCatalog,
  fetchStatsOverview,
} from "@/lib/server-api";
import { pageMainBottom } from "@/lib/page-layout";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { WeatherWarningBanner } from "@/components/weather/WeatherWarningBanner";
import { cn } from "@/lib/utils";

const HomeSearchBar = dynamic(
  () => import("@/components/SearchBar").then((m) => ({ default: m.SearchBar })),
  { loading: () => <div className="mx-auto h-16 max-w-content animate-pulse rounded-2xl bg-surface/40 px-4" /> },
);

export const metadata: Metadata = {
  title: "HOMEEIGO — Book Trusted Home Services Online",
  description:
    "Book verified professionals for cleaning, AC repair, plumbing, electrical work and more. AI-powered matching, real-time tracking, and secure payments across India.",
  alternates: { canonical: "/" },
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "HOMEEIGO",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app",
  description: "AI-powered home services marketplace in India.",
  areaServed: "IN",
  sameAs: [],
};

export default async function Home() {
  const [stats, catalog] = await Promise.all([
    fetchStatsOverview(),
    fetchServicesCatalog(),
  ]);

  return (
    <main className={cn("bg-transparent", pageMainBottom)}>
      {/* Whole-page canvas — EXACT Services-page hero background applied across
          the full viewport: linear-gradient(135deg,#ffffff,#f0fdf4 35%,#ffffff)
          + emerald/teal orbs. Fixed, ~zero GPU cost. Dark-safe. */}
      <div aria-hidden className="mesh-bg">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_35%,#ffffff_100%)] dark:hidden" />
        <div className="absolute inset-0 hidden bg-canvas dark:block" />
        <div className="absolute right-[-6%] top-[-6%] size-[42rem] rounded-full bg-emerald-100/40 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute bottom-[-8%] left-[-8%] size-[38rem] rounded-full bg-teal-100/30 blur-3xl dark:bg-teal-500/10" />
      </div>
      <div className="px-4 pt-3">
        <WeatherWarningBanner />
      </div>
      <HeroSectionServer stats={stats} />
      <HomeSearchBar />
      <div id="services">
        <ServiceCategoriesServer services={catalog?.services ?? null} />
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
