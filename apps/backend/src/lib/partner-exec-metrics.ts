/**
 * Partner-operations + executive-KPI Prometheus gauges — REAL values pulled at scrape
 * time from Postgres (no mock data). Registered once at boot (see index.ts).
 *
 * Partner Command Center (P4):
 *   partner_providers_online|offline|busy|available   ← providers.is_online / current_status
 *   partner_active_tracking_sessions                  ← bookings EN_ROUTE/IN_PROGRESS
 *   partner_acceptance_rate                           ← assignment_attempts ACCEPTED / dispatched (24h)
 *   partner_rejection_total                           ← sum(providers.rejected_bookings)
 *   partner_payout_queue                              ← withdrawals in REQUESTED
 *   partner_earnings_daily_inr | partner_earnings_weekly_inr  ← sum(earnings.net_earning) windowed
 *
 * Executive single-pane (P7):
 *   biz_gmv_inr                ← sum(bookings.total_amount) COMPLETED (lifetime)
 *   biz_net_revenue_inr        ← sum(earnings.commission)
 *   biz_gross_margin_pct       ← net_revenue / gmv * 100
 *   biz_active_customers       ← active CUSTOMER users
 *   biz_active_providers       ← providers.is_online = true
 *   ops_booking_completion_rate ← COMPLETED / (COMPLETED + CANCELLED_*)
 *   ops_avg_assignment_seconds ← avg(accepted_at - created_at) over recent bookings
 *   fin_refund_pct             ← bookings with refund / finished bookings * 100
 *   fin_chargeback_pct         ← chargebacks / successful payments * 100
 *   fin_settlement_health      ← completed / (completed + payout queue) * 100
 *   fin_settled_revenue_inr    ← sum(payment_settlements.settled_amount)
 *   fin_payment_success_pct    ← SUCCESS / (SUCCESS + FAILED) payments * 100
 *   biz_orders_today           ← bookings created in last 24h (calendar)
 *   ops_avg_eta_minutes        ← avg(booking.eta) last 7d; fallback when maps histogram empty
 */
import type { BookingStatus } from "@prisma/client";
import prisma from "./prisma";
import { setGauge, registerScrapeSampler } from "./metrics";

const TTL_MS = 20_000;
let last = 0;

const BUSY_STATUSES = ["busy", "on_job", "on_the_way", "in_progress", "en_route"];
const AVAILABLE_STATUSES = ["available", "online", "idle", "ready"];

