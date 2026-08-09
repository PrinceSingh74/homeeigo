"use client";

import { useMemo, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { usePartnerMeQuery, usePartnerReviewsQuery } from "@/hooks/use-partner-data";
import { cn } from "@/lib/cn";
import type { PartnerReview } from "@/types/partner";

type SortBy = "newest" | "highest" | "lowest";

export function ReviewsOverview() {
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const me = usePartnerMeQuery();
  const { data, isLoading, isError, refetch, isFetching } = usePartnerReviewsQuery({
    page: 1,
    limit: 50,
  });

  const breakdown = data?.ratingBreakdown ?? { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
  const totalRatings = data?.total ?? me.data?.totalReviews ?? 0;
  const averageRating = me.data?.rating ?? 0;

  const sorted = useMemo(() => {
    const list = [...(data?.reviews ?? [])];
    if (sortBy === "newest") {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "highest") {
      list.sort((a, b) => b.rating - a.rating);
    } else {
      list.sort((a, b) => a.rating - b.rating);
    }
    return list;
  }, [data?.reviews, sortBy]);

  if (isLoading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-partner-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reviews…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-partner-danger/30 bg-partner-danger/10 p-4 text-sm text-partner-danger">
        Couldn&apos;t load reviews.
        <button type="button" onClick={() => void refetch()} className="ml-2 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PartnerCard>
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-partner-muted">
              Overall rating
            </p>
            <div className="mt-2 flex items-end gap-4">
              <p className="font-display text-5xl font-bold">
                {averageRating > 0 ? averageRating.toFixed(1) : "—"}
              </p>
              <div className="mb-1">
                <StarRow score={averageRating} size="lg" />
                <p className="mt-2 text-xs text-partner-muted">
                  Based on {totalRatings} review{totalRatings === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-partner-muted">
              Rating breakdown
            </p>
            {([5, 4, 3, 2, 1] as const).map((stars) => {
              const count = breakdown[String(stars)] ?? 0;
              const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0;
              return (
                <div key={stars} className="mb-2 flex items-center gap-3">
                  <span className="w-8 text-xs font-medium">{stars}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-partner-bg/80">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs text-partner-muted">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </PartnerCard>

      <PartnerCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Recent reviews</h2>
          <div className="flex items-center gap-2">
            {isFetching && !isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" />
            ) : null}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg border border-partner-line bg-partner-bg/60 px-3 py-1.5 text-xs font-medium outline-none focus:border-partner-primary"
            >
              <option value="newest">Newest first</option>
              <option value="highest">Highest first</option>
              <option value="lowest">Lowest first</option>
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-partner-muted">
            No reviews yet. Complete jobs to start receiving customer feedback.
          </p>
        ) : (
          <div className="space-y-3">
            {sorted.map((r: PartnerReview) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        )}
      </PartnerCard>
    </div>
  );
}

function StarRow({ score, size = "sm" }: { score: number; size?: "sm" | "lg" }) {
  const rounded = Math.round(score);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5",
            star <= rounded ? "fill-amber-400 text-amber-400" : "text-partner-line",
          )}
        />
      ))}
    </div>
  );
}
