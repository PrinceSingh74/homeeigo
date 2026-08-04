-- Money migration Phase A+B+C: BIGINT paise columns for ALL financial tables,
-- trigger-enforced dual-write (covers every write path incl. raw SQL),
-- and full historical backfill.

-- ============ Phase 0: subsume excluded 09260000 + wallet_transfers schema orphan ============
-- 09260000 is superseded by this migration but previously supplied wallet_balance_paise.
-- wallet_transfers exists in schema.prisma but had no CREATE migration in the chain.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE TYPE "WalletTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "wallet_transfers" (
  "id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "amount_paise" BIGINT NOT NULL DEFAULT 0,
  "note" TEXT,
  "status" "WalletTransferStatus" NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wallet_transfers_sender_id_idx" ON "wallet_transfers"("sender_id");
CREATE INDEX IF NOT EXISTS "wallet_transfers_recipient_id_idx" ON "wallet_transfers"("recipient_id");
CREATE INDEX IF NOT EXISTS "wallet_transfers_status_idx" ON "wallet_transfers"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transfers_sender_id_fkey') THEN
    ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_sender_id_fkey"
      FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transfers_recipient_id_fkey') THEN
    ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_recipient_id_fkey"
      FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Stage-D schema orphans: present in schema.prisma but never migrated
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verification_expires" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "email_verification_token" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_verification_token_key" ON "users"("email_verification_token");

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "premium_only" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "addons" JSONB;

-- ============ Phase A: paise columns ============

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "base_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxes_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "final_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tip_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refund_amount_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "campaign_discount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "amount_paid_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settled_amount_paise" BIGINT;

ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "wallet_balance_before_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "wallet_balance_after_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "earnings"
  ADD COLUMN IF NOT EXISTS "gross_amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "commission_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_earning_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "withdrawals"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_fee_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_amount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ledger_entries"
  ADD COLUMN IF NOT EXISTS "debit_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "credit_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "wallet_transfers"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "membership_cashbacks"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settled_amount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reserved_balance_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_earnings_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_spent_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_saved_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "refund_requests"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "financial_adjustments"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "chargebacks"
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0;

-- ============ Phase B: trigger-enforced dual write ============
-- Paise is derived from the rupee float at write time; ROUND half-up at 2dp.
-- This covers Prisma writes, raw SQL, and any future code path.

CREATE OR REPLACE FUNCTION money_to_paise(v double precision) RETURNS BIGINT AS $$
  SELECT CASE WHEN v IS NULL THEN NULL ELSE ROUND(v::numeric * 100)::BIGINT END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION sync_bookings_paise() RETURNS trigger AS $$
