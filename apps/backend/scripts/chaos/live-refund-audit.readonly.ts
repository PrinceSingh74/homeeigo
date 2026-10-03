/**
 * READ-ONLY investigation of homigo_db refund state. Every statement runs inside a READ ONLY
 * transaction (verified with SHOW transaction_read_only before any query). No app code is loaded.
 * Output is aggregate plus booking/payment ids; no names, phones or emails.
 */
import { PrismaClient } from "@prisma/client";

const envText = await Bun.file(".env").text();
const url = envText.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)?.[1] ?? "";
if (!/\/homigo_db(\?|$)/.test(url)) { console.error("REFUSED: .env DATABASE_URL is not homigo_db"); process.exit(2); }
const prisma = new PrismaClient({ datasourceUrl: url + (url.includes("?") ? "&" : "?") + "application_name=readonly-refund-audit&connection_limit=1" });

// A booking is KNOWN TEST-FIXTURE when any marker matches; everything else is reported as LIVE DATABASE EVIDENCE.
const FIXTURE = `(s.name ILIKE 'Adv Service adv-%' OR s.name ILIKE 'reg-%' OR b.booking_number ~ '^(ADV|TIP|AREF|RF|SPR|WFR|D12|SPL|SPM|WRM|WRC)-' OR coalesce(u.email,'') ILIKE '%.test')`;

const out = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
  const q = async (s: string) => (await tx.$queryRawUnsafe(s)) as Array<Record<string, unknown>>;
  const ro = (await q(`SHOW transaction_read_only`))[0]!.transaction_read_only;
  if (ro !== "on") throw new Error("NOT READ ONLY — aborting");

  const refunding = await q(`
    SELECT CASE WHEN ${FIXTURE} THEN 'KNOWN TEST-FIXTURE DATA' ELSE 'LIVE DATABASE EVIDENCE' END AS evidence,
           p.payment_method, b.status::text AS booking_status,
           CASE WHEN p.razorpay_payment_id IS NULL THEN 'none' WHEN p.razorpay_payment_id LIKE 'pay_dev_%' THEN 'dev' ELSE 'gateway-shaped' END AS provider_ref,
           (SELECT string_agg(DISTINCT r.status::text, ',') FROM refund_requests r WHERE r.payment_id = p.id) AS refund_request_statuses,
           (p.refunded_amount > 0) AS has_refunded_amount,
           EXISTS (SELECT 1 FROM journal_entries j WHERE j.reference_id = p.id AND j.type::text = 'REFUND') AS has_refund_journal,
           EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'REFUND') AS has_wallet_refund,
           count(*)::int AS n, round(sum(p.amount_paid)::numeric, 2)::float AS amount_paid,
           min(date_part('day', now() - p.updated_at))::int AS min_age_days, max(date_part('day', now() - p.updated_at))::int AS max_age_days
      FROM payments p JOIN bookings b ON b.id = p.booking_id LEFT JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id
     WHERE p.status::text = 'REFUNDING'
     GROUP BY 1,2,3,4,5,6,7,8 ORDER BY n DESC`);

  const counts = await q(`
    SELECT CASE WHEN ${FIXTURE} THEN 'KNOWN TEST-FIXTURE DATA' ELSE 'LIVE DATABASE EVIDENCE' END AS evidence,
      count(*) FILTER (WHERE b.payment_method = 'wallet' AND b.status::text LIKE 'CANCELLED%' AND coalesce(b.refund_amount,0) = 0)::int AS cancelled_wallet_refund_amount_zero,
      count(*) FILTER (WHERE b.payment_method = 'wallet' AND b.status::text LIKE 'CANCELLED%' AND b.refund_status = 'pending' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
                         AND NOT EXISTS (SELECT 1 FROM refund_requests r WHERE r.idempotency_key = 'cancel-refund:' || b.id))::int AS cancelled_wallet_pending_no_request,
      count(*) FILTER (WHERE b.payment_method = 'wallet_razorpay_split')::int AS split_bookings,
      count(*) FILTER (WHERE b.status::text LIKE 'CANCELLED%' AND b.refund_status = 'pending' AND coalesce(b.refund_amount,0) > 0
                         AND NOT EXISTS (SELECT 1 FROM refund_requests r WHERE r.idempotency_key = 'cancel-refund:' || b.id))::int AS any_cancel_pending_no_request
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id
     GROUP BY 1`);

  const tips = await q(`
    SELECT CASE WHEN ${FIXTURE} THEN 'KNOWN TEST-FIXTURE DATA' ELSE 'LIVE DATABASE EVIDENCE' END AS evidence,
           count(*)::int AS tip_double_journals, coalesce(sum(w.amount),0)::float AS amount
      FROM wallet_transactions w JOIN bookings b ON b.id = w.reference_id LEFT JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id
     WHERE w.reference_type = 'booking_tip' AND w.type::text = 'DEBIT' AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'wallet_debit:' || w.id)
     GROUP BY 1`);

  const legacyWalletRows = await q(`SELECT count(*)::int AS n FROM payments WHERE lower(payment_method) = 'wallet'`);

  // The historical wallet-only cancellations that received nothing.
  const historical = await q(`
    SELECT b.id AS booking_id, b.booking_number, CASE WHEN ${FIXTURE} THEN 'KNOWN TEST-FIXTURE DATA' ELSE 'LIVE DATABASE EVIDENCE' END AS evidence,
           b.status::text AS status, b.final_amount::float AS final_amount, to_char(b.cancelled_at, 'YYYY-MM-DD') AS cancelled_on,
           b.cancelled_by, b.refund_amount::float AS booking_refund_amount, b.refund_status,
           (SELECT coalesce(sum(w.amount),0) FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'DEBIT' AND w.reference_type = 'booking_wallet_payment' AND w.status::text = 'COMPLETED')::float AS wallet_paid,
           (SELECT count(*) FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'DEBIT' AND w.reference_type = 'booking_wallet_payment')::int AS wallet_debits,
           (SELECT count(*) FROM journal_entries j JOIN wallet_transactions w ON j.idempotency_key = 'wallet_debit:' || w.id WHERE w.reference_id = b.id AND w.reference_type = 'booking_wallet_payment')::int AS checkout_journals,
           (SELECT coalesce(sum(w.amount),0) FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'REFUND' AND w.status::text = 'COMPLETED')::float AS refunded,
           (SELECT count(*) FROM journal_entries j WHERE j.idempotency_key = 'wallet_booking_refund:' || b.id OR (j.reference_id = b.id AND j.type::text = 'REFUND'))::int AS refund_journals,
           (SELECT count(*) FROM refund_requests r WHERE r.idempotency_key LIKE '%' || b.id || '%')::int AS refund_requests,
           EXISTS (SELECT 1 FROM users x WHERE x.id = b.user_id) AS user_exists,
           EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id) AS has_payment_row,
           date_part('hour', b.scheduled_date - b.cancelled_at)::int AS hours_before_service
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN users u ON u.id = b.user_id
     WHERE b.payment_method = 'wallet' AND b.payment_status::text = 'SUCCESS' AND b.status::text LIKE 'CANCELLED%'
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
       AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'REFUND')
     ORDER BY b.cancelled_at`);

  return { readOnly: ro, database: (await q(`SELECT current_database() AS d`))[0]!.d, refunding, counts, tips, legacyWalletRows: legacyWalletRows[0]!.n, historical };
}, { isolationLevel: "RepeatableRead", timeout: 60_000 });

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
