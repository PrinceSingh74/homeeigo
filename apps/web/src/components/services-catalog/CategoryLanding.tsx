"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AUDIENCES,
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  BEAUTY_TYPES,
  audienceName,
  computeFacets,
  searchServices,
  sortServices,
  type Audience,
  type BeautyType,
  type Catalog,
  type CategoryId,
  type CategoryView,
  type FilterState,
  type ServiceView,
} from "@/lib/catalog";
import type { BackendService } from "@/types/backend";
import { useCatalog } from "@/hooks/use-catalog";
import { pageMainBottom, pageSection } from "@/lib/page-layout";
import { Button } from "@/components/buttons/Button";
import { ServiceCategoryNav } from "@/components/services-catalog/ServiceCategoryNav";
import { ServiceSearch } from "@/components/services-catalog/ServiceSearch";
import { ServiceFilters } from "@/components/services-catalog/ServiceFilters";
import { ServiceGrid } from "@/components/services-catalog/ServiceGrid";
import { CatalogError, ServiceEmptyState, ServiceSkeleton } from "@/components/services-catalog/ServiceStates";
import { HourlyHelpModule } from "@/components/services-catalog/HourlyHelpModule";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { BeautyAudienceSelector, BeautyCategorySelector } from "@/components/services-catalog/beauty/BeautySelectors";
import { BEAUTY_TYPE_COPY } from "@/lib/catalog/copy";
import { Breadcrumbs, IconTile, SectionHeading, eyebrow } from "@/components/services-catalog/primitives";
import { HomeHelpLanding } from "@/components/services-catalog/home-help/HomeHelpLanding";
import { BrandMesh } from "@/components/layout/BrandCanvas";
import { cn } from "@/lib/utils";

const TREATMENT_HEADER: Record<string, string> = {
  senior: "bg-amber-50/70 dark:bg-amber-500/[0.06]",
  pet: "bg-orange-50/60 dark:bg-orange-500/[0.05]",
  executive: "bg-slate-100/70 dark:bg-white/[0.03]",
  beauty: "bg-rose-50/60 dark:bg-rose-500/[0.05]",
};

export function CategoryLanding({
  initialServices,
  categoryId,
  audience,
}: {
  initialServices: BackendService[] | null;
  categoryId: CategoryId;
  audience?: Audience;
}) {
  const state = useCatalog(initialServices);
  const catalog = state.status === "ready" ? state.catalog : null;
  const category = catalog?.categories.find((c) => c.def.id === categoryId);

  return (
    <main className={cn("relative overflow-x-clip bg-transparent", pageMainBottom, "lg:pb-20")}>
      <BrandMesh />
      {state.status === "ready" && category ? (
        <Landing catalog={state.catalog} category={category} audience={audience} />
      ) : (
        <>
          <ServiceCategoryNav active={categoryId} />
          <div className={cn(pageSection, "py-12")}>
            {state.status === "error" ? <CatalogError onRetry={state.retry} /> : <ServiceSkeleton />}
          </div>
        </>
      )}
    </main>
  );
}

