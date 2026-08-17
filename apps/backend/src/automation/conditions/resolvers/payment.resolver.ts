import prisma from "../../../lib/prisma";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

/**
 * Payment fields, for a payment workflow's own payment.
 *
 * This is the resolver payment recovery will re-check against in 6G: "is it still failed?" asked
 * at the moment of acting, not at the moment the workflow started. Between those two points a
 * customer may well have paid by another route, and a recovery nudge sent after that is worse
 * than no nudge at all.
 */

const FIELDS = ["status", "amount", "amountPaid", "refundedAmount", "bookingId", "userId", "createdAt"] as const;

export const paymentResolver: ConditionResolver = {
  domain: "payment",
  acceptsSubjectTypes: ["payment"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const payment = await prisma.payment.findUnique({
      where: { id: subject.subjectId },
      select: {
        status: true,
        amount: true,
        amountPaid: true,
        refundedAmount: true,
        bookingId: true,
        userId: true,
        createdAt: true,
      },
    });
    if (!payment) return null;

    return { value: payment[field as (typeof FIELDS)[number]], source: "payment" };
  },
};
