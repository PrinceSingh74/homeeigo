import { useEffect, useMemo, useState } from "react";
import { useServicesQuery, useFeaturedServicesQuery } from "@/hooks/use-core-data";
import { mapBackendServices } from "@/lib/service-mapper";
import type { Service } from "@/lib/services";
import {
  loadCatalogCache,
  loadFeaturedCache,
  saveCatalogCache,
  saveFeaturedCache,
} from "@/lib/offline/catalog-cache";

export function useCatalogServices() {
  const query = useServicesQuery();
  const [cached, setCached] = useState<Service[] | null>(null);

  useEffect(() => {
    loadCatalogCache().then((items) => setCached(items.length ? items : null));
  }, []);

  useEffect(() => {
    if (!query.data?.services?.length) return;
    const mapped = mapBackendServices(query.data.services);
    void saveCatalogCache(mapped).then(() => setCached(mapped));
  }, [query.data?.services]);

  const services = useMemo(() => {
    if (query.data?.services?.length) return mapBackendServices(query.data.services);
    if (cached?.length) return cached;
    return [];
  }, [query.data?.services, cached]);

  return {
    services,
    isLoading: query.isLoading && !cached?.length,
    isFromApi: Boolean(query.data?.services?.length),
    isFromCache: !query.data?.services?.length && Boolean(cached?.length),
    error: query.error,
  };
}

export function useFeaturedCatalog(enabled = true) {
  const query = useFeaturedServicesQuery({ enabled });
  const [cachedFeatured, setCachedFeatured] = useState<Service[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    loadFeaturedCache().then((items) => setCachedFeatured(items.length ? items : null));
  }, [enabled]);

  useEffect(() => {
    if (!query.data?.services?.length) return;
    const mapped = mapBackendServices(query.data.services);
    void saveFeaturedCache(mapped).then(() => setCachedFeatured(mapped));
  }, [query.data?.services]);

  const featured = useMemo((): Service[] => {
    if (query.data?.services?.length) return mapBackendServices(query.data.services);
    if (cachedFeatured?.length) return cachedFeatured;
    return [];
  }, [query.data?.services, cachedFeatured]);

  const recommended = useMemo(() => {
    return featured.slice(0, 4).map((svc) => ({
      title: svc.title,
      serviceId: svc.id,
      packageIndex: 1,
      price: svc.price,
      rating: svc.rating,
      imageKey: svc.imageKey,
    }));
  }, [featured]);

  return {
    featured,
    recommended,
    isLoading: query.isLoading && !cachedFeatured?.length,
    isFromApi: Boolean(query.data?.services?.length),
    isFromCache: !query.data?.services?.length && Boolean(cachedFeatured?.length),
  };
}

export function getServiceIndexFromCatalog(services: Service[], idOrSlug: string): number {
  const idx = services.findIndex(
    (s) => s.id === idOrSlug || s.id.includes(idOrSlug) || s.name.toLowerCase().includes(idOrSlug.toLowerCase()),
  );
  return idx >= 0 ? idx : 0;
}
