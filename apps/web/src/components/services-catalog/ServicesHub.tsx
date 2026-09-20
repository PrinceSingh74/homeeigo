"use client";

import { useDeferredValue, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EMPTY_FILTERS, categoryHref, type Catalog, type FilterState } from "@/lib/catalog";
import type { BackendService } from "@/types/backend";
import { useCatalog } from "@/hooks/use-catalog";
import { heroTitle, pageMainBottom, pageSection, pageSectionGap, sectionSubtitle } from "@/lib/page-layout";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { ServiceSearch } from "@/components/services-catalog/ServiceSearch";
import { ServiceCategoryNav } from "@/components/services-catalog/ServiceCategoryNav";
import { ServiceRail } from "@/components/services-catalog/ServiceGrid";
import { CatalogError, ServiceSkeleton } from "@/components/services-catalog/ServiceStates";
import { IconTile, SectionHeading, cardHover, cardSurface, eyebrow, focusRing } from "@/components/services-catalog/primitives";
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
  { label: "Hourly Help", href: "#hourly" },
  { label: "Beauty", href: categoryHref("beauty") },
  { label: "Cleaning", href: categoryHref("home-cleaning") },
  { label: "Maintenance", href: categoryHref("home-maintenance") },
  { label: "Coming Soon", href: "#coming-soon" },
];

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
    <main className={cn("relative overflow-x-clip bg-canvas", pageMainBottom, "lg:pb-20")}>
      <HubHero catalog={catalog} />

      <div className={cn(pageSection, "relative z-20 -mt-8 sm:-mt-10")}>
        <div className="mx-auto max-w-3xl">
          <ServiceSearch catalog={catalog} value={query} onChange={setQuery} onSubmit={runSearch} />
        </div>
      </div>

      <div className="mt-8">
        <ServiceCategoryNav active="all" />
      </div>

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

      <footer className={cn(pageSection, pageSectionGap, "border-t border-line py-10 text-center")}>
        <p className="font-display text-base font-bold text-brand">HOMEEIGO</p>
        <p className="mt-2 text-sm text-muted">Home services, delivered with care · Made in India</p>
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function HubHero({ catalog }: { catalog: Catalog | null }) {
  const liveCategories = catalog?.categories.filter((c) => c.liveCount > 0).length ?? 0;
  return (
    <section aria-labelledby="services-hero-title" className="relative overflow-hidden border-b border-line/60 bg-surface">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_0%,rgb(16_185_129/0.10),transparent_70%),radial-gradient(40%_60%_at_0%_100%,rgb(20_184_166/0.08),transparent_70%)]"
      />
      <div className={cn(pageSection, "relative pb-20 pt-6 sm:pb-24 sm:pt-8 lg:pb-28")}>
        <nav aria-label="Services page" className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <ul className="flex gap-1 text-sm">
            {PAGE_NAV.map((item, i) => (
              <li key={item.label} className="shrink-0">
                <Link
                  href={item.href}
                  prefetch={item.href === "/services" || item.href.startsWith("#")}
                  aria-current={i === 0 ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full px-3 font-medium",
                    i === 0 ? "bg-canvas text-content" : "text-muted hover:text-content",
                    focusRing,
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 grid items-center gap-12 lg:mt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="motion-safe:animate-catalog-in">
            <p className={eyebrow}>HOMEEIGO — All Services</p>
            <h1 id="services-hero-title" className={cn(heroTitle, "mt-4 max-w-xl text-balance")}>
              Everything Your Home Needs. One Trusted Place.
            </h1>
            <p className={cn(sectionSubtitle, "mt-5 max-w-lg")}>
              From everyday home help to cleaning, repairs, beauty, care and convenience — book trusted services at
              your doorstep.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#categories" variant="primary" size="xl">
                Explore Services
                <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="#hourly" variant="secondary" size="xl">
                Book Hourly Help
              </ButtonLink>
            </div>
          </div>

          <div className="relative hidden lg:block" aria-hidden>
            <div className="grid aspect-square grid-cols-5 grid-rows-6 gap-3">
              <div className="relative col-span-3 row-span-6 overflow-hidden rounded-3xl shadow-e3">
                <Image src="/services/bathroom-cleaning.png" alt="" fill sizes="340px" className="object-cover object-[60%_50%]" />
              </div>
              <div className="relative col-span-2 row-span-3 overflow-hidden rounded-3xl shadow-e2">
                <Image src="/services/kitchen-prep.png" alt="" fill sizes="230px" className="object-cover" />
              </div>
              <div className="relative col-span-2 row-span-3 overflow-hidden rounded-3xl shadow-e2">
                <Image src="/services/laundry.png" alt="" fill sizes="230px" className="object-cover" />
              </div>
            </div>
            {catalog && (
              <div className="absolute -bottom-6 -left-6 rounded-2xl border border-line bg-surface/95 px-5 py-4 shadow-e4 backdrop-blur">
                <p className="font-display text-2xl font-bold tabular-nums text-content">{catalog.liveCount}</p>
                <p className="text-sm text-muted">
                  services bookable now, across {liveCategories} categories
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

function Editorial({ catalog }: { catalog: Catalog }) {
  const popular = catalog.services.filter((s) => s.status === "live" && s.popular).slice(0, 8);

  return (
    <div className="space-y-20 sm:space-y-24">
      {/* Categories */}
      <section id="categories" aria-labelledby="categories-heading" className="scroll-mt-32">
        <SectionHeading
          id="categories-heading"
          kicker={`${catalog.categories.length} categories`}
          title="All services, by category"
          subtitle="Everything we do, organised the way you think about your home."
        />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {catalog.categories.map((c) => (
            <li key={c.def.id}>
              <Link
                href={categoryHref(c.def.id)}
                prefetch={false}
                className={cn("group flex h-full flex-col gap-4 p-4 sm:p-5", cardSurface, cardHover, focusRing)}
              >
                <IconTile icon={c.def.icon} tone={c.def.tone} className="size-11" />
                <span className="mt-auto">
                  <span className="block font-semibold leading-snug text-content">{c.def.name}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {c.liveCount > 0 ? `${c.liveCount} bookable · ${c.services.length} services` : "Coming soon"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Popular */}
      {popular.length > 0 && (
        <section id="popular" aria-labelledby="popular-heading" className="scroll-mt-32">
          <SectionHeading
            id="popular-heading"
            kicker="Popular"
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
