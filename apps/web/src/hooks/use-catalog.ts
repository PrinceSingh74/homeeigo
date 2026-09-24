"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveApiBase } from "@/lib/api-base";
import { buildCatalog, type Catalog } from "@/lib/catalog";
import type { BackendService } from "@/types/backend";

type ServicesPage = { services: BackendService[]; total: number; page: number; limit: number };

/**
 * Same query key and data shape as useServicesQuery (use-core-data `qk.services`),
 * so /book reuses this cache. Fetched directly because the list is public: going
 * through coreApi would pull the authenticated client and stores into the hub bundle.
 */
const SERVICES_KEY = ["services"] as const;

async function fetchServices(): Promise<ServicesPage> {
  const base = resolveApiBase().replace(/\/$/, "");
  const load = async (page: number): Promise<ServicesPage> => {
    const res = await fetch(`${base}/api/services?limit=100&page=${page}`);
    if (!res.ok) throw new Error(`Services request failed (${res.status})`);
    const json = (await res.json()) as { success?: boolean; data?: ServicesPage };
    if (!json.success || !json.data) throw new Error("Services response was not successful");
    return json.data;
  };
  const first = await load(1);
  const limit = first.limit > 0 ? first.limit : 100;
  const pages = Math.min(20, Math.max(1, Math.ceil((first.total || first.services.length) / limit)));
  if (pages === 1) return first;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => load(i + 2)));
  const seen = new Set<string>();
  const services = [first, ...rest].flatMap((p) => p.services).filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  return { ...first, services, page: 1, limit: services.length };
}

export type CatalogState =
  | { status: "ready"; catalog: Catalog; refreshing: boolean }
  | { status: "loading" }
  | { status: "error"; retry: () => void };

/**
 * Catalogue for client components. Server-rendered data (ISR) renders the page
 * immediately; the client query keeps it fresh. Without any live data we show
 * loading/error — never an all-"coming soon" catalogue that would be untrue.
 */
export function useCatalog(initialServices: BackendService[] | null): CatalogState {
  const query = useQuery({ queryKey: SERVICES_KEY, queryFn: fetchServices, staleTime: 10 * 60_000 });
  const services = query.data?.services ?? initialServices;
  const catalog = useMemo(() => (services ? buildCatalog(services) : null), [services]);

  if (catalog) return { status: "ready", catalog, refreshing: query.isFetching };
  if (query.isError) return { status: "error", retry: () => void query.refetch() };
  return { status: "loading" };
}
