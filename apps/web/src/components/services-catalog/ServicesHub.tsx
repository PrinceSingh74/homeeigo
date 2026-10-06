"use client";

import { useDeferredValue, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  EMPTY_FILTERS,
  categoryHref,
  type Catalog,
  type FilterState,
  type ServiceView,
} from "@/lib/catalog";
import type { BackendService } from "@/types/backend";
import { useCatalog } from "@/hooks/use-catalog";
import { heroTitle, pageMainBottom, pageSection, sectionSubtitle } from "@/lib/page-layout";
import { ServiceSearch } from "@/components/services-catalog/ServiceSearch";
import { ServiceCategoryNav } from "@/components/services-catalog/ServiceCategoryNav";
import { ServiceRail } from "@/components/services-catalog/ServiceGrid";
import { ServiceJobCard } from "@/components/services-catalog/ServiceCard";
import { CatalogError, ServiceSkeleton } from "@/components/services-catalog/ServiceStates";
import { IconTile, SectionHeading, band, focusRing, textLink } from "@/components/services-catalog/primitives";
import { BrandHeroWash, BrandMesh } from "@/components/layout/BrandCanvas";
import { cn } from "@/lib/utils";

// Below-the-fold sections and the search view are code-split. SSR still renders
// them (SEO and first paint are unchanged); only their JS loads asynchronously.
const HubSections = dynamic(() => import("@/components/services-catalog/HubSections"));
const SearchResults = dynamic(() => import("@/components/services-catalog/HubSearchResults"), {
  loading: () => <ServiceSkeleton count={4} />,
});

const PAGE_NAV = [
  { label: "Services", href: "/services" },
  { label: "Categories", href: "#categories" },
  { label: "Popular", href: "#popular" },
  { label: "Hourly help", href: "#hourly" },
  { label: "Beauty", href: categoryHref("beauty") },
  { label: "Cleaning", href: categoryHref("home-cleaning") },
  { label: "Maintenance", href: categoryHref("home-maintenance") },
  { label: "Coming soon", href: "#coming-soon" },
];

/** The hero photo when the catalogue has no bookable service with a photo of its own. */
const HERO_PHOTO = "/services/bathroom-cleaning.png";

