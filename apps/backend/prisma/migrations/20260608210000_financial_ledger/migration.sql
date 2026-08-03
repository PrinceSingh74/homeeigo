-- Enterprise double-entry ledger (Finance Phase 2)

CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "JournalEntryType" AS ENUM (
  'BOOKING_PAYMENT', 'REFUND', 'PROVIDER_EARNING', 'PROVIDER_PAYOUT',
  'CHARGEBACK', 'WALLET_TOPUP', 'WALLET_DEBIT', 'CASHBACK', 'GIFT_CARD',
  'SUBSCRIPTION', 'ADJUSTMENT'
);

CREATE TABLE IF NOT EXISTS "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" TEXT NOT NULL,
    "entry_number" TEXT NOT NULL,
    "type" "JournalEntryType" NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "description" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_code_key" ON "ledger_accounts"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_entry_number_key" ON "journal_entries"("entry_number");
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");
CREATE INDEX IF NOT EXISTS "journal_entries_type_idx" ON "journal_entries"("type");
CREATE INDEX IF NOT EXISTS "journal_entries_reference_id_idx" ON "journal_entries"("reference_id");
CREATE INDEX IF NOT EXISTS "journal_entries_created_at_idx" ON "journal_entries"("created_at");
CREATE INDEX IF NOT EXISTS "ledger_entries_journal_id_idx" ON "ledger_entries"("journal_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_created_at_idx" ON "ledger_entries"("created_at");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed standard chart of accounts
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "currency", "created_at")
VALUES
  ('acct_customer_funds', 'CUSTOMER_FUNDS', 'Customer Funds (Clearing)', 'ASSET', 'INR', CURRENT_TIMESTAMP),
  ('acct_platform_escrow', 'PLATFORM_ESCROW', 'Platform Escrow', 'LIABILITY', 'INR', CURRENT_TIMESTAMP),
  ('acct_platform_revenue', 'PLATFORM_REVENUE', 'Platform Revenue', 'REVENUE', 'INR', CURRENT_TIMESTAMP),
  ('acct_refund_liability', 'REFUND_LIABILITY', 'Refund Liability', 'LIABILITY', 'INR', CURRENT_TIMESTAMP),
  ('acct_provider_payable', 'PROVIDER_PAYABLE', 'Provider Payable', 'LIABILITY', 'INR', CURRENT_TIMESTAMP),
  ('acct_bank_settlement', 'BANK_SETTLEMENT', 'Bank Settlement', 'ASSET', 'INR', CURRENT_TIMESTAMP),
  ('acct_chargeback_loss', 'CHARGEBACK_LOSS', 'Chargeback Loss', 'EXPENSE', 'INR', CURRENT_TIMESTAMP),
  ('acct_customer_wallet', 'CUSTOMER_WALLET', 'Customer Wallet Liability', 'LIABILITY', 'INR', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- H-Coin foundation (enum/tables required before finance_integrity_10_phase2)
CREATE TYPE "HCoinTxnType" AS ENUM ('EARN', 'REDEEM');

CREATE TABLE "hcoin_wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_earned" INTEGER NOT NULL DEFAULT 0,
    "lifetime_redeemed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hcoin_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hcoin_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "HCoinTxnType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference_id" TEXT,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hcoin_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hcoin_rewards" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hcoin_rewards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hcoin_wallets_user_id_key" ON "hcoin_wallets"("user_id");
CREATE INDEX "hcoin_transactions_user_id_idx" ON "hcoin_transactions"("user_id");
CREATE INDEX "hcoin_transactions_reference_id_idx" ON "hcoin_transactions"("reference_id");
CREATE UNIQUE INDEX "hcoin_rewards_event_key" ON "hcoin_rewards"("event");

ALTER TABLE "hcoin_wallets" ADD CONSTRAINT "hcoin_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hcoin_transactions" ADD CONSTRAINT "hcoin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