function Landing({
  catalog,
  category,
  audience,
}: {
  catalog: Catalog;
  category: CategoryView;
  audience?: Audience;
}) {
  const { def } = category;
  const isBeauty = def.id === "beauty";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const q = useDeferredValue(query);

  // Audience pages list every service that audience is eligible for (config-driven).
  const base = useMemo(
    () => (audience ? category.services.filter((s) => s.audiences.includes(audience)) : category.services),
    [category.services, audience],
  );
  const searched = useMemo(() => {
    if (!q.trim()) return base;
    const hits = new Set(searchServices(catalog, q).map((r) => r.service.slug));
    return base.filter((s) => hits.has(s.slug));
  }, [base, catalog, q]);
  const facets = useMemo(() => {
    const f = computeFacets(searched, def.id);
    // The audience is the page itself — no audience filter on an audience page.
    return audience ? { ...f, audiences: [], beautyTypes: [] } : f;
  }, [searched, def.id, audience]);
  const filtered = useMemo(() => sortServices(applyFilters(searched, filters), filters.sort), [searched, filters]);

  const browsing = !q.trim() && activeFilterCount(filters) === 0 && filters.sort === "recommended";
  const title = audience ? `Beauty for ${audienceName(audience)}` : def.name;
  const liveHere = base.filter((s) => s.status === "live").length;
  const hourly = def.id === "home-help" ? catalog.bySlug.get("hourly-home-help") : undefined;

  const crumbs = [
    { label: "Services", href: "/services" },
    ...(audience ? [{ label: def.name, href: `/services/${def.id}` }, { label: audienceName(audience) }] : [{ label: def.name }]),
  ];

  if (def.id === "home-help") {
    return (
      <HomeHelpLanding
        catalog={catalog}
        category={category}
        query={query}
        setQuery={setQuery}
        filters={filters}
        setFilters={setFilters}
        facets={facets}
        filtered={filtered}
        browsing={browsing}
        hourly={hourly}
        liveHere={liveHere}
        crumbs={crumbs}
      />
    );
  }

  return (
    <>
      <header className={cn("border-b border-line/60", TREATMENT_HEADER[def.treatment] ?? "bg-surface")}>
        <div className={cn(pageSection, "pb-10 pt-6 sm:pb-12 sm:pt-8")}>
          <Breadcrumbs items={crumbs} />
          <div className="mt-8 flex flex-col gap-6 motion-safe:animate-catalog-in lg:flex-row lg:items-end lg:justify-between">
            <div className="flex max-w-2xl gap-5">
              <IconTile icon={def.icon} tone={def.tone} className="hidden size-16 shrink-0 rounded-2xl sm:grid" iconClassName="size-7" />
              <div>
                <p className={eyebrow}>
                  {liveHere > 0 ? `${liveHere} bookable · ${base.length} services` : `${base.length} services · coming soon`}
                </p>
                <h1 className="mt-2 font-display type-title font-bold tracking-tight text-content">{title}</h1>
                <p className="mt-3 text-lg leading-relaxed text-content/75">{audience ? AUDIENCES.find((a) => a.id === audience)!.hint : def.tagline}</p>
                <p className="mt-2 text-base leading-relaxed text-content/75">{def.description}</p>
              </div>
            </div>
            {liveHere === 0 && (
              <NotifyMeButton sourceKey={`category:${def.id}`} serviceName={def.name} variant="primary" className="self-start lg:self-auto" />
            )}
          </div>
          {def.notice && (
            <p className="mt-6 flex max-w-3xl gap-3 rounded-2xl border border-line bg-surface/80 p-4 text-sm text-content">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              {def.notice}
            </p>
          )}
          {isBeauty && (
            <div className="mt-8">
              <BeautyAudienceSelector
                active={audience}
                counts={Object.fromEntries(
                  AUDIENCES.map((a) => [a.id, category.services.filter((s) => s.audiences.includes(a.id)).length]),
                )}
              />
            </div>
          )}
        </div>
      </header>

      <ServiceCategoryNav active={def.id} />

      <div className={cn(pageSection, "space-y-14 pt-8 sm:pt-10")}>
        {hourly && browsing && <HourlyHelpModule service={hourly} tone="light" headingLevel="h2" showDetailsLink />}

        <section aria-label={`${title} services`}>
          <div className="mb-5 max-w-md">
            <ServiceSearch
              catalog={catalog}
              value={query}
              onChange={setQuery}
              size="md"
              placeholder={`Search ${isBeauty && audience ? audienceName(audience).toLowerCase() : def.shortName.toLowerCase()} services…`}
            />
          </div>

          {isBeauty && audience && (
            <div className="mb-5">
              <BeautyCategorySelector
                services={base}
                active={filters.beautyType}
                onSelect={(beautyType: BeautyType | undefined) => setFilters((f) => ({ ...f, beautyType }))}
              />
            </div>
          )}

          <ServiceFilters facets={facets} value={filters} onChange={setFilters} resultCount={filtered.length} />

          {filtered.length === 0 ? (
            <ServiceEmptyState
              body={
                base.length === 0
                  ? "There are no services in this category right now. Check back soon."
                  : "No services match these filters. Try removing a filter or searching for something else."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setFilters(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : browsing ? (
            <Browse category={category} services={filtered} audience={audience} />
          ) : (
            <ServiceGrid linkAudience={audience} services={filtered} label={`${title} results`} priorityCount={2} />
          )}
        </section>
      </div>
    </>
  );
}

/** Unfiltered view: popular → subgroups → coming soon, instead of one giant wall. */
function Browse({
  category,
  services,
  audience,
}: {
  category: CategoryView;
  services: ServiceView[];
  audience?: Audience;
}) {
  const { def } = category;
  const live = services.filter((s) => s.status === "live");
  const soon = services.filter((s) => s.status !== "live");
  const popular = live.filter((s) => s.popular);
  const showPopular = popular.length >= 2 && services.length >= 8;

  // Beauty landing (no audience): each service once, grouped by treatment type.
  if (def.id === "beauty" && !audience) {
    return (
      <div className="space-y-14">
        {live.length > 0 && (
          <div>
            <SectionHeading title="Bookable today" as="h2" />
            <ServiceGrid linkAudience={audience} services={live} label="Bookable beauty services" priorityCount={1} />
          </div>
        )}
        {BEAUTY_TYPES.map((t) => {
          const items = soon.filter((s) => s.beautyType === t.id);
          if (!items.length) return null;
          return (
            <div key={t.id}>
              <SectionHeading
                title={t.name}
                kicker={`${items.length} ${items.length === 1 ? "service" : "services"} · coming soon`}
                subtitle={BEAUTY_TYPE_COPY[t.id]}
              />
              <ServiceGrid linkAudience={audience} services={items} label={`${t.name} services`} />
            </div>
          );
        })}
      </div>
    );
  }

  const groups = def.subgroups && !audience
    ? def.subgroups
        .map((g) => ({ ...g, items: live.filter((s) => s.subgroup === g.id) }))
        .filter((g) => g.items.length > 0)
    : [];
  const ungrouped = groups.length ? live.filter((s) => !groups.some((g) => g.id === s.subgroup)) : live;

  return (
    <div className="space-y-14">
      {showPopular && (
        <div>
          <SectionHeading title={`Popular in ${def.shortName}`} />
          <ServiceGrid linkAudience={audience} services={popular.slice(0, 4)} label={`Popular in ${def.name}`} priorityCount={2} />
        </div>
      )}
      {groups.map((g, i) => (
        <div key={g.id}>
          <SectionHeading
            title={g.name}
            kicker={`${g.items.length} ${g.items.length === 1 ? "service" : "services"}`}
            subtitle={g.description}
          />
          <ServiceGrid linkAudience={audience} services={g.items} label={g.name} priorityCount={i === 0 && !showPopular ? 2 : 0} />
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div>
          {groups.length > 0 && <SectionHeading title="More services" />}
          {!groups.length && live.length > 0 && <SectionHeading title="All services" />}
          <ServiceGrid linkAudience={audience} services={ungrouped} label={`${def.name} services`} priorityCount={groups.length ? 0 : 2} />
        </div>
      )}
      {soon.length > 0 && (
        <div>
          <SectionHeading
            title={live.length ? "Coming soon" : `${def.shortName} services`}
            subtitle={
              live.length
                ? "Not bookable yet — open any service to get notified when it launches."
                : "These services are not bookable yet. Open one to see what's planned, or get notified when the category launches."
            }
            action={
              live.length > 0 ? (
                <NotifyMeButton sourceKey={`category:${def.id}`} serviceName={def.name} label="Notify me about launches" />
              ) : undefined
            }
          />
          <ServiceGrid linkAudience={audience} services={soon} label={`${def.name} coming soon`} />
        </div>
      )}
    </div>
  );
}
