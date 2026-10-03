import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildBookingPaymentExpiredEvent } from "../events/catalog/booking.events";
import { publishBookingStatusBackground } from "../lib/booking-realtime";
import { followUpColumnsPresent, isNoPaymentFollowUp } from "./booking-payment-gate";

/**
 * Phase 09 — PAYMENT_PENDING_TTL.
 *
 * Owner decision, 2026-09-23: a booking whose payment has not settled within **15 minutes** expires,
 * and its capacity is released. Before this, an abandoned checkout held a partner's slot for ever:
 * 85 bookings on the live database sit PENDING/PENDING and 35 PENDING/INITIATED, every one of them
 * occupying a window nobody can book.
 *
 * ── Scope, stated rather than assumed ───────────────────────────────────────────────────────────
 * Only bookings still in **PENDING** are expired. A booking that reached ACCEPTED, ASSIGNED, EN_ROUTE
 * or IN_PROGRESS has a partner committed to it (43 such bookings are ACCEPTED-but-unpaid on the live
 * database today); cancelling that is a different business event with a different cost, and it is not
 * something a sweep should decide. That remains an owner question.
 *
 * Only bookings whose appointment is still in the FUTURE are expired, because the purpose of the
 * transition is to release capacity, and a past-dated booking holds none. The historical backlog of
 * past-dated unpaid bookings is reported, never silently rewritten.
 *
 * ── What it must never do ───────────────────────────────────────────────────────────────────────
 * Expire anything that has been paid. The candidate query filters on payment state and the decision
 * is then RE-CHECKED under `FOR UPDATE` inside the transaction, because a capture can land between
 * the two. The row is expired only if it is still unpaid at that moment.
 *
 * Capacity release needs no code here: `bookings_sync_conflict_slots` nulls the slot columns for any
 * status outside the active set, and the exclusion constraints only bind where those columns are set.
 */

/** Owner decision 2026-09-23. */
export const PAYMENT_PENDING_TTL_MINUTES = 15;

/** Payment states that mean "no money has settled yet". */
const UNSETTLED = ["PENDING", "INITIATED", "PROCESSING"] as const;

export type ExpirySweepResult = {
  scanned: number;
  expired: number;
  /** Candidates that turned out to be settled or already moved on when locked. */
  skipped: number;
  /** Past-dated unpaid PENDING bookings, which this sweep deliberately does not touch. */
  pastDatedBacklog: number;
};

type Candidate = {
  id: string;
  user_id: string;
  provider_id: string | null;
  scheduled_date: Date;
  payment_status: string;
};

