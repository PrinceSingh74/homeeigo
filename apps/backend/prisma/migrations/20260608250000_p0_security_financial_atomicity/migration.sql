-- P0 Security & Financial Atomicity

-- PaymentStatus: add REFUNDING
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDING';

-- WithdrawalStatus: add REVERSED
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

-- RefundRequestStatus: add REFUNDING
ALTER TYPE "RefundRequestStatus" ADD VALUE IF NOT EXISTS 'REFUNDING';

-- Partner registration session
CREATE TYPE "PartnerRegistrationSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');
CREATE TYPE "WalletReservationStatus" AS ENUM ('RESERVED', 'RELEASED', 'CONSUMED');

CREATE TABLE "partner_registration_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT,
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "PartnerRegistrationSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_registration_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_registration_sessions_user_id_key" ON "partner_registration_sessions"("user_id");
CREATE INDEX "partner_registration_sessions_provider_id_idx" ON "partner_registration_sessions"("provider_id");
CREATE INDEX "partner_registration_sessions_expires_at_idx" ON "partner_registration_sessions"("expires_at");
CREATE INDEX "partner_registration_sessions_status_idx" ON "partner_registration_sessions"("status");

ALTER TABLE "partner_registration_sessions" ADD CONSTRAINT "partner_registration_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Provider wallet reservation
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "reserved_balance" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "provider_wallet_reservations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "withdrawal_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "WalletReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    CONSTRAINT "provider_wallet_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_wallet_reservations_withdrawal_id_key" ON "provider_wallet_reservations"("withdrawal_id");
CREATE INDEX "provider_wallet_reservations_provider_id_idx" ON "provider_wallet_reservations"("provider_id");
CREATE INDEX "provider_wallet_reservations_status_idx" ON "provider_wallet_reservations"("status");

ALTER TABLE "provider_wallet_reservations" ADD CONSTRAINT "provider_wallet_reservations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Refund request idempotency
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "gateway_refund_id" TEXT;

UPDATE "refund_requests" SET "idempotency_key" = 'legacy:' || "id" WHERE "idempotency_key" IS NULL;

ALTER TABLE "refund_requests" ALTER COLUMN "idempotency_key" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "refund_requests_idempotency_key_key" ON "refund_requests"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "refund_requests_gateway_refund_id_key" ON "refund_requests"("gateway_refund_id");

-- Chargeback evidence hardening
ALTER TABLE "chargeback_evidence" ADD COLUMN IF NOT EXISTS "storage_key" TEXT;
ALTER TABLE "chargeback_evidence" ADD COLUMN IF NOT EXISTS "file_name" TEXT;
ALTER TABLE "chargeback_evidence" ADD COLUMN IF NOT EXISTS "mime_type" TEXT NOT NULL DEFAULT 'application/octet-stream';

UPDATE "chargeback_evidence"
SET "storage_key" = 'legacy:' || "id",
    "file_name" = COALESCE("description", 'evidence.bin')
WHERE "storage_key" IS NULL;

ALTER TABLE "chargeback_evidence" ALTER COLUMN "storage_key" SET NOT NULL;
ALTER TABLE "chargeback_evidence" ALTER COLUMN "file_name" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chargeback_evidence_storage_key_key" ON "chargeback_evidence"("storage_key");

CREATE TABLE "chargeback_evidence_download_tokens" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chargeback_evidence_download_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chargeback_evidence_download_tokens_token_key" ON "chargeback_evidence_download_tokens"("token");
CREATE INDEX "chargeback_evidence_download_tokens_evidence_id_idx" ON "chargeback_evidence_download_tokens"("evidence_id");
CREATE INDEX "chargeback_evidence_download_tokens_expires_at_idx" ON "chargeback_evidence_download_tokens"("expires_at");

ALTER TABLE "chargeback_evidence_download_tokens" ADD CONSTRAINT "chargeback_evidence_download_tokens_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "chargeback_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
