-- Phase 3: Enterprise database hardening — non-negative balances + composite indexes.
-- Rollback: see docs/ecosystem-audit/database-hardening-report.md

-- Wallet balance non-negative (paise authoritative)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_wallet_balance_paise_non_negative') THEN
    ALTER TABLE users ADD CONSTRAINT users_wallet_balance_paise_non_negative
      CHECK (wallet_balance_paise >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_wallet_balance_paise_non_negative') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_wallet_balance_paise_non_negative
      CHECK (wallet_balance_paise >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_reserved_balance_paise_non_negative') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_reserved_balance_paise_non_negative
      CHECK (reserved_balance_paise >= 0);
  END IF;
END $$;

-- Payment amounts positive when present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_paise_positive') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_amount_paise_positive
      CHECK (amount_paise > 0);
  END IF;
END $$;

-- Rating valid range
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ratings_score_range') THEN
    ALTER TABLE ratings ADD CONSTRAINT ratings_score_range
      CHECK (rating >= 1 AND rating <= 5);
  END IF;
END $$;

-- Composite indexes for hot paths (idempotent)
CREATE INDEX IF NOT EXISTS idx_bookings_provider_scheduled
  ON bookings (provider_id, scheduled_date DESC)
  WHERE provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_user_scheduled
  ON bookings (user_id, scheduled_date DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_status_created
  ON bookings (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_user_status_created
  ON payments (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_wallet_balance_paise_positive
  ON users (wallet_balance_paise)
  WHERE wallet_balance_paise > 0;