class BookingPaymentExpiryService {
  /**
   * One booking, one transaction: status + payment row + audit actor + event, or nothing.
   *
   * Returns false when the locked row no longer qualifies — which is the normal outcome of a race
   * with a capture, not an error.
   */
  private async expireOne(c: Candidate, ttlMinutes: number): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, {
        actorType: "system",
        actorId: "payment-expiry",
        reason: `payment not settled within ${ttlMinutes} minutes`,
      });

      // Re-read under the row lock: a capture may have landed since the candidate query.
      const locked = await tx.$queryRaw<Array<{ status: string; payment_status: string; scheduled_date: Date }>>`
        SELECT status, payment_status, scheduled_date FROM bookings WHERE id = ${c.id} FOR UPDATE
      `;
      const row = locked[0];
      if (!row) return false;
      if (row.status !== "PENDING") return false;
      if (!(UNSETTLED as readonly string[]).includes(row.payment_status)) return false;
      if (row.scheduled_date.getTime() <= Date.now()) return false;
      // §11: a waived-fee follow-up owes nothing; there is no payment window to expire.
      if (await isNoPaymentFollowUp(c.id, tx)) return false;

      // A captured payment row is money received; it must never be expired underneath the customer.
      const payments = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM payments WHERE booking_id = ${c.id} FOR UPDATE
      `;
      if (payments.some((p) => !(UNSETTLED as readonly string[]).includes(p.status))) return false;

      // Raw SQL for the write: the generated Prisma client in this checkout predates the EXPIRED
      // enum values, and regenerating it would disturb the running dev servers that hold its engine.
      // The database has both values (migration 20260923110000_payment_expiry_states).
      await tx.$executeRaw`
        UPDATE bookings
        SET status = 'EXPIRED'::"BookingStatus", payment_status = 'EXPIRED'::"PaymentStatus", updated_at = NOW()
        WHERE id = ${c.id}
      `;
      for (const p of payments) {
        await tx.$executeRaw`
          UPDATE payments SET status = 'EXPIRED'::"PaymentStatus", updated_at = NOW() WHERE id = ${p.id}
        `;
      }

      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(
          tx,
          buildBookingPaymentExpiredEvent({
            bookingId: c.id,
            userId: c.user_id,
            providerId: c.provider_id,
            scheduledAt: c.scheduled_date,
            ttlMinutes,
            previousPaymentStatus: c.payment_status,
          }),
        );
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 });
  }

  /**
   * Expire every PENDING booking whose payment has not settled within the TTL.
   *
   * `limit` bounds a single tick so a large backlog is drained over several passes rather than in one
   * long transaction-heavy burst.
   */
  async expireStalePendingPayments(
    limit = 50,
    ttlMinutes = PAYMENT_PENDING_TTL_MINUTES,
    opts?: { bookingId?: string },
  ): Promise<ExpirySweepResult> {
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const out: ExpirySweepResult = { scanned: 0, expired: 0, skipped: 0, pastDatedBacklog: 0 };

    // §11: waived-fee follow-ups are excluded in the scan itself, so they can never occupy its window.
    const excludeFollowUps = (await followUpColumnsPresent())
      ? Prisma.sql`AND NOT (booking_kind IN ('REWORK', 'REVISIT') AND case_id IS NOT NULL AND total_amount = 0)`
      : Prisma.empty;
    const candidates = await prisma.$queryRaw<Candidate[]>`
      SELECT id, user_id, provider_id, scheduled_date, payment_status
      FROM bookings
      WHERE status = 'PENDING'
        AND payment_status IN ('PENDING', 'INITIATED', 'PROCESSING')
        AND created_at <= ${cutoff}
        AND scheduled_date > NOW()
        AND (${opts?.bookingId ?? null}::text IS NULL OR id = ${opts?.bookingId ?? null})
        ${excludeFollowUps}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    out.scanned = candidates.length;

    for (const c of candidates) {
      try {
        if (await this.expireOne(c, ttlMinutes)) {
          out.expired += 1;
          /**
           * §5: every transition reaches the open apps through the one publisher, after commit.
           * Expiry was the one that did not — a customer watching the booking kept seeing it as
           * awaiting payment after the slot had already been released.
           */
          publishBookingStatusBackground({
            bookingId: c.id,
            status: "EXPIRED",
            userId: c.user_id,
            extra: { paymentStatus: "EXPIRED", ttlMinutes },
          });
          incCounter("booking_payment_expired_total", { outcome: "expired" });
          logger.info("booking_payment_expired", {
            category: "PAYMENT",
            bookingId: c.id,
            scheduledAt: c.scheduled_date.toISOString(),
            previousPaymentStatus: c.payment_status,
            ttlMinutes,
          });
        } else {
          out.skipped += 1;
          incCounter("booking_payment_expired_total", { outcome: "skipped" });
        }
      } catch (err) {
        out.skipped += 1;
        incCounter("booking_payment_expired_total", { outcome: "error" });
        logger.error("booking_payment_expiry_failed", {
          category: "PAYMENT",
          bookingId: c.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Reported, never touched: these hold no capacity, and rewriting historical rows is not a
    // decision a sweep gets to make.
    const backlog = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM bookings
      WHERE status = 'PENDING' AND payment_status IN ('PENDING', 'INITIATED', 'PROCESSING')
        AND scheduled_date <= NOW()
    `;
    out.pastDatedBacklog = Number(backlog[0]?.n ?? 0);
    return out;
  }
}

export const bookingPaymentExpiryService = new BookingPaymentExpiryService();
