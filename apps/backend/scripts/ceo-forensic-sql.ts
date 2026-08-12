/** One-off forensic SQL for CEO dashboard audit. */
import "../src/load-env";
import prisma from "../src/lib/prisma";

const [refund, demo, attempts, settlements, payments] = await Promise.all([
  prisma.$queryRaw<
    Array<{
      total_finished: number;
      refunded: number;
      completed: number;
      cancelled: number;
      refund_pct: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER'))::int AS total_finished,
      COUNT(*) FILTER (WHERE refund_amount > 0)::int AS refunded,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE status IN ('CANCELLED_BY_USER','CANCELLED_BY_PROVIDER'))::int AS cancelled,
      ROUND(
        COUNT(*) FILTER (WHERE refund_amount > 0)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED_BY_USER','CANCELLED_BY_PROVIDER')), 0)
        * 100, 1
      )::float AS refund_pct
    FROM bookings`,
  prisma.$queryRaw<Array<{ demo_refunds: number }>>`
    SELECT COUNT(*)::int AS demo_refunds
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.refund_amount > 0
      AND (u.email LIKE '%demo%' OR u.email LIKE '%test%' OR u.email LIKE '%@homigo.demo')`,
  prisma.$queryRaw<Array<{ accepted_24h: number; total_24h: number }>>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'ACCEPTED' AND dispatched_at >= NOW() - INTERVAL '24 hours')::int AS accepted_24h,
      COUNT(*) FILTER (WHERE dispatched_at >= NOW() - INTERVAL '24 hours')::int AS total_24h
    FROM assignment_attempts`,
  prisma.$queryRaw<Array<{ inr: number; cnt: number }>>`
    SELECT COALESCE(SUM(settled_amount), 0)::float AS inr, COUNT(*)::int AS cnt FROM payment_settlements`,
  prisma.$queryRaw<Array<{ status: string; cnt: number }>>`
    SELECT status, COUNT(*)::int AS cnt FROM payments GROUP BY status ORDER BY cnt DESC`,
]);

console.log(
  JSON.stringify(
    {
      refund: refund[0],
      demoRefunds: demo[0],
      acceptance24h: attempts[0],
      settlements: settlements[0],
      payments,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