BEGIN
  NEW.base_amount_paise := COALESCE(money_to_paise(NEW.base_amount), 0);
  NEW.discount_paise := COALESCE(money_to_paise(NEW.discount), 0);
  NEW.taxes_paise := COALESCE(money_to_paise(NEW.taxes), 0);
  NEW.final_amount_paise := COALESCE(money_to_paise(NEW.final_amount), 0);
  NEW.tip_amount_paise := COALESCE(money_to_paise(NEW.tip_amount), 0);
  NEW.total_amount_paise := COALESCE(money_to_paise(NEW.total_amount), 0);
  NEW.refund_amount_paise := money_to_paise(NEW.refund_amount);
  NEW.campaign_discount_paise := COALESCE(money_to_paise(NEW.campaign_discount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_bookings_paise ON "bookings";
CREATE TRIGGER trg_sync_bookings_paise BEFORE INSERT OR UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION sync_bookings_paise();

CREATE OR REPLACE FUNCTION sync_payments_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  NEW.amount_paid_paise := COALESCE(money_to_paise(NEW.amount_paid), 0);
  NEW.refunded_amount_paise := COALESCE(money_to_paise(NEW.refunded_amount), 0);
  NEW.settled_amount_paise := money_to_paise(NEW.settled_amount);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_payments_paise ON "payments";
CREATE TRIGGER trg_sync_payments_paise BEFORE INSERT OR UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION sync_payments_paise();

CREATE OR REPLACE FUNCTION sync_wallet_transactions_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  NEW.wallet_balance_before_paise := COALESCE(money_to_paise(NEW.wallet_balance_before), 0);
  NEW.wallet_balance_after_paise := COALESCE(money_to_paise(NEW.wallet_balance_after), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_wallet_transactions_paise ON "wallet_transactions";
CREATE TRIGGER trg_sync_wallet_transactions_paise BEFORE INSERT OR UPDATE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_transactions_paise();

CREATE OR REPLACE FUNCTION sync_earnings_paise() RETURNS trigger AS $$
BEGIN
  NEW.gross_amount_paise := COALESCE(money_to_paise(NEW.gross_amount), 0);
  NEW.commission_paise := COALESCE(money_to_paise(NEW.commission), 0);
  NEW.net_earning_paise := COALESCE(money_to_paise(NEW.net_earning), 0);
  NEW.tax_paise := COALESCE(money_to_paise(NEW.tax), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_earnings_paise ON "earnings";
CREATE TRIGGER trg_sync_earnings_paise BEFORE INSERT OR UPDATE ON "earnings"
  FOR EACH ROW EXECUTE FUNCTION sync_earnings_paise();

CREATE OR REPLACE FUNCTION sync_withdrawals_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  NEW.processing_fee_paise := COALESCE(money_to_paise(NEW.processing_fee), 0);
  NEW.net_amount_paise := COALESCE(money_to_paise(NEW.net_amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_withdrawals_paise ON "withdrawals";
CREATE TRIGGER trg_sync_withdrawals_paise BEFORE INSERT OR UPDATE ON "withdrawals"
  FOR EACH ROW EXECUTE FUNCTION sync_withdrawals_paise();

CREATE OR REPLACE FUNCTION sync_ledger_entries_paise() RETURNS trigger AS $$
BEGIN
  NEW.debit_paise := COALESCE(money_to_paise(NEW.debit), 0);
  NEW.credit_paise := COALESCE(money_to_paise(NEW.credit), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_ledger_entries_paise ON "ledger_entries";
CREATE TRIGGER trg_sync_ledger_entries_paise BEFORE INSERT OR UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION sync_ledger_entries_paise();

CREATE OR REPLACE FUNCTION sync_wallet_transfers_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_wallet_transfers_paise ON "wallet_transfers";
CREATE TRIGGER trg_sync_wallet_transfers_paise BEFORE INSERT OR UPDATE ON "wallet_transfers"
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_transfers_paise();

CREATE OR REPLACE FUNCTION sync_membership_cashbacks_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  NEW.settled_amount_paise := COALESCE(money_to_paise(NEW.settled_amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_membership_cashbacks_paise ON "membership_cashbacks";
CREATE TRIGGER trg_sync_membership_cashbacks_paise BEFORE INSERT OR UPDATE ON "membership_cashbacks"
  FOR EACH ROW EXECUTE FUNCTION sync_membership_cashbacks_paise();

CREATE OR REPLACE FUNCTION sync_users_money_paise() RETURNS trigger AS $$
BEGIN
  NEW.wallet_balance_paise := COALESCE(money_to_paise(NEW.wallet_balance), 0);
  NEW.total_spent_paise := COALESCE(money_to_paise(NEW.total_spent), 0);
  NEW.total_saved_paise := COALESCE(money_to_paise(NEW.total_saved), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_users_money_paise ON "users";
CREATE TRIGGER trg_sync_users_money_paise BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_users_money_paise();

CREATE OR REPLACE FUNCTION sync_providers_money_paise() RETURNS trigger AS $$
BEGIN
  NEW.wallet_balance_paise := COALESCE(money_to_paise(NEW.wallet_balance), 0);
  NEW.reserved_balance_paise := COALESCE(money_to_paise(NEW.reserved_balance), 0);
  NEW.total_earnings_paise := COALESCE(money_to_paise(NEW.total_earnings), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_providers_money_paise ON "providers";
CREATE TRIGGER trg_sync_providers_money_paise BEFORE INSERT OR UPDATE ON "providers"
  FOR EACH ROW EXECUTE FUNCTION sync_providers_money_paise();

CREATE OR REPLACE FUNCTION sync_refund_requests_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_refund_requests_paise ON "refund_requests";
CREATE TRIGGER trg_sync_refund_requests_paise BEFORE INSERT OR UPDATE ON "refund_requests"
  FOR EACH ROW EXECUTE FUNCTION sync_refund_requests_paise();

CREATE OR REPLACE FUNCTION sync_financial_adjustments_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_financial_adjustments_paise ON "financial_adjustments";
CREATE TRIGGER trg_sync_financial_adjustments_paise BEFORE INSERT OR UPDATE ON "financial_adjustments"
  FOR EACH ROW EXECUTE FUNCTION sync_financial_adjustments_paise();

CREATE OR REPLACE FUNCTION sync_chargebacks_paise() RETURNS trigger AS $$
BEGIN
  NEW.amount_paise := COALESCE(money_to_paise(NEW.amount), 0);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_chargebacks_paise ON "chargebacks";
CREATE TRIGGER trg_sync_chargebacks_paise BEFORE INSERT OR UPDATE ON "chargebacks"
  FOR EACH ROW EXECUTE FUNCTION sync_chargebacks_paise();

-- ============ Phase C: historical backfill ============

UPDATE "bookings" SET
  "base_amount_paise" = COALESCE(money_to_paise("base_amount"), 0),
  "discount_paise" = COALESCE(money_to_paise("discount"), 0),
  "taxes_paise" = COALESCE(money_to_paise("taxes"), 0),
  "final_amount_paise" = COALESCE(money_to_paise("final_amount"), 0),
  "tip_amount_paise" = COALESCE(money_to_paise("tip_amount"), 0),
  "total_amount_paise" = COALESCE(money_to_paise("total_amount"), 0),
  "refund_amount_paise" = money_to_paise("refund_amount"),
  "campaign_discount_paise" = COALESCE(money_to_paise("campaign_discount"), 0);

UPDATE "payments" SET
  "amount_paise" = COALESCE(money_to_paise("amount"), 0),
  "amount_paid_paise" = COALESCE(money_to_paise("amount_paid"), 0),
  "refunded_amount_paise" = COALESCE(money_to_paise("refunded_amount"), 0),
  "settled_amount_paise" = money_to_paise("settled_amount");

UPDATE "wallet_transactions" SET
  "amount_paise" = COALESCE(money_to_paise("amount"), 0),
  "wallet_balance_before_paise" = COALESCE(money_to_paise("wallet_balance_before"), 0),
  "wallet_balance_after_paise" = COALESCE(money_to_paise("wallet_balance_after"), 0);

UPDATE "earnings" SET
  "gross_amount_paise" = COALESCE(money_to_paise("gross_amount"), 0),
  "commission_paise" = COALESCE(money_to_paise("commission"), 0),
  "net_earning_paise" = COALESCE(money_to_paise("net_earning"), 0),
  "tax_paise" = COALESCE(money_to_paise("tax"), 0);

UPDATE "withdrawals" SET
  "amount_paise" = COALESCE(money_to_paise("amount"), 0),
  "processing_fee_paise" = COALESCE(money_to_paise("processing_fee"), 0),
  "net_amount_paise" = COALESCE(money_to_paise("net_amount"), 0);

UPDATE "ledger_entries" SET
  "debit_paise" = COALESCE(money_to_paise("debit"), 0),
  "credit_paise" = COALESCE(money_to_paise("credit"), 0);

UPDATE "wallet_transfers" SET "amount_paise" = COALESCE(money_to_paise("amount"), 0);

UPDATE "membership_cashbacks" SET
  "amount_paise" = COALESCE(money_to_paise("amount"), 0),
  "settled_amount_paise" = COALESCE(money_to_paise("settled_amount"), 0);

UPDATE "providers" SET
  "wallet_balance_paise" = COALESCE(money_to_paise("wallet_balance"), 0),
  "reserved_balance_paise" = COALESCE(money_to_paise("reserved_balance"), 0),
  "total_earnings_paise" = COALESCE(money_to_paise("total_earnings"), 0);

UPDATE "users" SET
  "wallet_balance_paise" = COALESCE(money_to_paise("wallet_balance"), 0),
  "total_spent_paise" = COALESCE(money_to_paise("total_spent"), 0),
  "total_saved_paise" = COALESCE(money_to_paise("total_saved"), 0);

UPDATE "refund_requests" SET "amount_paise" = COALESCE(money_to_paise("amount"), 0);
UPDATE "financial_adjustments" SET "amount_paise" = COALESCE(money_to_paise("amount"), 0);
UPDATE "chargebacks" SET "amount_paise" = COALESCE(money_to_paise("amount"), 0);
