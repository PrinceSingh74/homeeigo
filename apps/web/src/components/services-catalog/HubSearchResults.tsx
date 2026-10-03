"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  CATEGORY_BY_ID,
  applyFilters,
  categoryHref,
  computeFacets,
  searchServices,
  sortServices,
  type Catalog,
  type CategoryId,
  type FilterState,
} from "@/lib/catalog";
import { ServiceGrid } from "@/components/services-catalog/ServiceGrid";
import { ServiceFilters } from "@/components/services-catalog/ServiceFilters";
import { ServiceEmptyState } from "@/components/services-catalog/ServiceStates";
import { SectionHeading, focusRing } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/** In-page search results for the hub (loaded only once someone searches). */
export default function SearchResults({
  catalog,
  query,
  filters,
  onFilters,
  onClear,
}: {
  catalog: Catalog;
  query: string;
  filters: FilterState;
  onFilters: (f: FilterState) => void;
  onClear: () => void;
}) {
  const matches = useMemo(() => searchServices(catalog, query).map((r) => r.service), [catalog, query]);
  const facets = useMemo(() => computeFacets(matches), [matches]);
  const shown = useMemo(() => {
    const filtered = applyFilters(matches, filters);
    // "Recommended" keeps relevance order for a search.
    return filters.sort === "recommended" ? filtered : sortServices(filtered, filters.sort);
  }, [matches, filters]);

  return (
    <section id="search-results" aria-labelledby="results-heading" className="scroll-mt-32">
      <SectionHeading
        id="results-heading"
        kicker="Search"
        title={<>Results for “{query}”</>}
        action={
          <button type="button" onClick={onClear} className={cn("rounded-md text-sm font-semibold text-brand hover:underline", focusRing)}>
            Clear search
          </button>
        }
      />
      {matches.length > 0 && (
        <ServiceFilters facets={facets} value={filters} onChange={onFilters} resultCount={shown.length} />
      )}
      {shown.length ? (
        <ServiceGrid services={shown} label={`Search results for ${query}`} />
      ) : (
        <ServiceEmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {(["home-cleaning", "home-maintenance", "beauty"] as CategoryId[]).map((id) => (
                <Link key={id} href={categoryHref(id)} className={cn("rounded-full border border-line px-3.5 py-2 text-sm hover:border-emerald-300", focusRing)}>
                  {CATEGORY_BY_ID.get(id)!.name}
                </Link>
              ))}
            </div>
          }
        />
      )}
    </section>
  );
}