export function ServicesHub({ initialServices }: { initialServices: BackendService[] | null }) {
  const state = useCatalog(initialServices);
  const catalog = state.status === "ready" ? state.catalog : null;

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const activeQuery = useDeferredValue(submitted);

  // Shareable search: /services?q=… (read once, written with replaceState).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (q) {
      setQuery(q);
      setSubmitted(q);
    }
  }, []);

  const runSearch = (q: string) => {
    const next = q.trim();
    setSubmitted(next);
    setFilters(EMPTY_FILTERS);
    window.history.replaceState(null, "", next ? `/services?q=${encodeURIComponent(next)}` : "/services");
    if (next) requestAnimationFrame(() => document.getElementById("search-results")?.scrollIntoView({ block: "start" }));
  };

  return (
    <main className={cn("relative overflow-x-clip bg-transparent", pageMainBottom, "lg:pb-20")}>
      <BrandMesh />
      <HubHero catalog={catalog}>
        <ServiceSearch catalog={catalog} value={query} onChange={setQuery} onSubmit={runSearch} />
      </HubHero>

      <ServiceCategoryNav active="all" />

      <div className={cn(pageSection, "pt-10 sm:pt-14")}>
        {state.status === "loading" && <ServiceSkeleton />}
        {state.status === "error" && <CatalogError onRetry={state.retry} />}
        {catalog &&
          (activeQuery ? (
            <SearchResults
              catalog={catalog}
              query={activeQuery}
              filters={filters}
              onFilters={setFilters}
              onClear={() => {
                setQuery("");
                runSearch("");
              }}
            />
          ) : (
            <Editorial catalog={catalog} />
          ))}
      </div>

      <footer className={cn(pageSection, "mt-16 border-t border-line py-10 sm:mt-20")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="font-display text-base font-bold text-brand">HOMEEIGO</p>
          <p className="text-sm text-muted">Home services, delivered with care. Made in India.</p>
        </div>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** The bookable service shown on the hero job card: a real one, with its own photo. */
function heroService(catalog: Catalog | null): ServiceView | null {
  if (!catalog) return null;
  const withPhoto = catalog.services.filter((s) => s.status === "live" && s.image && !s.hourly);
  return withPhoto.find((s) => s.popular) ?? withPhoto[0] ?? null;
}

function HubHero({ catalog, children }: { catalog: Catalog | null; children: React.ReactNode }) {
  const liveCategories = catalog?.categories.filter((c) => c.liveCount > 0).length ?? 0;
  const featured = heroService(catalog);
  return (
    // z-40: the search suggestions must open over the sticky category bar below.
    <section aria-labelledby="services-hero-title" className="relative z-40 border-b border-line/60">
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        <BrandHeroWash />
      </div>
      <div className={cn(pageSection, "relative pb-10 pt-3 sm:pb-14 sm:pt-4 lg:pb-16")}>
        <nav aria-label="Services page" className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <ul className="flex gap-5 text-sm">
            {PAGE_NAV.map((item, i) => (
              <li key={item.label} className="shrink-0">
                <Link
                  href={item.href}
                  prefetch={item.href === "/services" || item.href.startsWith("#")}
                  aria-current={i === 0 ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md",
                    i === 0
                      ? "font-semibold text-content underline decoration-emerald-500 decoration-2 underline-offset-8"
                      : "text-muted hover:text-content",
                    focusRing,
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 grid items-center gap-10 lg:mt-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
          <div className="min-w-0 motion-safe:animate-catalog-in">
            <h1 id="services-hero-title" className={cn(heroTitle, "max-w-xl text-balance")}>
              Everything your home needs. One trusted place.
            </h1>
            <p className={cn(sectionSubtitle, "mt-5 max-w-lg")}>
              From everyday home help to cleaning, repairs, beauty, care and convenience — book trusted services at
              your doorstep.
            </p>
            <div className="mt-7 max-w-xl">{children}</div>
            <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
              {catalog && (
                <span>
                  <span className="font-semibold tabular-nums text-content">{catalog.liveCount}</span> services bookable
                  now, across {liveCategories} categories
                </span>
              )}
              <Link href="#categories" className={cn(textLink, "inline-flex min-h-11 items-center", focusRing)}>
                Browse categories
              </Link>
              <Link href="#hourly" className={cn(textLink, "inline-flex min-h-11 items-center", focusRing)}>
                Book hourly help
              </Link>
            </p>
          </div>

          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-canvas shadow-e3 lg:aspect-[5/5.2]">
              <Image
                src={featured?.image ?? HERO_PHOTO}
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 92vw, 560px"
                className="object-cover object-[55%_30%]"
              />
            </div>
            {featured && (
              <ServiceJobCard
                service={featured}
                className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-5 sm:left-5 sm:w-[22rem] lg:-left-8 lg:bottom-8"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Editorial({ catalog }: { catalog: Catalog }) {
  const popular = catalog.services.filter((s) => s.status === "live" && s.popular).slice(0, 8);

  return (
    <div className="space-y-14 sm:space-y-16">
      {/* Categories — a directory you read, not a wall of tiles */}
      <section id="categories" aria-labelledby="categories-heading" className="scroll-mt-32">
        <SectionHeading
          id="categories-heading"
          title="All services, by category"
          subtitle="Everything we do, organised the way you think about your home."
        />
        <ul className="grid gap-x-12 border-b border-line sm:grid-cols-2 lg:grid-cols-3">
          {catalog.categories.map((c) => (
            <li key={c.def.id} className="border-t border-line">
              <Link
                href={categoryHref(c.def.id)}
                prefetch={false}
                className={cn(
                  "group flex h-full items-start gap-4 rounded-lg py-4 motion-safe:transition-colors sm:py-5",
                  "hover:bg-emerald-50/60 dark:hover:bg-emerald-500/[0.06] sm:px-2",
                  focusRing,
                )}
              >
                <IconTile icon={c.def.icon} tone={c.def.tone} className="mt-0.5 size-10" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-xl font-semibold leading-tight tracking-tight text-content sm:text-2xl">
                    {c.def.name}
                  </span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-muted">{c.def.tagline}</span>
                  <span className={cn("mt-2 block text-sm font-medium", c.liveCount > 0 ? "text-brand" : "text-muted")}>
                    {c.liveCount > 0 ? `${c.liveCount} of ${c.services.length} bookable now` : "Coming soon"}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="mt-1.5 size-5 shrink-0 text-brand opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Popular */}
      {popular.length > 0 && (
        <section id="popular" aria-labelledby="popular-heading" className={cn(band, "scroll-mt-32")}>
          <SectionHeading
            id="popular-heading"
            title="Popular right now"
            subtitle="Services our team currently highlights as popular."
          />
          <ServiceRail services={popular} label="Popular services" />
        </section>
      )}

      <HubSections catalog={catalog} />
    </div>
  );
}
