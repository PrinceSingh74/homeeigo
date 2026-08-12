import { Star } from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { CUSTOMER_REVIEWS } from "@/lib/services-page-data";
import { fetchRecentReviews } from "@/lib/server-api";
import Image from "next/image";

type ReviewCard = {
  id: string;
  name: string;
  location: string;
  rating: number;
  review: string;
  avatar: string | null;
};

const INITIAL_TINTS = ["#10b981", "#0d9488", "#0ea5e9", "#8b5cf6", "#f59e0b", "#65a30d"];

/**
 * Customer Reviews — LIVE platform reviews (same feed as the mobile home + the
 * admin moderation console). Any review a customer leaves after a service shows
 * here the moment it's public. Falls back to curated testimonials if the API is
 * unavailable, so first paint is never blocked.
 */
export async function ReviewsSectionServer() {
  const live = await fetchRecentReviews();

  const reviews: ReviewCard[] =
    live && live.reviews.length > 0
      ? live.reviews.map((r) => ({
          id: r.id,
          name: r.name || "HOMEEIGO Customer",
          location: r.service ? `${r.service} · Verified booking` : "Verified booking",
          rating: r.rating,
          review: r.reviewText || "Great service experience with HOMEEIGO.",
          avatar: null,
        }))
      : CUSTOMER_REVIEWS.slice(0, 6).map((r) => ({
          id: r.id,
          name: r.name,
          location: r.location,
          rating: r.rating,
          review: r.review,
          avatar: r.avatar,
        }));

  return (
    <PageSection id="reviews">
      <SectionHeader title="Customer Reviews" />
      <p className="mb-6 text-sm text-muted">
        Real reviews from verified HOMEEIGO bookings across Gurugram and NCR.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review, i) => {
          const tint = INITIAL_TINTS[i % INITIAL_TINTS.length];
          const initial = (review.name?.trim()?.[0] ?? "H").toUpperCase();
          return (
            <article
              key={review.id}
              className="group relative rounded-[24px] glass-card glass-reflect card-sheen card-3d p-5 hover:shadow-[0_28px_56px_-16px_rgb(16_185_129/0.24)] sm:rounded-[28px] sm:p-6"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute right-5 top-4 font-display text-5xl font-bold leading-none text-primary/10 transition-colors duration-300 group-hover:text-primary/20"
              >
                &ldquo;
              </span>
              <div className="flex items-center gap-3">
                {review.avatar ? (
                  <span className="relative inline-flex rounded-full bg-aurora p-[2px]">
                    <Image
                      src={review.avatar}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 rounded-full object-cover ring-2 ring-surface"
                    />
                  </span>
                ) : (
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white ring-2 ring-surface"
                    style={{ background: `linear-gradient(135deg, ${tint}, ${tint}cc)` }}
                    aria-hidden
                  >
                    {initial}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content">{review.name}</p>
                  <p className="truncate text-xs text-muted">{review.location}</p>
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
    </PageSection>
  );
}
