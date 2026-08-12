-- Phase A: BIGINT paise dual-write columns for authoritative money storage

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0;

-- Backfill from existing float balances (rounded to paise)
UPDATE "users"
SET "wallet_balance_paise" = ROUND(COALESCE("wallet_balance", 0) * 100)::BIGINT
WHERE "wallet_balance_paise" = 0 AND COALESCE("wallet_balance", 0) <> 0;

UPDATE "providers"
SET "wallet_balance_paise" = ROUND(COALESCE("wallet_balance", 0) * 100)::BIGINT
WHERE "wallet_balance_paise" = 0 AND COALESCE("wallet_balance", 0) <> 0;
