import "../src/load-env";
import { prisma } from "../src/lib/prisma";

const checks = await prisma.$queryRaw<
  { check: string; cnt: number }[]
>`SELECT 'orphan_bookings_no_user' AS check, COUNT(*)::int AS cnt FROM bookings b LEFT JOIN users u ON b.user_id = u.id WHERE u.id IS NULL
UNION ALL SELECT 'orphan_payments_no_booking', COUNT(*)::int FROM payments pay LEFT JOIN bookings b ON pay.booking_id = b.id WHERE pay.booking_id IS NOT NULL AND b.id IS NULL
UNION ALL SELECT 'orphan_wallet_tx_no_user', COUNT(*)::int FROM wallet_transactions wt LEFT JOIN users u ON wt.user_id = u.id WHERE wt.user_id IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'negative_user_wallet', COUNT(*)::int FROM users WHERE wallet_balance < 0
UNION ALL SELECT 'negative_provider_wallet', COUNT(*)::int FROM providers WHERE wallet_balance < 0`;

const drift = await prisma.$queryRaw<
  { col: string; mismatches: number }[]
>`SELECT 'users.wallet_balance' AS col, COUNT(*)::int AS mismatches FROM users WHERE wallet_balance_paise IS DISTINCT FROM ROUND(wallet_balance * 100)
UNION ALL SELECT 'payments.amount', COUNT(*)::int FROM payments WHERE amount_paise IS DISTINCT FROM ROUND(amount * 100)
UNION ALL SELECT 'wallet_transactions.amount', COUNT(*)::int FROM wallet_transactions WHERE amount_paise IS DISTINCT FROM ROUND(amount * 100)`;

console.log(JSON.stringify({ checks, drift }, null, 2));
await prisma.$disconnect();
