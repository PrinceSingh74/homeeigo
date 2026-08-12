import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";

export type CustomerReviewItem = {
  id: string;
  name: string;
  location: string;
  rating: number;
  review: string;
  initial: string;
  serviceId?: string;
};

/**
 * Platform-wide recent reviews for the home "Loved by customers" rail.
 * ANY customer's review (any service, any provider) surfaces here the moment
 * it's created — backed by GET /api/ratings/recent (public, non-flagged rows).
 * Admin moderation (hide/flag) removes a review from this feed in real time.
 * Returns an array (existing consumers depend on that shape).
 */
export function useCustomerReviews(limit = 6, enabled = true) {
  return useQuery({
    queryKey: ["customer-reviews", "recent", limit],
    queryFn: async (): Promise<CustomerReviewItem[]> => {
      const data = await coreApi.ratings.recent(limit);
      return (data.reviews ?? []).map((r) => ({
        id: r.id,
        name: r.name || "Homeeigo Customer",
        location: r.service ? `${r.service} · Verified` : "Verified booking",
        rating: r.rating ?? 5,
        review: r.reviewText ?? "Great service experience with Homeeigo.",
        initial: (r.name?.trim()?.[0] ?? "H").toUpperCase(),
      }));
    },
    enabled,
    staleTime: 60_000,
  });
}
