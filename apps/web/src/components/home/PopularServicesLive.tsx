"use client";

import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import {
  PopularServicesGrid,
  type PopularServiceItem,
} from "@/components/home/PopularServicesGrid";
import type { BackendService } from "@/types/backend";

function toPopularItems(services: BackendService[]): PopularServiceItem[] {
  const popular = services.filter((s) => s.isPopular);
  // API returns popularity-ranked services, so if none are explicitly flagged
  // isPopular, the top of the list is still the right thing to show.
  const source = popular.length > 0 ? popular : services.slice(0, 10);
  return source.map((s) => ({
    id: s.id,
    name: s.name ?? "Service",
    price: `₹${s.basePrice ?? s.minPrice ?? 0}`,
    featured: s.isFeatured ?? false,
    thumbnail: s.thumbnail ?? null,
  }));
}

/**
 * Client-side recovery path for the home "Popular Services" wall. Rendered
 * ONLY when the SSR catalog fetch failed (backend down/slow at render time).
 * Fetches the real catalog from the browser via the same-origin proxy and
 * keeps retrying until the backend is reachable — so the section always ends
 * up showing live data instead of static demo cards.
 */
export function PopularServicesLive() {
  const query = useQuery({
    queryKey: ["home-popular-services"],
    queryFn: () => coreApi.services.list("?limit=100"),
    staleTime: 60_000,
    retry: 2,
    // Poll until the backend comes back; stop once we have data. Keep polling
    // even when the tab is backgrounded so the section is healed by the time
    // the user returns to it.
    refetchInterval: (q) => (q.state.data ? false : 5_000),
    refetchIntervalInBackground: true,
  });

  const services = query.data?.services ?? [];
  if (services.length > 0) {
    return <PopularServicesGrid services={toPopularItems(services)} />;
  }

  // Loading / backend still unreachable — neutral skeletons, never demo data.
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
      role="list"
      aria-label="Popular services loading"
      aria-busy="true"
    >
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          role="listitem"
          className="aspect-[4/3] w-full min-w-0 animate-pulse rounded-3xl bg-surface/60"
        />
      ))}
    </div>
  );
}
