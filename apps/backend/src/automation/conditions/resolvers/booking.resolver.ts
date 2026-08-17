import prisma from "../../../lib/prisma";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

/**
 * Booking fields, for a booking workflow's own booking.
 *
 * The field list is the allowlist. This is not "Prisma access with extra steps" — the resolver can
 * only ever read the columns named here, for the one booking the instance is bound to, and the
 * select below is fixed rather than derived from the caller's input.
 *
 * The human-ownership helpers in `ai-tools/execution/actor-resolver` are deliberately not used.
 * They answer "is this user the owner", which is the wrong question for the AUTOMATION principal:
 * automation has no owner, and its authority comes from the instance's bound subject instead.
 */

const FIELDS = ["status", "finalAmount", "providerId", "userId", "completedAt", "startedAt", "enRouteAt", "arrivedAt", "createdAt"] as const;

export const bookingResolver: ConditionResolver = {
  domain: "booking",
  acceptsSubjectTypes: ["booking"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const booking = await prisma.booking.findUnique({
      where: { id: subject.subjectId },
      select: {
        status: true,
        finalAmount: true,
        providerId: true,
        userId: true,
        completedAt: true,
        startedAt: true,
        enRouteAt: true,
        arrivedAt: true,
        createdAt: true,
      },
    });
    if (!booking) return null;

    return { value: booking[field as (typeof FIELDS)[number]], source: "booking" };
  },
};
