import { cache } from "react";
import type { BackendService, BackendServiceDetail } from "@/types/backend";
import type { StatsOverview } from "@/services/core/api";
import { resolveApiBase } from "@/lib/api-base";

const REVALIDATE_SEC = 60;

/**
 * Cap on SSR data waits. Pages stream a shell immediately; a hung backend
 * must not hold the RSC flight (that is what made tab-to-tab navigation feel stuck).
 *
 * Do NOT pass AbortSignal into fetch — Next cannot cache aborted requests, so every
 * navigation re-hit the API and waited up to the timeout.
 */
const SSR_FETCH_TIMEOUT_MS = 800;

type ApiEnvelope<T> = { success: boolean; data?: T };

async function serverFetch<T>(path: string): Promise<T | null> {
  const apiBase = resolveApiBase().replace(/\/$/, "");
  const request = fetch(`${apiBase}${path}`, {
    next: { revalidate: REVALIDATE_SEC },
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const json = (await res.json()) as ApiEnvelope<T>;
      return json.success && json.data != null ? json.data : null;
    })
    .catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SSR_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const fetchStatsOverview = cache(async (): Promise<StatsOverview | null> => {
  return serverFetch<StatsOverview>("/api/stats/overview");
});

export type RecentReview = {
  id: string;
  name: string;
  rating: number;
  reviewText: string | null;
  service: string;
  createdAt: string;
};

/** Platform-wide recent public reviews — same feed as the mobile home rail. */
export const fetchRecentReviews = cache(async (): Promise<{
  reviews: RecentReview[];
  averageRating: number | null;
  total: number;
} | null> => {
  return serverFetch<{ reviews: RecentReview[]; averageRating: number | null; total: number }>(
    "/api/ratings/recent?limit=6",
  );
});

export const fetchServicesCatalog = cache(async (): Promise<{
  services: BackendService[];
  total: number;
} | null> => {
  // Full catalog (backend caps at 100) — the default page of 20 could clip the
  // curated popular grid if rankings ever shift.
  return serverFetch<{ services: BackendService[]; total: number }>("/api/services?limit=100");
});

export const fetchFeaturedServices = cache(async (): Promise<{
  services: BackendService[];
  total: number;
} | null> => {
  return serverFetch<{ services: BackendService[]; total: number }>("/api/services/featured");
});

/** One service's admin-configured detail content and real rating aggregate. */
export const fetchServiceDetail = cache(async (id: string): Promise<BackendServiceDetail | null> => {
  const data = await serverFetch<{ service: BackendServiceDetail }>(
    `/api/services/${encodeURIComponent(id)}`,
  );
  return data?.service ?? null;
});
