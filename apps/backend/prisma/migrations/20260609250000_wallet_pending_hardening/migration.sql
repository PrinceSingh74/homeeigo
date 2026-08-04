-- Wallet pending top-up hardening: expiry, idempotency, EXPIRED status

ALTER TYPE "WalletTxnStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_idempotency_key_key"
  ON "wallet_transactions" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_txn_razorpay_order_active_unique"
  ON "wallet_transactions" ("reference_id")
  WHERE "reference_type" = 'razorpay_order'
    AND "status" IN ('PENDING', 'COMPLETED');

CREATE INDEX IF NOT EXISTS "wallet_transactions_user_id_status_idx"
  ON "wallet_transactions" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "wallet_transactions_expires_at_idx"
  ON "wallet_transactions" ("expires_at");
