import prisma from "../../../lib/prisma";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

/**
 * The payment belonging to a booking, and only that one.
 *
 * The existing `payment` resolver is payment-scoped: its subject *is* the payment. Payment recovery
 * is booking-scoped — the customer bought a service, not a transaction — so a booking workflow needs
 * to ask about its own payment without ever naming one.
 *
 * That is what makes this safe rather than a hole in subject scoping. The lookup is
 * `findUnique({ where: { bookingId } })` against a `@unique` column: there is exactly one payment
 * per booking, the condition supplies no payment id, and no argument exists that could point it at
 * a different booking's money. A generic "read any payment from any subject" resolver would have
 * been the same feature with none of that.
 */

const FIELDS = ["exists", "status", "amountPaid", "refundedAmount", "createdAt"] as const;

export const bookingPaymentResolver: ConditionResolver = {
  domain: "bookingPayment",
  acceptsSubjectTypes: ["booking"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const payment = await prisma.payment.findUnique({
      where: { bookingId: subject.subjectId },
      select: { status: true, amountPaid: true, refundedAmount: true, createdAt: true },
    });

    // A booking with no payment row at all: `exists` answers false, everything else is unknowable.
    // Returning null rather than a zero keeps Phase 6B's fail-closed reading intact — absence is not
    // the same as "nothing has been paid", and a condition must not read it as one.
    const SOURCE = "bookingPayment";
    if (!payment) return field === "exists" ? { value: false, source: SOURCE } : null;

    switch (field) {
      case "exists": return { value: true, source: SOURCE };
      case "status": return { value: payment.status, source: SOURCE };
      case "amountPaid": return { value: payment.amountPaid, source: SOURCE };
      case "refundedAmount": return { value: payment.refundedAmount, source: SOURCE };
      case "createdAt": return { value: payment.createdAt, observedAt: new Date(), source: SOURCE };
      default: return null;
    }
  },
};
