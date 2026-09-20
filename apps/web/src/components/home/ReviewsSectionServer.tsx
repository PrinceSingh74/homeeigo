"use client";

import { Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { resolveApiBase } from "@/lib/api-base";

type ReviewCard = {
  id: string;
  name: string;
  location: string;
  rating: number;
  review: string;
};

const INITIAL_TINTS = ["#10b981", "#0d9488", "#0ea5e9", "#8b5cf6", "#f59e0b", "#65a30d"];

type RecentReviewsPayload = {
  reviews: Array<{
    id: string;
    name: string;
    rating: number;
    reviewText: string | null;
    service: string;
    createdAt: string;
  }>;
  averageRating: number | null;
  total: number;
};

async function fetchRecentReviews(): Promise<RecentReviewsPayload | null> {
  const res = await fetch(`${resolveApiBase().replace(/\/$/, "")}/api/ratings/recent?limit=6`);
  if (!res.ok) return null;
  const json = (await res.json()) as { success?: boolean; data?: RecentReviewsPayload };
  return json.success && json.data ? json.data : null;
}

/**
 * Customer Reviews — LIVE platform reviews only. Fetched on the client so the
 * home RSC never waits on the ratings API (that wait kept tab switches on the
 * previous page for ~2.5s).
 */
export function ReviewsSectionServer() {
  const query = useQuery({
    queryKey: ["recent-reviews"],
    queryFn: fetchRecentReviews,
    staleTime: 60_000,
    retry: 1,
  });

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-content px-4 py-10 sm:px-6" aria-hidden>
        <StaticSkeleton className="mb-6 h-8 w-56 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <StaticSkeleton key={i} shimmer className="h-40 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const live = query.data ?? null;
  const reviews: ReviewCard[] =
    live?.reviews.map((r) => ({
      id: r.id,
      name: r.name || "HOMEEIGO Customer",
      location: r.service ? `${r.service} · Verified booking` : "Verified booking",
      rating: r.rating,
      review: r.reviewText || "Great service experience with HOMEEIGO.",
    })) ?? [];

  const unavailable = live === null;

  return (
    <PageSection id="reviews">
      <SectionHeader
        title="Customer Reviews"
        subtitle={
          reviews.length > 0
            ? "Real reviews from verified HOMEEIGO bookings across Gurugram and NCR."
            : "Every review here comes from a verified, completed HOMEEIGO booking."
        }
      />

      {reviews.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review, i) => {
            const tint = INITIAL_TINTS[i % INITIAL_TINTS.length];
            const initial = (review.name?.trim()?.[0] ?? "H").toUpperCase();
            return (
              <article
                key={review.id}
                className="group relative rounded-2xl glass-card glass-reflect card-sheen card-3d p-5 hover:shadow-[0_28px_56px_-16px_rgb(16_185_129/0.24)] sm:p-6"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-5 top-4 font-display text-4xl font-bold leading-none text-brand/10 transition-colors duration-300 group-hover:text-brand/20"
                >
                  &ldquo;
                </span>
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white ring-2 ring-surface"
                    style={{ background: `linear-gradient(135deg, ${tint}, ${tint}cc)` }}
                    aria-hidden
                  >
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-content">{review.name}</p>
                    <p className="text-xs leading-snug text-muted">{review.location}</p>
                  </div>
                  <span
                    role="img"
                    aria-label={`${review.rating} stars`}
                    className="ml-auto inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-1 text-xs font-semibold text-gold"
                  >
                    <Star size={12} className="fill-gold" />
                    {review.rating}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-content">{review.review}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-2xl glass-card px-6 py-10 text-center sm:py-12"
        >
          <span className="grid size-12 place-items-center rounded-xl bg-gold/10 text-gold" aria-hidden>
            <Star size={22} />
          </span>
          <p className="font-display text-lg font-bold text-content">
            {unavailable ? "Reviews are temporarily unavailable" : "No public reviews yet"}
          </p>
          <p className="max-w-md text-sm text-muted">
            {unavailable
              ? "We couldn't reach the reviews service just now. Please check back shortly."
              : "Reviews appear here as soon as customers rate a completed booking."}
          </p>
        </div>
      )}
    </PageSection>
  );
}
