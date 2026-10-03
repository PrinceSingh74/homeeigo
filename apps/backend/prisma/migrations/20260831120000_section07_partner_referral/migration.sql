-- Section 07: Partner referral network.
-- Distinct from customer referral_transactions. Does not alter PartnerLead FSM,
-- PartnerLifecycleState, BookingStatus, wallet mutation paths, or risk governance.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralStatus') THEN
    CREATE TYPE "PartnerReferralStatus" AS ENUM (
      'INVITED', 'REGISTERED', 'VERIFIED', 'TRAINING', 'ACTIVE',
      'FIRST_JOB', 'QUALIFIED', 'REWARD_RELEASED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralSource') THEN
    CREATE TYPE "PartnerReferralSource" AS ENUM (
      'PARTNER_REFERRAL', 'CUSTOMER_REFERRAL', 'CAMPAIGN', 'DIRECT'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralQualStatus') THEN
    CREATE TYPE "PartnerReferralQualStatus" AS ENUM (
      'PENDING', 'ELIGIBLE', 'BLOCKED', 'QUALIFIED', 'REWARDED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralReviewStatus') THEN
    CREATE TYPE "PartnerReferralReviewStatus" AS ENUM (
      'NONE', 'OPEN', 'APPROVED', 'BLOCKED', 'HELD'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralSignalKind') THEN
    CREATE TYPE "PartnerReferralSignalKind" AS ENUM (
      'PHONE_REUSE', 'DEVICE_REUSE', 'BANK_REUSE', 'IDENTITY_REUSE',
      'SUSPICIOUS_IP', 'PATTERN_ABUSE', 'SELF_REFERRAL', 'CYCLE_ABUSE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartnerReferralRewardStatus') THEN
    CREATE TYPE "PartnerReferralRewardStatus" AS ENUM (
      'PENDING', 'CREDITED', 'HELD', 'BLOCKED'
    );
  END IF;
END $$;

ALTER TYPE "JournalEntryType" ADD VALUE IF NOT EXISTS 'PARTNER_REFERRAL_REWARD';

CREATE TABLE IF NOT EXISTS "partner_referrals" (
  "id" TEXT NOT NULL,
  "referrer_provider_id" TEXT NOT NULL,
  "referred_lead_id" TEXT,
  "referred_provider_id" TEXT,
  "referral_code" TEXT NOT NULL,
  "status" "PartnerReferralStatus" NOT NULL DEFAULT 'INVITED',
  "source" "PartnerReferralSource" NOT NULL DEFAULT 'PARTNER_REFERRAL',
  "campaign" TEXT,
  "qualification_status" "PartnerReferralQualStatus" NOT NULL DEFAULT 'PENDING',
  "review_status" "PartnerReferralReviewStatus" NOT NULL DEFAULT 'NONE',
  "successful_jobs" INTEGER NOT NULL DEFAULT 0,
  "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registered_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "training_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "first_job_at" TIMESTAMP(3),
  "qualified_at" TIMESTAMP(3),
  "rewarded_at" TIMESTAMP(3),
  "blocked_reason" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_referrals_referred_lead_id_key" ON "partner_referrals"("referred_lead_id");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referrals_referred_provider_id_key" ON "partner_referrals"("referred_provider_id");
CREATE INDEX IF NOT EXISTS "partner_referrals_referrer_provider_id_status_idx" ON "partner_referrals"("referrer_provider_id", "status");
CREATE INDEX IF NOT EXISTS "partner_referrals_referral_code_idx" ON "partner_referrals"("referral_code");
CREATE INDEX IF NOT EXISTS "partner_referrals_status_idx" ON "partner_referrals"("status");
CREATE INDEX IF NOT EXISTS "partner_referrals_qualification_status_idx" ON "partner_referrals"("qualification_status");
CREATE INDEX IF NOT EXISTS "partner_referrals_review_status_idx" ON "partner_referrals"("review_status");
CREATE INDEX IF NOT EXISTS "partner_referrals_created_at_idx" ON "partner_referrals"("created_at");

CREATE TABLE IF NOT EXISTS "partner_referral_codes" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "is_revoked" BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "partner_referral_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_codes_provider_id_key" ON "partner_referral_codes"("provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_codes_code_key" ON "partner_referral_codes"("code");
CREATE INDEX IF NOT EXISTS "partner_referral_codes_code_idx" ON "partner_referral_codes"("code");

CREATE TABLE IF NOT EXISTS "partner_referral_rewards" (
  "id" TEXT NOT NULL,
  "referral_id" TEXT NOT NULL,
  "referrer_provider_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" "PartnerReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
  "wallet_txn_id" TEXT,
  "ledger_journal_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "released_by" TEXT,
  "release_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "credited_at" TIMESTAMP(3),
  CONSTRAINT "partner_referral_rewards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_rewards_referral_id_key" ON "partner_referral_rewards"("referral_id");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_rewards_wallet_txn_id_key" ON "partner_referral_rewards"("wallet_txn_id");
CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_rewards_idempotency_key_key" ON "partner_referral_rewards"("idempotency_key");
CREATE INDEX IF NOT EXISTS "partner_referral_rewards_referrer_provider_id_idx" ON "partner_referral_rewards"("referrer_provider_id");
CREATE INDEX IF NOT EXISTS "partner_referral_rewards_status_idx" ON "partner_referral_rewards"("status");

CREATE TABLE IF NOT EXISTS "partner_referral_status_history" (
  "id" TEXT NOT NULL,
  "referral_id" TEXT NOT NULL,
  "from_status" "PartnerReferralStatus",
  "to_status" "PartnerReferralStatus" NOT NULL,
  "actor_type" TEXT NOT NULL DEFAULT 'system',
  "actor_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_referral_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "partner_referral_status_history_referral_id_created_at_idx"
  ON "partner_referral_status_history"("referral_id", "created_at");

CREATE TABLE IF NOT EXISTS "partner_referral_abuse_signals" (
  "id" TEXT NOT NULL,
  "referral_id" TEXT NOT NULL,
  "kind" "PartnerReferralSignalKind" NOT NULL,
  "severity" INTEGER NOT NULL,
  "evidence_key" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_referral_abuse_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_referral_abuse_signals_referral_id_kind_evidence_key_key"
  ON "partner_referral_abuse_signals"("referral_id", "kind", "evidence_key");
CREATE INDEX IF NOT EXISTS "partner_referral_abuse_signals_referral_id_idx" ON "partner_referral_abuse_signals"("referral_id");
CREATE INDEX IF NOT EXISTS "partner_referral_abuse_signals_kind_created_at_idx" ON "partner_referral_abuse_signals"("kind", "created_at");

DO $$ BEGIN
  ALTER TABLE "partner_referrals"
    ADD CONSTRAINT "partner_referrals_referrer_provider_id_fkey"
    FOREIGN KEY ("referrer_provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referrals"
    ADD CONSTRAINT "partner_referrals_referred_provider_id_fkey"
    FOREIGN KEY ("referred_provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referrals"
    ADD CONSTRAINT "partner_referrals_referred_lead_id_fkey"
    FOREIGN KEY ("referred_lead_id") REFERENCES "partner_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referral_codes"
    ADD CONSTRAINT "partner_referral_codes_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referral_rewards"
    ADD CONSTRAINT "partner_referral_rewards_referral_id_fkey"
    FOREIGN KEY ("referral_id") REFERENCES "partner_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referral_rewards"
    ADD CONSTRAINT "partner_referral_rewards_referrer_provider_id_fkey"
    FOREIGN KEY ("referrer_provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referral_status_history"
    ADD CONSTRAINT "partner_referral_status_history_referral_id_fkey"
    FOREIGN KEY ("referral_id") REFERENCES "partner_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "partner_referral_abuse_signals"
    ADD CONSTRAINT "partner_referral_abuse_signals_referral_id_fkey"
    FOREIGN KEY ("referral_id") REFERENCES "partner_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