export function registerPartnerExecSamplers(): void {
  registerScrapeSampler(async () => {
    const now = Date.now();
    if (now - last < TTL_MS) return;
    last = now;

    const dayAgo = new Date(now - 24 * 3600_000);
    const weekAgo = new Date(now - 7 * 24 * 3600_000);

    const [
      online,
      offline,
      providers,
      activeSessions,
      acceptanceAttempts,
      rejectionAgg,
      payoutQueue,
      earningsDaily,
      earningsWeekly,
      gmvAgg,
      commissionAgg,
      activeCustomers,
      completed,
      cancelled,
      refunded,
      ordersToday,
      settledRevenueAgg,
      paymentStats,
      chargebackCount,
      avgEtaRow,
    ] = await Promise.all([
      prisma.provider.count({ where: { isOnline: true } }).catch(() => 0),
      prisma.provider.count({ where: { isOnline: false } }).catch(() => 0),
      prisma.provider.findMany({ select: { currentStatus: true, isOnline: true } }).catch(() => [] as Array<{ currentStatus: string; isOnline: boolean }>),
      prisma.booking.count({ where: { status: { in: ["EN_ROUTE", "IN_PROGRESS"] as BookingStatus[] } } }).catch(() => 0),
      Promise.all([
        prisma.assignmentAttempt.count({ where: { status: "ACCEPTED", dispatchedAt: { gte: dayAgo } } }).catch(() => 0),
        prisma.assignmentAttempt.count({ where: { dispatchedAt: { gte: dayAgo } } }).catch(() => 0),
      ]),
      prisma.provider.aggregate({ _sum: { rejectedBookings: true } }).catch(() => ({ _sum: { rejectedBookings: 0 } })),
      prisma.withdrawal.count({ where: { status: "REQUESTED" } }).catch(() => 0),
      prisma.earning.aggregate({ _sum: { netEarning: true }, where: { createdAt: { gte: dayAgo } } }).catch(() => ({ _sum: { netEarning: 0 } })),
      prisma.earning.aggregate({ _sum: { netEarning: true }, where: { createdAt: { gte: weekAgo } } }).catch(() => ({ _sum: { netEarning: 0 } })),
      prisma.booking.aggregate({ _sum: { totalAmount: true }, where: { status: "COMPLETED" as BookingStatus } }).catch(() => ({ _sum: { totalAmount: 0 } })),
      prisma.earning.aggregate({ _sum: { commission: true } }).catch(() => ({ _sum: { commission: 0 } })),
      prisma.user.count({ where: { role: "CUSTOMER", isActive: true, deletedAt: null } }).catch(() => 0),
      prisma.booking.count({ where: { status: "COMPLETED" as BookingStatus } }).catch(() => 0),
      prisma.booking.count({ where: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] as BookingStatus[] } } }).catch(() => 0),
      prisma.booking.count({ where: { refundAmount: { gt: 0 } } }).catch(() => 0),
      prisma.booking.count({ where: { createdAt: { gte: dayAgo } } }).catch(() => 0),
      prisma.paymentSettlement.aggregate({ _sum: { settledAmount: true } }).catch(() => ({ _sum: { settledAmount: 0 } })),
      Promise.all([
        prisma.payment.count({ where: { status: "SUCCESS" } }).catch(() => 0),
        prisma.payment.count({ where: { status: "FAILED" } }).catch(() => 0),
      ]),
      prisma.chargeback.count().catch(() => 0),
      prisma.$queryRaw<Array<{ avg_eta: number | null }>>`
        SELECT ROUND(AVG(eta)::numeric, 1)::float AS avg_eta
        FROM bookings
        WHERE eta IS NOT NULL AND eta > 0 AND created_at >= ${weekAgo}`,
    ]);

    const [acceptedAttempts, totalAttempts] = acceptanceAttempts;
    const acceptanceRate = totalAttempts > 0 ? Math.round((acceptedAttempts / totalAttempts) * 10000) / 100 : 0;
    const [paymentSuccess, paymentFailed] = paymentStats;
    const paymentAttempts = paymentSuccess + paymentFailed;
    const paymentSuccessPct = paymentAttempts > 0 ? Math.round((paymentSuccess / paymentAttempts) * 1000) / 10 : 0;
    const settledRevenue = settledRevenueAgg._sum.settledAmount ?? 0;
    const chargebackPct =
      paymentSuccess > 0 ? Math.round((chargebackCount / paymentSuccess) * 10000) / 100 : 0;
    const avgEtaMinutes = avgEtaRow[0]?.avg_eta != null ? Number(avgEtaRow[0].avg_eta) : 0;

    // Partner provider states.
    const busy = providers.filter((p) => p.isOnline && BUSY_STATUSES.includes((p.currentStatus ?? "").toLowerCase())).length;
    const available = providers.filter((p) => p.isOnline && AVAILABLE_STATUSES.includes((p.currentStatus ?? "").toLowerCase())).length;
    setGauge("partner_providers_online", online);
    setGauge("partner_providers_offline", offline);
    setGauge("partner_providers_busy", busy);
    setGauge("partner_providers_available", available);
    setGauge("partner_active_tracking_sessions", activeSessions);
    setGauge("partner_acceptance_rate", acceptanceRate);
    setGauge("partner_rejection_total", rejectionAgg._sum.rejectedBookings ?? 0);
    setGauge("partner_payout_queue", payoutQueue);
    setGauge("partner_earnings_daily_inr", Math.round(earningsDaily._sum.netEarning ?? 0));
    setGauge("partner_earnings_weekly_inr", Math.round(earningsWeekly._sum.netEarning ?? 0));

    // Executive KPIs.
    const gmv = gmvAgg._sum.totalAmount ?? 0;
    const netRevenue = commissionAgg._sum.commission ?? 0;
    setGauge("biz_gmv_inr", Math.round(gmv));
    setGauge("biz_net_revenue_inr", Math.round(netRevenue));
    setGauge("biz_gross_margin_pct", gmv > 0 ? Math.round((netRevenue / gmv) * 1000) / 10 : 0);
    setGauge("biz_active_customers", activeCustomers);
    setGauge("biz_active_providers", online);

    const finished = completed + cancelled;
    setGauge("ops_booking_completion_rate", finished > 0 ? Math.round((completed / finished) * 1000) / 10 : 0);
    // Refund rate over all finished (completed + cancelled) bookings — refunds occur on both,
    // so the denominator must include cancellations (else the ratio can exceed 100%).
    setGauge("fin_refund_pct", finished > 0 ? Math.round((refunded / finished) * 1000) / 10 : 0);
    setGauge("fin_chargeback_pct", chargebackPct);
    setGauge("fin_settlement_health", payoutQueue === 0 ? 100 : Math.round((completed / (completed + payoutQueue)) * 1000) / 10);
    setGauge("fin_settled_revenue_inr", Math.round(settledRevenue));
    setGauge("fin_payment_success_pct", paymentSuccessPct);
    setGauge("biz_orders_today", ordersToday);
    setGauge("ops_avg_eta_minutes", avgEtaMinutes);

    // Avg assignment time (acceptedAt − createdAt) over the last 24h of accepted bookings.
    const recent = await prisma.booking
      .findMany({ where: { acceptedAt: { not: null, gte: dayAgo } }, select: { createdAt: true, acceptedAt: true }, take: 500 })
      .catch(() => [] as Array<{ createdAt: Date; acceptedAt: Date | null }>);
    if (recent.length) {
      const avgMs = recent.reduce((s, b) => s + ((b.acceptedAt?.getTime() ?? 0) - b.createdAt.getTime()), 0) / recent.length;
      setGauge("ops_avg_assignment_seconds", Math.max(0, Math.round(avgMs / 1000)));
    } else {
      setGauge("ops_avg_assignment_seconds", 0);
    }
  });
}
