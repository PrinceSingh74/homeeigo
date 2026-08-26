import "../src/load-env";
import { prisma } from "../src/lib/prisma";

const checks = await prisma.$queryRaw<{ check: string; cnt: number }[]>`
SELECT 'orphan_bookings_no_user' AS check, COUNT(*)::int AS cnt FROM bookings b LEFT JOIN users u ON b.user_id = u.id WHERE u.id IS NULL
UNION ALL SELECT 'orphan_payments_no_booking', COUNT(*)::int FROM payments pay LEFT JOIN bookings b ON pay.booking_id = b.id WHERE pay.booking_id IS NOT NULL AND b.id IS NULL
UNION ALL SELECT 'orphan_wallet_tx_no_user', COUNT(*)::int FROM wallet_transactions wt LEFT JOIN users u ON wt.user_id = u.id WHERE wt.user_id IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'negative_user_wallet', COUNT(*)::int FROM users WHERE wallet_balance < 0
UNION ALL SELECT 'negative_provider_wallet', COUNT(*)::int FROM providers WHERE wallet_balance < 0
UNION ALL SELECT 'orphan_earnings_no_booking', COUNT(*)::int FROM earnings e LEFT JOIN bookings b ON e.booking_id = b.id WHERE b.id IS NULL
UNION ALL SELECT 'duplicate_earnings_per_booking', COUNT(*)::int FROM (
  SELECT booking_id FROM earnings GROUP BY booking_id HAVING COUNT(*) > 1
) d
UNION ALL SELECT 'completed_with_provider_missing_earning', COUNT(*)::int FROM bookings b
  WHERE b.status = 'COMPLETED' AND b.provider_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM earnings e WHERE e.booking_id = b.id)
UNION ALL SELECT 'orphan_messages_no_conversation', COUNT(*)::int FROM booking_messages m
  LEFT JOIN booking_conversations c ON m.conversation_id = c.id WHERE c.id IS NULL
UNION ALL SELECT 'orphan_withdrawals_no_provider', COUNT(*)::int FROM withdrawals w
  LEFT JOIN providers p ON w.provider_id = p.id WHERE p.id IS NULL
UNION ALL SELECT 'duplicate_incentive_payouts', COUNT(*)::int FROM (
  SELECT provider_id, rule_id, period_key FROM partner_incentive_payouts
  GROUP BY provider_id, rule_id, period_key HAVING COUNT(*) > 1
) i
`;

const drift = await prisma.$queryRaw<{ col: string; mismatches: number }[]>`
SELECT 'users.wallet_balance' AS col, COUNT(*)::int AS mismatches FROM users WHERE wallet_balance_paise IS DISTINCT FROM ROUND(wallet_balance * 100)
UNION ALL SELECT 'payments.amount', COUNT(*)::int FROM payments WHERE amount_paise IS DISTINCT FROM ROUND(amount * 100)
UNION ALL SELECT 'wallet_transactions.amount', COUNT(*)::int FROM wallet_transactions WHERE amount_paise IS DISTINCT FROM ROUND(amount * 100)
`;

const failed = checks.filter((c) => Number(c.cnt) > 0);
const driftFail = drift.filter((d) => Number(d.mismatches) > 0);
console.log(JSON.stringify({ checks, drift, failed, driftFail }, null, 2));
await prisma.$disconnect();
if (failed.length > 0 || driftFail.length > 0) process.exit(1);
