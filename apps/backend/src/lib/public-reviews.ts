import type { Prisma } from "@prisma/client";
import { analyticsWhereVia } from "./analytics-scope";

/**
 * The one population every customer-facing review surface reads: the list, its count, the star
 * distribution and the average must all come from this, or they drift apart (a page showing
 * "4.8 · 120 reviews" above a list of 97).
 *
 *   - `isPublic: true`   — moderation has not hidden it (`/api/admin/reviews/:id` toggles this)
 *   - `isFlagged: false` — not awaiting or failing review
 *   - business population, inherited from the booking (`analytics-scope`), so a certification or
 *     fixture run's ratings never reach a customer as evidence about a real service or partner
 *
 * A partner's own dashboard and admin moderation deliberately do NOT use this: they must see every
 * review about them, including the ones the public cannot.
 */
export function publicReviewWhere(extra: Prisma.RatingWhereInput = {}): Prisma.RatingWhereInput {
  return { AND: [{ isPublic: true, isFlagged: false }, analyticsWhereVia("rating") as Prisma.RatingWhereInput, extra] };
}

/** Newest first, with the id as the tie-breaker so offset pages neither repeat nor skip a row. */
export const PUBLIC_REVIEW_ORDER: Prisma.RatingOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

/** How a reviewer is named in public: first name and initial, or anonymous when they asked to be. */
export function publicReviewerName(r: { isAnonymous: boolean; user: { firstName: string | null; lastName: string | null } }): string {
  return r.isAnonymous ? "HOMEEIGO Customer" : `${r.user.firstName ?? "HOMEEIGO"} ${(r.user.lastName ?? "").charAt(0)}`.trim();
}

/** Star counts 1–5 plus their total and average, from a `groupBy(["stars"])` over the public set. */
export function summariseStars(groups: Array<{ stars: number; _count: { _all: number } }>): {
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  ratingCount: number;
  averageRating: number | null;
} {
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let ratingCount = 0;
  let sum = 0;
  for (const g of groups) {
    const key = String(g.stars) as keyof typeof distribution;
    if (!(key in distribution)) continue;
    distribution[key] = g._count._all;
    ratingCount += g._count._all;
    sum += g.stars * g._count._all;
  }
  return { distribution, ratingCount, averageRating: ratingCount > 0 ? Math.round((sum / ratingCount) * 10) / 10 : null };
}
