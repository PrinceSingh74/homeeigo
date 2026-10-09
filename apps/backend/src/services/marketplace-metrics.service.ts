import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { analyticsSqlPredicate, analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import {
  CANCELLED_BOOKING_STATUSES,
  cancellationRatePct,
  completionRatePct,
} from "../lib/fulfillment-rates";
import { CREDITED_EARNING_WHERE } from "../lib/earning-settlement";

/**
 * Phase 15.4 — the marketplace metrics. One implementation, used by the admin analytics
 * response. Nothing here reads an analytics event as money or as a booking outcome.
 *
 * Time window. A `YYYY-MM-DD` bound is an Asia/Kolkata calendar day (bookings are slotted
 * in IST). Anything else is parsed as an instant. The cohort is bookings *created* in the
 * window, which is what the admin analytics page already counted; completion is not
 * "completed during the window".
 *
 * Population. `analyticsWhere()` / `analyticsWhereVia()` — NULL (UNKNOWN) or REAL. The
 * client cannot choose it.
 *
 * Empty and zero. A rate whose denominator is 0 is `null` (unmeasured). It is not 0.
 *
 * Completion and cancellation. `lib/fulfillment-rates.ts`, the definition geo-intelligence
 * and coverage already share: completed, or cancelled, over finished
 * (COMPLETED + CANCELLED_BY_USER + CANCELLED_BY_PROVIDER). REJECTED is a dispatch
 * outcome. EXPIRED and the no-show statuses are not cancellations. An admin cancellation
 * is stored as CANCELLED_BY_USER with `cancelledBy = "admin"` (booking.service), so it is
 * inside the rate and reported separately in the attribution counts.
 *
 * Repeat. The locked `repeatCustomerRatePct`: a customer with more than one COMPLETED
 * business booking, any service, any provider, no time limit on those completions.
 * Denominator: distinct business customers with a business booking created in the window.
 * This is the customer-intelligence query, moved here so the admin page cannot keep a
 * second one. A partner's own repeat rate (partner-os) applies the same repeater test to
 * that partner's customers; it is not a different definition of "repeat".
 *
 * Conversion. One rate, named for what it is. `quoteToBookingPct`: distinct business
 * customers who received a QUOTE_GENERATED event in the window AND have an authoritative
 * business booking created in the window, over distinct business customers with a
 * QUOTE_GENERATED event. The numerator is the bookings table, not the event. Quotes are
 * best-effort measurement, so a lost quote under-counts the denominator. Null when nobody
 * was quoted. This is not the partner-acquisition lead conversion, which keeps its own name.
 *
 * Revenue. Captured customer money, not a booking's listed price and not an analytics
 * event. Gateway (and any other) capture is `payments.amount_paid` where status is SUCCESS
 * and `completed_at` is in the window, business via the booking. A wallet leg is a
 * COMPLETED DEBIT `wallet_transactions` row with `reference_type = booking_wallet_payment`
 * (wallet-only checkouts have no payment row; a split keeps the gateway remainder on the
 * payment and the wallet share on the transaction, so adding them does not double-count).
 * Refunds are COMPLETED `refund_requests` processed in the window, business. Net is
 * captured minus those refunds and is allowed to be negative. Platform commission stays
 * the credited `earnings.commission` sum: Earning has no provenance column and no booking
 * relation, so it cannot inherit one without a schema change.
 */
const IST = "+05:30";

export function metricInstant(value: string | undefined, edge: "start" | "end", fallback: Date): Date {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}${IST}`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function repeatCustomerRate(since: Date, until: Date): Promise<{
  customersInWindow: number;
  repeatCustomers: number;
  repeatCustomerRatePct: number | null;
}> {
  const business = analyticsSqlPredicate("bookings");
  const rows = await prisma.$queryRaw<Array<{ total: number; repeaters: number }>>`
    SELECT COUNT(DISTINCT user_id)::int AS total,
           COUNT(DISTINCT user_id) FILTER (
             WHERE user_id IN (
               SELECT user_id FROM bookings
               WHERE status = 'COMPLETED' AND user_id IS NOT NULL
                 AND ${Prisma.raw(business)}
               GROUP BY user_id HAVING COUNT(*) > 1
             )
           )::int AS repeaters
    FROM bookings
    WHERE created_at >= ${since} AND created_at <= ${until} AND user_id IS NOT NULL
      AND ${Prisma.raw(business)}`;
  const customersInWindow = rows[0]?.total ?? 0;
  const repeatCustomers = rows[0]?.repeaters ?? 0;
  return {
    customersInWindow,
    repeatCustomers,
    repeatCustomerRatePct: customersInWindow > 0 ? Math.round((repeatCustomers / customersInWindow) * 1000) / 10 : null,
  };
}

export async function marketplaceMetrics(start: Date, end: Date) {
  const created = { createdAt: { gte: start, lte: end }, ...analyticsWhere() };
  const [completed, cancelledRows, gateway, wallet, refunds, earnings, repeat, quoted] = await Promise.all([
    prisma.booking.count({ where: { ...created, status: "COMPLETED" } }),
    prisma.booking.groupBy({
      by: ["cancelledBy"],
      where: { ...created, status: { in: CANCELLED_BOOKING_STATUSES } },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { status: "SUCCESS", completedAt: { gte: start, lte: end }, ...analyticsWhereVia("payment") },
      _sum: { amountPaid: true },
    }),
    prisma.walletTransaction.aggregate({
      where: {
        type: "DEBIT",
        status: "COMPLETED",
        referenceType: "booking_wallet_payment",
        createdAt: { gte: start, lte: end },
        ...analyticsWhereVia("walletTransaction"),
      },
      _sum: { amount: true },
    }),
    prisma.refundRequest.aggregate({
      where: { status: "COMPLETED", processedAt: { gte: start, lte: end }, ...analyticsWhere() },
      _sum: { amount: true },
    }),
    prisma.earning.aggregate({
      where: { createdAt: { gte: start, lte: end }, ...CREDITED_EARNING_WHERE },
      _sum: { commission: true },
    }),
    repeatCustomerRate(start, end),
    prisma.analyticsEvent.groupBy({
      by: ["actorUserId"],
      where: {
        eventName: "QUOTE_GENERATED",
        occurredAt: { gte: start, lte: end },
        actorUserId: { not: null },
        ...analyticsWhere(),
      },
    }),
  ]);

  const attribution = { customer: 0, admin: 0, partner: 0, unattributed: 0 };
  let cancelled = 0;
  for (const row of cancelledRows) {
    const n = row._count;
    cancelled += n;
    if (row.cancelledBy === "admin") attribution.admin += n;
    else if (row.cancelledBy === "provider") attribution.partner += n;
    else if (row.cancelledBy === "user") attribution.customer += n;
    else attribution.unattributed += n;
  }

  const quoteUserIds = quoted.map((q) => q.actorUserId).filter((id): id is string => id != null);
  const booked = quoteUserIds.length
    ? await prisma.booking.groupBy({
        by: ["userId"],
        where: { ...created, userId: { in: quoteUserIds } },
      })
    : [];
  const quoteToBookingPct =
    quoteUserIds.length > 0 ? Math.round((booked.length / quoteUserIds.length) * 1000) / 10 : null;

  const gatewayCaptured = round2(gateway._sum.amountPaid ?? 0);
  const walletCaptured = round2(wallet._sum.amount ?? 0);
  const refunded = round2(refunds._sum.amount ?? 0);
  const capturedGmv = round2(gatewayCaptured + walletCaptured);

  return {
    completionRatePct: completionRatePct(completed, cancelled),
    cancellationRatePct: cancellationRatePct(completed, cancelled),
    completed,
    cancelled,
    cancellationAttribution: attribution,
    repeatCustomerRatePct: repeat.repeatCustomerRatePct,
    repeatCustomers: repeat.repeatCustomers,
    customersInWindow: repeat.customersInWindow,
    quoteToBookingPct,
    quotedCustomers: quoteUserIds.length,
    quotedCustomersWhoBooked: booked.length,
    gatewayCaptured,
    walletCaptured,
    capturedGmv,
    refunds: refunded,
    netCaptured: round2(capturedGmv - refunded),
    platformCommission: round2(earnings._sum.commission ?? 0),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
