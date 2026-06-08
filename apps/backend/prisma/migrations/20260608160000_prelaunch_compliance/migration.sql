-- Pre-launch compliance, settlements, chargebacks

CREATE TYPE "ConsentPolicyType" AS ENUM ('TERMS', 'PRIVACY', 'COOKIES', 'REFUND');
CREATE TYPE "ConsentSource" AS ENUM ('SIGNUP', 'COOKIE_BANNER', 'SETTINGS', 'API');
CREATE TYPE "ChargebackStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletion_scheduled_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "policy_versions" (
    "id" TEXT NOT NULL,
    "policy_type" "ConsentPolicyType" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "policy_versions_policy_type_version_key" ON "policy_versions"("policy_type", "version");
CREATE INDEX IF NOT EXISTS "policy_versions_policy_type_is_current_idx" ON "policy_versions"("policy_type", "is_current");

CREATE TABLE IF NOT EXISTS "consent_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "policy_type" "ConsentPolicyType" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "consent_records_user_id_idx" ON "consent_records"("user_id");
CREATE INDEX IF NOT EXISTS "consent_records_policy_type_idx" ON "consent_records"("policy_type");
CREATE INDEX IF NOT EXISTS "consent_records_created_at_idx" ON "consent_records"("created_at");

ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "chargebacks" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "razorpay_dispute_id" TEXT,
    "razorpay_payment_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "ChargebackStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" TEXT,
    "metadata" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chargebacks_razorpay_dispute_id_key" ON "chargebacks"("razorpay_dispute_id");
CREATE INDEX IF NOT EXISTS "chargebacks_payment_id_idx" ON "chargebacks"("payment_id");
CREATE INDEX IF NOT EXISTS "chargebacks_status_idx" ON "chargebacks"("status");
CREATE INDEX IF NOT EXISTS "chargebacks_received_at_idx" ON "chargebacks"("received_at");

CREATE TABLE IF NOT EXISTS "settlement_batches" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "settled_at" TIMESTAMP(3),
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "settlement_batches_settlement_id_key" ON "settlement_batches"("settlement_id");
CREATE INDEX IF NOT EXISTS "settlement_batches_status_idx" ON "settlement_batches"("status");
CREATE INDEX IF NOT EXISTS "settlement_batches_settled_at_idx" ON "settlement_batches"("settled_at");
