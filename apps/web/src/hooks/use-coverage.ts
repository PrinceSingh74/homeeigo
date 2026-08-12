"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import type { CoverageRequestPayload } from "@/lib/coverage/coverage-types";

export const coverageQk = {
  cities: ["coverage", "cities"] as const,
  city: (slug: string) => ["coverage", "city", slug] as const,
  search: (q: string) => ["coverage", "search", q] as const,
};

export function useCoverageCities(enabled = true) {
  return useQuery({
    queryKey: coverageQk.cities,
    queryFn: () => coreApi.coverage.cities(),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useCityCoverage(slug: string | null) {
  return useQuery({
    queryKey: coverageQk.city(slug ?? ""),
    queryFn: () => coreApi.coverage.cityDetail(slug!),
    staleTime: 2 * 60_000,
    enabled: Boolean(slug),
  });
}

/** Debounced hyperlocal search — society / area / pincode. */
export function useCoverageSearch(rawQuery: string) {
  const [query, setQuery] = useState(rawQuery);

  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const result = useQuery({
    queryKey: coverageQk.search(query),
    queryFn: () => coreApi.coverage.search(query),
    staleTime: 60_000,
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  });

  return { ...result, debouncedQuery: query };
}

export function useRequestCoverage() {
  return useMutation({
    mutationFn: (payload: CoverageRequestPayload) => coreApi.coverage.request(payload),
  });
}
