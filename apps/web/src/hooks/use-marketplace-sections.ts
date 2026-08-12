"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import type { BackendService } from "@/types/backend";
import {
  EXPRESS_SERVICES,
  HOME_CARE_SERVICES,
  LAUNDRY_SERVICES,
  OUTDOOR_SERVICES,
  PREMIUM_CARE_SERVICES,
  type MarketplaceService,
} from "@/lib/services-marketplace-data";

/**
 * Full catalog for the marketplace sections. Separate query key from the
 * shared `useServicesQuery` (which uses the default page size of 20) because
 * the marketplace needs every active service to group them into sections.
 */
export function useMarketplaceCatalogQuery() {
  return useQuery({
    queryKey: ["services", "marketplace-catalog"],
    queryFn: () => coreApi.services.list("?limit=100"),
    staleTime: 60_000,
  });
}

/** Static fallback images keyed by backend slug (used when a service has no thumbnail). */
const FALLBACK_BY_SLUG: Record<string, MarketplaceService> = Object.fromEntries(
  [
    ...HOME_CARE_SERVICES,
    ...PREMIUM_CARE_SERVICES,
    ...LAUNDRY_SERVICES,
    ...OUTDOOR_SERVICES,
    ...EXPRESS_SERVICES,
  ].map((s) => [s.slug ?? s.id, s]),
);

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=90&auto=format&fit=crop";

function formatDuration(s: BackendService): string {
  if (s.durationRange) return s.durationRange;
  const mins = s.estimatedDuration ?? 60;
  if (mins >= 60 * 24) return `${Math.round(mins / 60)} hrs`;
  if (mins >= 120) return `${(mins / 60).toFixed(1).replace(/\.0$/, "")} hrs`;
  return `${mins} mins`;
}

function toMarketplaceService(s: BackendService): MarketplaceService {
  const fallback = s.slug ? FALLBACK_BY_SLUG[s.slug] : undefined;
  const price = s.basePrice ?? s.minPrice ?? fallback?.priceValue ?? 0;
  return {
    id: s.slug ?? s.id,
    slug: s.slug,
    name: s.name,
    image: s.thumbnail ?? s.icon ?? fallback?.image ?? DEFAULT_IMAGE,
    duration: formatDuration(s),
    rating: s.rating && s.rating > 0 ? Number(s.rating.toFixed(1)) : fallback?.rating ?? 4.8,
    price: price > 0 ? `₹${price} onwards` : "Price on request",
    priceValue: price,
    badge: s.isPopular ? "Popular" : s.isFeatured ? "Most Booked" : fallback?.badge,
    // Real catalog cuid — the /book page matches on service.id from the API.
    serviceId: s.id,
    freshness: fallback?.freshness,
  };
}

type MarketplaceSections = {
  homeCare: MarketplaceService[];
  premiumCare: MarketplaceService[];
  laundry: MarketplaceService[];
  outdoor: MarketplaceService[];
  express: MarketplaceService[];
  isLoading: boolean;
  isLive: boolean;
};

/**
 * Groups the live backend catalog into the marketplace page sections using the
 * `subcategory` field managed via the admin panel (and seed-services.ts).
 * Falls back to the static showcase data while loading or if the API is down,
 * so the page never renders empty.
 */
export function useMarketplaceSections(): MarketplaceSections {
  const { data, isLoading, isError } = useMarketplaceCatalogQuery();

  // Hydration guard: React Query cache can rehydrate synchronously on the first
  // client render, diverging from the server HTML. Render the static fallback
  // until mounted so server and first client paint are identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return useMemo(() => {
    const services = mounted ? (data?.services ?? []) : [];
    const bySubcategory = (sub: string) =>
      services.filter((s) => s.subcategory === sub).map(toMarketplaceService);

    const homeCare = bySubcategory("home-care");
    const premiumCare = bySubcategory("premium-care");
    const laundry = bySubcategory("laundry");
    const outdoor = bySubcategory("outdoor");
    const express = bySubcategory("express");

    const hasLiveData =
      !isError &&
      (homeCare.length > 0 ||
        premiumCare.length > 0 ||
        laundry.length > 0 ||
        outdoor.length > 0 ||
        express.length > 0);

    return {
      homeCare: homeCare.length ? homeCare : HOME_CARE_SERVICES,
      premiumCare: premiumCare.length ? premiumCare : PREMIUM_CARE_SERVICES,
      laundry: laundry.length ? laundry : LAUNDRY_SERVICES,
      outdoor: outdoor.length ? outdoor : OUTDOOR_SERVICES,
      express: express.length ? express : EXPRESS_SERVICES,
      isLoading,
      isLive: hasLiveData,
    };
  }, [data?.services, isError, isLoading, mounted]);
}
