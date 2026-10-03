/**
 * READ-ONLY remediation evidence from homigo_db (Phases 5–7). Every statement runs inside a READ ONLY
 * transaction verified before the first query; no application code is loaded; ids and amounts only.
 *   bun scripts/chaos/live-remediation-evidence.readonly.ts <out.json>
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const envText = await Bun.file(".env").text();
const url = envText.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)?.[1] ?? "";
if (!/\/homigo_db(\?|$)/.test(url)) { console.error("REFUSED: .env DATABASE_URL is not homigo_db"); process.exit(2); }
const prisma = new PrismaClient({ datasourceUrl: url + (url.includes("?") ? "&" : "?") + "application_name=readonly-remediation-evidence&connection_limit=1" });
const HIST = "HOMIGO-20260901-00001";

const out = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
  const q = async (s: string, ...a: unknown[]) => (await tx.$queryRawUnsafe(s, ...a)) as Array<Record<string, unknown>>;
  if ((await q(`SHOW transaction_read_only`))[0]!.transaction_read_only !== "on") throw new Error("NOT READ ONLY");

  // ── Phase 5: the REFUNDING payments, one row each ──
  const refunding = await q(`
    SELECT p.id AS payment_id, b.booking_number, b.status::text AS booking_status, p.payment_method,
           p.amount::float AS payment_amount, p.amount_paid::float AS amount_paid, p.refunded_amount::float AS refunded_amount,
           CASE WHEN p.razorpay_payment_id IS NULL THEN 'none' WHEN p.razorpay_payment_id LIKE 'pay_dev_%' THEN 'dev' ELSE 'gateway-shaped' END AS provider_ref,
           to_char(p.created_at,'YYYY-MM-DD') AS paid_on, date_part('day', now() - p.updated_at)::int AS payment_age_days,
           EXISTS (SELECT 1 FROM journal_entries j WHERE j.reference_id = p.id AND j.type::text = 'REFUND') AS local_refund_journal,
           EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.reference_id = b.id AND w.type::text = 'REFUND') AS local_wallet_refund,
           (SELECT json_agg(json_build_object(
                'key_kind', CASE WHEN r.idempotency_key LIKE 'cancel-refund:%' THEN 'cancellation' WHEN r.idempotency_key LIKE 'admin-refund:%' THEN 'admin'
                                 WHEN r.idempotency_key LIKE 'refund:%' THEN 'orchestrator-direct' ELSE 'other' END,
                'status', r.status::text, 'amount', r.amount,
                'created', to_char(r.created_at,'YYYY-MM-DD HH24:MI'), 'updated', to_char(r.updated_at,'YYYY-MM-DD HH24:MI'),
                'has_gateway_refund_id', r.gateway_refund_id IS NOT NULL,
                'audits', (SELECT string_agg(a.action, '>' ORDER BY a.created_at) FROM refund_audits a WHERE a.refund_request_id = r.id))
              ORDER BY r.created_at) FROM refund_requests r WHERE r.payment_id = p.id) AS refund_requests
      FROM payments p JOIN bookings b ON b.id = p.booking_id
     WHERE p.status::text = 'REFUNDING'
     ORDER BY p.created_at`);
  const recoveryClaims = (await q(`SELECT count(*)::int n, to_char(max(created_at),'YYYY-MM-DD HH24:MI:SS') last FROM refund_audits WHERE action='RECOVERY_CLAIMED'`))[0];

  // ── Phase 6: the historical wallet cancellation ──
  const hb = (await q(`SELECT b.id, b.booking_number, b.user_id IS NOT NULL AS has_user, b.status::text, b.payment_status::text, b.payment_method,
      b.final_amount::float, b.refund_amount::float, b.refund_status, b.cancelled_by, left(coalesce(b.cancellation_reason,''),80) AS cancellation_reason,
      to_char(b.created_at,'YYYY-MM-DD HH24:MI') created, to_char(b.scheduled_date,'YYYY-MM-DD HH24:MI') scheduled, to_char(b.cancelled_at,'YYYY-MM-DD HH24:MI') cancelled,
      round((extract(epoch from b.scheduled_date - b.cancelled_at)/3600)::numeric, 2)::float AS hours_before_service,
      EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id) AS has_payment_row
      FROM bookings b WHERE b.booking_number = $1`, HIST))[0];
  let historical: Record<string, unknown> = { booking: hb ?? null };
  if (hb) {
    const bid = hb.id as string;
    historical = {
      booking: hb,
      walletTxns: await q(`SELECT w.id, w.type::text, w.status::text, w.reference_type, w.amount::float, w.wallet_balance_before::float AS before, w.wallet_balance_after::float AS after,
          w.idempotency_key, to_char(w.created_at,'YYYY-MM-DD HH24:MI:SS') created FROM wallet_transactions w WHERE w.reference_id = $1 ORDER BY w.created_at`, bid),
      journals: await q(`SELECT j.idempotency_key, j.type::text, to_char(j.created_at,'YYYY-MM-DD HH24:MI:SS') created,
          json_agg(json_build_object('account', a.code, 'debit', l.debit, 'credit', l.credit) ORDER BY a.code) AS lines
          FROM journal_entries j JOIN ledger_entries l ON l.journal_id = j.id JOIN ledger_accounts a ON a.id = l.account_id
         WHERE j.reference_id = $1 OR j.reference_id IN (SELECT id FROM wallet_transactions WHERE reference_id = $1) OR j.idempotency_key LIKE '%' || $1 || '%'
         GROUP BY j.id ORDER BY j.created_at`, bid),
      refundRequests: await q(`SELECT count(*)::int n FROM refund_requests WHERE idempotency_key LIKE '%' || $1 || '%'`, bid),
      cancelledEvent: await q(`SELECT event_type, status::text, to_char(created_at,'YYYY-MM-DD HH24:MI:SS') created,
          payload->'data'->>'refundAmount' AS promised_refund, payload->'data'->>'refundAmountPaise' AS promised_refund_paise, payload->'data'->>'cancelledBy' AS by
          FROM event_outbox WHERE aggregate_id = $1 AND event_type ILIKE '%cancel%'`, bid),
      customerWalletNow: (await q(`SELECT u.wallet_balance::float AS balance, u.wallet_balance_paise::text AS paise FROM users u JOIN bookings b ON b.user_id = u.id WHERE b.id = $1`, bid))[0],
      customerLaterWalletTxns: (await q(`SELECT count(*)::int n FROM wallet_transactions w JOIN bookings b ON b.user_id = w.user_id WHERE b.id = $1 AND w.created_at > b.cancelled_at`, bid))[0],
    };
  }
  const liveWalletGap = (await q(`SELECT (SELECT coalesce(sum(wallet_balance_paise),0) FROM users)::text AS ops_paise,
      (SELECT coalesce(sum(l.credit_paise - l.debit_paise),0) FROM ledger_entries l JOIN ledger_accounts a ON a.id = l.account_id WHERE a.code = 'CUSTOMER_WALLET')::text AS ledger_paise`))[0];

  // ── Phase 7: the duplicate tip journal ──
  const tip = await q(`
    SELECT w.id AS tip_debit_id, w.amount::float, w.reference_id AS booking_id, w.idempotency_key, to_char(w.created_at,'YYYY-MM-DD HH24:MI:SS') tip_at,
           (SELECT json_agg(json_build_object('key', j.idempotency_key, 'type', j.type::text, 'description', left(j.description,60), 'created', to_char(j.created_at,'YYYY-MM-DD HH24:MI:SS'),
                    'balanced', (SELECT sum(l.debit_paise) = sum(l.credit_paise) FROM ledger_entries l WHERE l.journal_id = j.id),
                    'lines', (SELECT json_agg(json_build_object('account', a.code, 'debit', l.debit, 'credit', l.credit)) FROM ledger_entries l JOIN ledger_accounts a ON a.id = l.account_id WHERE l.journal_id = j.id))
                   ORDER BY j.created_at)
              FROM journal_entries j WHERE j.idempotency_key IN ('booking_tip:' || w.reference_id, 'wallet_debit:' || w.id)) AS journals
      FROM wallet_transactions w
     WHERE w.reference_type = 'booking_tip' AND w.type::text = 'DEBIT'`);
  const tipsAfterFix = (await q(`SELECT count(*)::int n, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM journal_entries j WHERE j.idempotency_key = 'wallet_debit:' || w.id))::int duplicated
      FROM wallet_transactions w WHERE w.reference_type = 'booking_tip' AND w.type::text = 'DEBIT' AND w.created_at > '2026-09-18 21:05:00+00'`))[0];
  const backfillRuns = await q(`SELECT to_char(created_at,'YYYY-MM-DD HH24:MI') at, status::text FROM ledger_backfill_runs ORDER BY created_at DESC LIMIT 3`).catch(() => [{ note: "ledger_backfill_runs unreadable" }]);

  return { readOnly: "on", refundingCount: refunding.length, refunding, recoveryClaims, historical, liveWalletGap, tip, tipsAfterFix, backfillRuns };
}, { isolationLevel: "RepeatableRead", timeout: 60_000 });

writeFileSync(process.argv[2] ?? "live-remediation-evidence.json", JSON.stringify(out, null, 1));
console.log(`wrote ${process.argv[2]} — refunding ${out.refundingCount}, recovery claims ${JSON.stringify(out.recoveryClaims)}`);
await prisma.$disconnect();
