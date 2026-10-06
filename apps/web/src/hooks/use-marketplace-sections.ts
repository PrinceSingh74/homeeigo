"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { catalogQueryOptions } from "@/hooks/use-core-data";
import { groupMarketplaceSections, type MarketplaceSectionLists } from "@/lib/marketplace-sections";

/**
 * Full catalog for the marketplace sections — the SHARED catalog query (one key, one fetch;
 * see catalogQueryOptions). The old private key duplicated the same 100-service request on
 * every home/services visit; the shared walk also sees past page 1, which this one never did.
 */
export function useMarketplaceCatalogQuery() {
  return useQuery(catalogQueryOptions);
}

type MarketplaceSections = MarketplaceSectionLists & {
  isLoading: boolean;
  /** The catalogue answered and at least one section has services. */
  isLive: boolean;
};

/**
 * Groups the live backend catalog into the marketplace page sections using the
 * `subcategory` field managed via the admin panel (and seed-services.ts).
 * While loading, or if the API is down or empty, every section is empty and `isLive` is false:
 * callers show a loading or unavailable state, never a stand-in list.
 */
export function useMarketplaceSections(): MarketplaceSections {
  const { data, isLoading, isError } = useMarketplaceCatalogQuery();

  // Hydration guard: React Query cache can rehydrate synchronously on the first
  // client render, diverging from the server HTML. Render empty sections until
  // mounted so server and first client paint are identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return useMemo(() => {
    const sections = groupMarketplaceSections(mounted && !isError ? (data?.services ?? []) : []);
    const isLive = Object.values(sections).some((list) => list.length > 0);
    return { ...sections, isLoading, isLive };
  }, [data?.services, isError, isLoading, mounted]);
}
