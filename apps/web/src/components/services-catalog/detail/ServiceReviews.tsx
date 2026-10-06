"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { coreApi } from "@/services/core/api";
import { DetailSection } from "./sections";

const PAGE = 5;
const STARS = ["5", "4", "3", "2", "1"] as const;

/**
 * Reviews of this service from the ratings customers left on completed bookings. Rendered only
 * when at least one real rating exists: a service nobody has rated shows no section, never a
 * placeholder. The reviewer is whatever the server sends (a first name and an initial).
 */
export function ServiceReviews({ serviceId }: { serviceId: string }) {
  const [limit, setLimit] = useState(PAGE);
  const query = useQuery({
    queryKey: ["services", "reviews", serviceId, limit],
    queryFn: () => coreApi.services.reviews(serviceId, 1, limit),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  if (!data || data.ratingCount === 0 || data.averageRating == null) return null;

  return (
    <DetailSection id="reviews" title="Customer reviews">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-10">
        <div>
          <p className="font-display text-5xl font-bold tracking-tight text-content">{data.averageRating.toFixed(1)}</p>
          <p className="mt-1 text-sm text-muted">
            out of 5 · {data.ratingCount} {data.ratingCount === 1 ? "rating" : "ratings"}
          </p>
        </div>
        <dl className="grid gap-1.5" aria-label="Ratings by number of stars">
          {STARS.map((s) => {
            const count = data.distribution[s] ?? 0;
            const share = data.ratingCount > 0 ? Math.round((count / data.ratingCount) * 100) : 0;
            return (
              <div key={s} className="flex items-center gap-3 text-sm">
                <dt className="w-12 shrink-0 text-muted">
                  {s} star{s === "1" ? "" : "s"}
                </dt>
                <dd className="flex min-w-0 flex-1 items-center gap-3">
                  <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-content">{count}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>

      {data.reviews.length > 0 ? (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {data.reviews.map((r) => (
            <li key={r.id} className="py-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-content">{r.name}</p>
                <p className="text-sm text-muted">
                  <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</time>
                </p>
              </div>
              <p className="mt-1 flex items-center gap-0.5" role="img" aria-label={`${r.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} aria-hidden className={i <= r.rating ? "size-4 fill-amber-500 text-amber-500" : "size-4 text-line"} />
                ))}
              </p>
              {r.reviewText ? <p className="mt-2 max-w-2xl text-base leading-relaxed text-content">{r.reviewText}</p> : null}
              {r.providerResponse ? (
                <p className="mt-3 max-w-2xl border-l-2 border-line pl-3 text-sm leading-relaxed text-muted">
                  <span className="font-semibold text-content">Response from the professional: </span>
                  {r.providerResponse}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {data.total > data.reviews.length ? (
        <button
          type="button"
          onClick={() => setLimit((n) => Math.min(n + PAGE, 30))}
          disabled={query.isFetching}
          className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold text-content outline-none hover:border-emerald-700 focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-60"
        >
          {query.isFetching ? "Loading…" : `Show more reviews (${data.total - data.reviews.length} more)`}
        </button>
      ) : null}
    </DetailSection>
  );
}
