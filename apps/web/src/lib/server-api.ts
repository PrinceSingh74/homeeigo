import type { BackendService } from "@/types/backend";
import type { StatsOverview } from "@/services/core/api";
import { resolveApiBase } from "@/lib/api-base";

const REVALIDATE_SEC = 60;

/**
 * Hard cap on SSR data fetches. Every consumer has a static fallback, so a
 * slow/hung backend must never block first paint — worst case the page
 * renders with fallbacks and ISR refreshes it in the background.
 */
const SSR_FETCH_TIMEOUT_MS = 2500;

type ApiEnvelope<T> = { success: boolean; data?: T };

async function serverFetch<T>(path: string): Promise<T | null> {
  const apiBase = resolveApiBase().replace(/\/$/, "");
  try {
    const res = await fetch(`${apiBase}${path}`, {
      next: { revalidate: REVALIDATE_SEC },
      signal: AbortSignal.timeout(SSR_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ApiEnvelope<T>;
    return json.success && json.data != null ? json.data : null;
  } catch {
    return null;
  }
}

export async function fetchStatsOverview(): Promise<StatsOverview | null> {
  return serverFetch<StatsOverview>("/api/stats/overview");
}

export type RecentReview = {
  id: string;
  name: string;
  rating: number;
  reviewText: string | null;
  service: string;
  createdAt: string;
};

/** Platform-wide recent public reviews — same feed as the mobile home rail. */
export async function fetchRecentReviews(): Promise<{
  reviews: RecentReview[];
  averageRating: number | null;
  total: number;
} | null> {
  return serverFetch<{ reviews: RecentReview[]; averageRating: number | null; total: number }>(
    "/api/ratings/recent?limit=6",
  );
}

export async function fetchServicesCatalog(): Promise<{
  services: BackendService[];
  total: number;
} | null> {
  // Full catalog (backend caps at 100) — the default page of 20 could clip the
  // curated popular grid if rankings ever shift.
  return serverFetch<{ services: BackendService[]; total: number }>("/api/services?limit=100");
}

export async function fetchFeaturedServices(): Promise<{
  services: BackendService[];
  total: number;
} | null> {
  return serverFetch<{ services: BackendService[]; total: number }>(
    "/api/services/featured",
  );
}
