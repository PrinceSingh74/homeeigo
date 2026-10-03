-- Wallet-transaction and withdrawal numbers from Postgres sequences.
--
-- These numbers are minted INSIDE money transactions. A counter row (document_sequences) would either
-- hold a platform-wide row lock until each wallet transaction commits, or — taken on a second
-- connection — let concurrent transactions exhaust the pool waiting on each other (observed: the
-- gift-card concurrent-redemption suite timed out). nextval() runs on the caller's own connection,
-- never blocks and never rolls back, so it is safe inside any transaction.
--
-- Numbers keep their shape (WXN-YYYYMMDD-NNNNN / WD-YYYYMMDD-NNNNN, 5+ digits) but the numeric part
-- no longer restarts daily. Each sequence starts above every numeric part already issued, so no new
-- number can repeat an old one on any day. Booking numbers stay on the daily document_sequences
-- counter (minted outside the booking transaction; their 5-digit daily format is a contract).
--
-- Hand-scoped, additive, re-runnable (setval never moves a sequence backwards).
CREATE SEQUENCE IF NOT EXISTS "wallet_txn_number_seq";
CREATE SEQUENCE IF NOT EXISTS "withdrawal_number_seq";

SELECT setval(
  'wallet_txn_number_seq',
  GREATEST(
    COALESCE((SELECT MAX(SUBSTRING(transaction_number FROM '^WXN-[0-9]{8}-([0-9]{5,})')::bigint) FROM wallet_transactions), 0),
    (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM wallet_txn_number_seq)
  ) + 1,
  false
);

SELECT setval(
  'withdrawal_number_seq',
  GREATEST(
    COALESCE((SELECT MAX(SUBSTRING(withdrawal_number FROM '^WD-[0-9]{8}-([0-9]{5,})')::bigint) FROM withdrawals), 0),
    (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM withdrawal_number_seq)
  ) + 1,
  false
);
