import { BookingStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { isBookingTransitionAllowed } from "../lib/booking-state-machine";
import {
  NO_SHOW_POLICY,
  customerNoShowSettlement,
  evaluateCustomerNoShow,
  providerNoShowSettlement,
  type CustomerNoShowRefusal,
} from "../lib/no-show-policy";
import { bookingRefundService } from "./booking-refund.service";
import { publishBookingStatusBackground } from "../lib/booking-realtime";
import { notificationService } from "./notification.service";

/**
 * §52 / §53 — recording a no-show.
 *
 * Two outcomes, never interchangeable:
 *
 *   CUSTOMER_NO_SHOW  the partner arrived, waited the grace period, and nobody answered. A capped
 *                     fee is retained and the remainder returned.
 *   PROVIDER_NO_SHOW  the partner did not appear. The customer is made whole; no fee, ever.
 *
 * Who may say so is as important as what it costs:
 *   * only the ASSIGNED PARTNER (or an admin) may report a customer no-show — and only with real
 *     arrival evidence on the row, which a partner cannot fabricate here because `arrivedAt` is
 *     written by the arrival path, not by this one;
 *   * only the CUSTOMER (or an admin) may report a provider no-show. A partner cannot declare their
 *     own absence away, and cannot convert it into the customer's.
 *
 * The status change, the audit actor and the settlement decision are one transaction. The refund
 * itself goes through the existing refund authority, which owns idempotency and the gateway.
 */

export type NoShowResult =
  | { ok: true; status: BookingStatus; feeAmount: number; refundAmount: number; refundStatus: string }
  | { error: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATUS" | "NOT_ELIGIBLE"; reason?: CustomerNoShowRefusal; waitedMinutes?: number | null };

/** `reason` is what an admin typed; it is recorded alongside the system's own description. */
type Actor = { userId: string; providerId?: string | null; isAdmin?: boolean; reason?: string };

class BookingNoShowService {
  /**
   * The partner arrived and waited; the customer never appeared.
   *
   * Refuses unless `evaluateCustomerNoShow` finds real evidence — an arrival timestamp and an
   * elapsed grace period. "The appointment time passed" is never sufficient, which is the whole
   * point of §52.
   */
  async reportCustomerNoShow(bookingId: string, actor: Actor): Promise<NoShowResult> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, userId: true, providerId: true, status: true, arrivedAt: true,
        finalAmount: true, baseAmount: true,
        provider: { select: { userId: true } },
      },
    });
    if (!booking) return { error: "NOT_FOUND" };

    // Only the assigned partner, or an admin. A customer cannot declare their own no-show.
    const isAssignedPartner = Boolean(actor.providerId && booking.providerId === actor.providerId);
    if (!isAssignedPartner && !actor.isAdmin) return { error: "FORBIDDEN" };

    const verdict = evaluateCustomerNoShow({ status: booking.status, arrivedAt: booking.arrivedAt });
    if (!verdict.eligible) {
      incCounter("no_show_report_total", { outcome: "refused", kind: "customer", reason: verdict.reason });
      return {
        error: verdict.reason === "BOOKING_NOT_AWAITING_CUSTOMER" ? "INVALID_STATUS" : "NOT_ELIGIBLE",
        reason: verdict.reason,
        waitedMinutes: verdict.waitedMinutes,
      };
    }
    if (!isBookingTransitionAllowed(booking.status as BookingStatus, BookingStatus.CUSTOMER_NO_SHOW)) {
      return { error: "INVALID_STATUS" };
    }

    const refundable = await this.refundableFor(bookingId, booking.userId);
    const settlement = customerNoShowSettlement({
      // The subtotal the fee is a percentage of, capped by what is actually still refundable.
      subtotal: booking.finalAmount,
      capturedAmount: refundable,
    });

    const closed = await this.close(
      { id: bookingId, status: booking.status, providerId: booking.providerId, requireArrival: true },
      BookingStatus.CUSTOMER_NO_SHOW,
      actor,
      `customer did not appear after ${verdict.waitedMinutes} minutes`,
    );
    if (!closed) return { error: "INVALID_STATUS" };

    const refund = await this.settle(bookingId, booking.userId, actor, settlement.refundAmount, "customer no-show");
    this.announce(bookingId, BookingStatus.CUSTOMER_NO_SHOW, booking.userId, {
      feeAmount: settlement.feeAmount,
      refundAmount: settlement.refundAmount,
      waitedMinutes: verdict.waitedMinutes,
    });
    this.tell(
      booking.userId,
      bookingId,
      "Appointment recorded as missed",
      settlement.feeAmount > 0
        ? `Your professional waited ${verdict.waitedMinutes} minutes and could not reach you. A ${NO_SHOW_POLICY.customerNoShowFeePercent}% fee of ₹${settlement.feeAmount} applies; ₹${settlement.refundAmount} is being returned.`
        : `Your professional waited ${verdict.waitedMinutes} minutes and could not reach you. Nothing has been charged.`,
    );
    incCounter("no_show_report_total", { outcome: "recorded", kind: "customer" });
    logger.warn("customer_no_show_recorded", {
      category: "APPLICATION",
      bookingId,
      waitedMinutes: verdict.waitedMinutes,
      graceMinutes: NO_SHOW_POLICY.graceMinutes,
      feeAmount: settlement.feeAmount,
      refundAmount: settlement.refundAmount,
    });
    return { ok: true, status: BookingStatus.CUSTOMER_NO_SHOW, feeAmount: settlement.feeAmount, refundAmount: settlement.refundAmount, refundStatus: refund };
  }

  /**
   * The partner did not appear.
   *
   * No evidence gate beyond the booking's state: the absence of a partner is not something the
   * customer can be asked to prove, and §53 forbids charging them for it. GPS is deliberately not
   * consulted — a missing ping is not proof of anything, and inventing proof is worse than none.
   */
  async reportProviderNoShow(bookingId: string, actor: Actor): Promise<NoShowResult> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, userId: true, providerId: true, status: true, finalAmount: true,
        provider: { select: { userId: true } },
      },
    });
    if (!booking) return { error: "NOT_FOUND" };

    // The customer whose booking it is, or an admin. Never the partner themselves.
    const isOwner = booking.userId === actor.userId;
    if (!isOwner && !actor.isAdmin) return { error: "FORBIDDEN" };
    if (!isBookingTransitionAllowed(booking.status as BookingStatus, BookingStatus.PROVIDER_NO_SHOW)) {
      return { error: "INVALID_STATUS" };
    }

    const refundable = await this.refundableFor(bookingId, booking.userId);
    const settlement = providerNoShowSettlement({ capturedAmount: refundable });

    const closed = await this.close(
      { id: bookingId, status: booking.status, providerId: booking.providerId },
      BookingStatus.PROVIDER_NO_SHOW,
      actor,
      "professional did not appear",
    );
    if (!closed) return { error: "INVALID_STATUS" };

    const refund = await this.settle(bookingId, booking.userId, actor, settlement.refundAmount, "provider no-show");
    this.announce(bookingId, BookingStatus.PROVIDER_NO_SHOW, booking.userId, {
      feeAmount: 0,
      refundAmount: settlement.refundAmount,
    });
    this.tell(
      booking.userId,
      bookingId,
      "Reported — you have not been charged",
      settlement.refundAmount > 0
        ? `We are sorry your professional did not arrive. ₹${settlement.refundAmount} is being returned in full — no fee has been applied.`
        : "We are sorry your professional did not arrive. Nothing has been charged.",
    );
    if (booking.provider?.userId) {
      this.tell(
        booking.provider.userId,
        bookingId,
        "A job was reported as a no-show",
        "The customer reported that you did not arrive for this booking. It has been closed and the customer refunded in full.",
      );
    }
    incCounter("no_show_report_total", { outcome: "recorded", kind: "provider" });
    logger.warn("provider_no_show_recorded", {
      category: "APPLICATION",
      bookingId,
      providerId: booking.providerId,
      refundAmount: settlement.refundAmount,
    });
    return { ok: true, status: BookingStatus.PROVIDER_NO_SHOW, feeAmount: settlement.feeAmount, refundAmount: settlement.refundAmount, refundStatus: refund };
  }

  /**
   * What is still refundable for this booking, across EVERY tender.
   *
   * Delegates to `refundableRemaining`, the same authority the cancellation path uses. Reading the
   * payments row directly was wrong and the tests caught it: a wallet-paid booking has no payments
   * row at all, so a customer no-show computed a fee of zero on a booking that had been paid in
   * full. Gateway, wallet and split all have to be one question, asked in one place.
   */
  private async refundableFor(bookingId: string, userId: string): Promise<number> {
    const remaining = await bookingRefundService.refundableRemaining(bookingId, userId);
    return Math.max(0, remaining ?? 0);
  }

  /**
   * Tell both open apps the booking closed.
   *
   * Without this the transition was silent: a customer watching their booking would have kept
   * seeing EN_ROUTE on a booking that had already been settled and refunded — the same class of
   * failure as rendering EXPIRED as "confirmed". `lib/booking-realtime` is the one publisher for
   * every booking transition, and this path was not using it.
   */
  private announce(bookingId: string, status: BookingStatus, userId: string, extra: Record<string, unknown>): void {
    publishBookingStatusBackground({ bookingId, status, userId, extra });
  }
  /**
   * Say what happened, not just that money moved.
   *
   * The refund path already sends "Refund processed ₹X". On a customer no-show that is a PARTIAL
   * refund with no explanation attached, so somebody charged half the price would never be told
   * why. Detached on purpose: a notification failure must not undo a settled booking.
   */
  private tell(userId: string, bookingId: string, title: string, message: string): void {
    void notificationService.createForUserDetached({
      userId,
      type: "booking_no_show",
      title,
      message,
      referenceId: bookingId,
      referenceType: "booking",
    });
  }
  /**
   * Status + audit actor in one transaction. Capacity is released by the slot trigger.
   *
   * §5: the write is conditional on the booking still being exactly what the checks above saw —
   * same status, same partner, and (for a customer no-show) an arrival on record. It used to be
   * `update where { id }`: a partner completing or a customer cancelling between the read and this
   * write was silently overwritten, turning a COMPLETED job into a no-show and running a second
   * settlement on top of the first. Two concurrent reports now resolve to exactly one winner; the
   * loser gets `false` and settles nothing.
   */
  private async close(
    seen: { id: string; status: BookingStatus; providerId: string | null; requireArrival?: boolean },
    status: BookingStatus,
    actor: Actor,
    reason: string,
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, {
        actorType: actor.isAdmin ? "admin" : actor.providerId ? "partner" : "customer",
        actorId: actor.userId,
        reason: actor.reason ? `${reason} — ${actor.reason}` : reason,
      });
      const res = await tx.booking.updateMany({
        where: {
          id: seen.id,
          status: seen.status,
          providerId: seen.providerId,
          ...(seen.requireArrival ? { arrivedAt: { not: null } } : {}),
        },
        data: { status, cancelledAt: new Date() },
      });
      return res.count === 1;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 });
  }

  /** Whatever is owed back goes through the ONE refund authority; zero means nothing to do. */
  private async settle(bookingId: string, userId: string, actor: Actor, amount: number, reason: string): Promise<string> {
    if (amount <= 0) return "none";
    const result = await bookingRefundService.processCancellationRefund({
      bookingId,
      userId,
      actorUserId: actor.userId,
      reason,
      cancelledBy: actor.isAdmin ? "admin" : actor.providerId ? "provider" : "user",
      refundAmount: amount,
    });
    return result.status;
  }
}

export const bookingNoShowService = new BookingNoShowService();
