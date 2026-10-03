import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";

/** Optional restriction to specific bookings (targeted investigation, and deterministic tests). */
const scope = (ids: string[] | null) => (ids && ids.length > 0 ? Prisma.sql`AND b.id IN (${Prisma.join(ids)})` : Prisma.empty);

/**
 * READ-ONLY booking ↔ money ↔ assignment consistency checks (Phase 40).
 *
 * financial-integrity.service covers the ledger (balance, journals, liabilities). These cover the
 * cross-table STATE contradictions support and finance actually chase. Every check is a single
 * SELECT; nothing here writes, repairs or retries — the output is a report to act on.
 */
export type ConsistencyIssue = {
  check: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** Subject id — a booking id unless `refType` says otherwise. */
  bookingId: string;
  refType: "booking" | "payment" | "user" | "provider" | "journal";
  detail: string;
};

type Check = { check: string; severity: ConsistencyIssue["severity"]; describe: string; refType?: ConsistencyIssue["refType"]; sql: (ids: string[] | null) => Promise<Array<{ id: string; detail: string }>> };

const LIMIT = 200;

const CHECKS: Check[] = [
  {
    check: "PAID_WITHOUT_MONEY",
    severity: "HIGH",
    describe: "booking says SUCCESS but no captured gateway payment and no wallet debit backs it",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'payment_status=' || b.payment_status::text AS detail FROM bookings b
      WHERE b.payment_status::text = 'SUCCESS'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id
                        AND p.status::text IN ('SUCCESS','REFUNDING','PARTIALLY_REFUNDED','REFUNDED'))
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference_id = b.id
                        AND w.reference_type = 'booking_wallet_payment' AND w.status::text = 'COMPLETED')
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "COMPLETED_WITHOUT_EARNING",
    severity: "HIGH",
    describe: "completed booking with a partner but no earning posted",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'provider=' || b.provider_id AS detail FROM bookings b
      WHERE b.status::text = 'COMPLETED' AND b.provider_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM earnings e WHERE e.booking_id = b.id)
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "EARNING_WITHOUT_COMPLETION",
    severity: "HIGH",
    describe: "a credited earning exists for a booking that is not COMPLETED",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'status=' || b.status::text AS detail FROM earnings e JOIN bookings b ON b.id = e.booking_id
      WHERE b.status::text <> 'COMPLETED' AND e.payment_status::text = 'CREDITED'
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "CANCELLED_PAID_NOT_REFUNDED",
    severity: "HIGH",
    describe: "cancelled/rejected booking whose captured money has no refund intent or refund",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'refund_status=' || coalesce(b.refund_status, 'null') || ' refund_amount=' || coalesce(b.refund_amount, 0)::text AS detail
      FROM bookings b
      WHERE b.status::text IN ('CANCELLED_BY_USER','CANCELLED_BY_PROVIDER','REJECTED')
        AND b.payment_status::text = 'SUCCESS'
        AND coalesce(b.refund_status, 'none') IN ('none', 'failed')
        AND coalesce(b.refund_amount, 0) = 0
        AND b.cancelled_at IS NOT NULL
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "REFUND_EXCEEDS_PAID",
    severity: "HIGH",
    describe: "gateway refunds recorded exceed what the payment captured",
    sql: (ids) => prisma.$queryRaw`
      SELECT p.booking_id AS id, 'paid=' || (CASE WHEN p.amount_paid > 0 THEN p.amount_paid ELSE p.amount END)::text || ' refunded=' || p.refunded_amount::text AS detail
      FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.refunded_amount > (CASE WHEN p.amount_paid > 0 THEN p.amount_paid ELSE p.amount END) + 0.005
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "OPEN_OFFER_ON_CLOSED_BOOKING",
    severity: "MEDIUM",
    describe: "an offer is still SENT for a booking that is terminal or already claimed (holds partner capacity)",
    sql: (ids) => prisma.$queryRaw`
      SELECT j.booking_id AS id, 'offered_to=' || a.provider_id || ' status=' || b.status::text AS detail
      FROM assignment_attempts a JOIN assignment_jobs j ON j.id = a.job_id JOIN bookings b ON b.id = j.booking_id
      WHERE a.status::text = 'SENT' AND b.status::text NOT IN ('PENDING')
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "CLAIMED_WITHOUT_PARTNER",
    severity: "HIGH",
    describe: "booking is ACCEPTED/ASSIGNED/EN_ROUTE/IN_PROGRESS with no partner",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'status=' || b.status::text AS detail FROM bookings b
      WHERE b.status::text IN ('ACCEPTED','ASSIGNED','EN_ROUTE','IN_PROGRESS') AND b.provider_id IS NULL
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "JOB_OWNER_DISAGREES",
    severity: "LOW",
    describe: "assignment job records a different partner than the booking",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'booking=' || b.provider_id || ' job=' || coalesce(j.current_provider_id, 'null') AS detail
      FROM assignment_jobs j JOIN bookings b ON b.id = j.booking_id
      WHERE j.status::text = 'ACCEPTED' AND b.provider_id IS NOT NULL
        AND j.current_provider_id IS DISTINCT FROM b.provider_id
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  // ── Financial invariants (Phase 6) ──────────────────────────────────────────────────────
  {
    check: "PAYMENT_WITHOUT_LEDGER",
    severity: "HIGH",
    describe: "a captured gateway payment has no booking_payment journal",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'payment=' || p.id || ' paid=' || p.amount_paid::text AS detail
      FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.status::text IN ('SUCCESS','REFUNDING','PARTIALLY_REFUNDED','REFUNDED') AND p.amount_paid > 0
        AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'booking_payment:' || p.id)
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "LEDGER_WITHOUT_PAYMENT",
    severity: "HIGH",
    refType: "journal",
    describe: "a booking_payment journal names a payment that does not exist",
    sql: () => prisma.$queryRaw`
      SELECT j.id, 'key=' || j.idempotency_key AS detail FROM journal_entries j
      WHERE j.idempotency_key LIKE 'booking_payment:%'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = substring(j.idempotency_key FROM 17))
      ORDER BY j.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "EARNING_WITHOUT_LEDGER",
    severity: "HIGH",
    describe: "a credited earning has no provider_earning journal",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'net=' || e.net_earning::text AS detail FROM earnings e JOIN bookings b ON b.id = e.booking_id
      WHERE e.payment_status::text = 'CREDITED'
        AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'provider_earning:' || e.booking_id)
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "EARNING_ARITHMETIC",
    severity: "HIGH",
    describe: "an earning whose commission or net is impossible (negative, or commission above gross)",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'gross=' || e.gross_amount::text || ' commission=' || e.commission::text || ' net=' || e.net_earning::text AS detail
      FROM earnings e JOIN bookings b ON b.id = e.booking_id
      WHERE e.commission < 0 OR e.net_earning < 0 OR e.commission > e.gross_amount + 0.005
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "BOOKING_TOTAL_INVARIANT",
    severity: "MEDIUM",
    describe: "total_amount ≠ base + taxes − discount − campaign_discount + tip",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'total=' || b.total_amount::text || ' expected=' ||
        (b.base_amount + b.taxes - b.discount - b.campaign_discount + b.tip_amount)::text AS detail
      FROM bookings b
      WHERE abs(b.total_amount - (b.base_amount + b.taxes - b.discount - b.campaign_discount + b.tip_amount)) > 0.01
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "TAX_MISMATCH",
    severity: "MEDIUM",
    describe: "taxes ≠ Math.round(10% of the discounted base) — the pricing formula (half up, as JS rounds)",
    sql: (ids) => prisma.$queryRaw`
      SELECT b.id, 'taxes=' || b.taxes::text || ' expected=' ||
        floor(greatest(0, b.base_amount - b.discount - b.campaign_discount)::numeric * 0.1 + 0.5)::text AS detail
      FROM bookings b
      WHERE abs(b.taxes - floor(greatest(0, b.base_amount - b.discount - b.campaign_discount)::numeric * 0.1 + 0.5)) > 0.01
        ${scope(ids)}
      ORDER BY b.created_at DESC
      LIMIT ${LIMIT}`,
  },
  {
    check: "WALLET_BALANCE_CHAIN",
    severity: "HIGH",
    refType: "user",
    describe: "a customer wallet balance differs from the balance-after of its latest completed wallet transaction",
    sql: () => prisma.$queryRaw`
      SELECT u.id, 'balance=' || u.wallet_balance::text || ' last_after=' || t.wallet_balance_after::text AS detail
      FROM users u
      JOIN LATERAL (SELECT w.wallet_balance_after FROM wallet_transactions w
                    WHERE w.user_id = u.id AND w.status::text = 'COMPLETED'
                    ORDER BY w.created_at DESC, w.id DESC LIMIT 1) t ON true
      WHERE abs(u.wallet_balance - t.wallet_balance_after) > 0.01
      ORDER BY u.created_at DESC
      LIMIT ${LIMIT}`,
  },
];

export const bookingConsistencyService = {
  checks: CHECKS.map(({ check, severity, describe, refType }) => ({ check, severity, describe, refType: refType ?? "booking" })),

  /** Newest bookings first; at most LIMIT per check (`truncated` lists the checks that hit it). */
  async run(opts: { bookingIds?: string[] } = {}): Promise<{ generatedAt: string; totals: Record<string, number>; truncated: string[]; issues: ConsistencyIssue[] }> {
    const issues: ConsistencyIssue[] = [];
    const totals: Record<string, number> = {};
    const truncated: string[] = [];
    for (const c of CHECKS) {
      const rows = await c.sql(opts.bookingIds ?? null);
      totals[c.check] = rows.length;
      if (rows.length >= LIMIT) truncated.push(c.check);
      for (const r of rows) issues.push({ check: c.check, severity: c.severity, bookingId: r.id, refType: c.refType ?? "booking", detail: r.detail });
    }
    return { generatedAt: new Date().toISOString(), totals, truncated, issues };
  },
};
