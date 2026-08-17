import prisma from "../../../lib/prisma";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

/**
 * Whether a booking has been rated, and what the rating is.
 *
 * Keyed off the booking subject rather than a rating id, because the question a workflow asks is
 * always "has this booking been reviewed yet" — the review-request workflow's entire stop
 * condition. `exists` is the operator this is built for.
 */

const FIELDS = ["exists", "stars", "createdAt"] as const;

export const ratingResolver: ConditionResolver = {
  domain: "rating",
  acceptsSubjectTypes: ["booking"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const rating = await prisma.rating.findUnique({
      where: { bookingId: subject.subjectId },
      select: { stars: true, createdAt: true },
    });

    // `exists` must answer even when there is no row — that is the whole point of asking.
    if (field === "exists") return { value: rating !== null, source: "rating" };
    if (!rating) return { value: null, source: "rating" };

    return { value: rating[field as "stars" | "createdAt"], source: "rating" };
  },
};
