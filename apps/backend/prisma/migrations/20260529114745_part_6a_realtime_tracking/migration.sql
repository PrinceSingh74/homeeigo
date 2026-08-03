-- Drop plaintext unique indexes when present (init-era indexes; aadhar/pan may not exist yet).
-- IF EXISTS preserves idempotent deploy from empty DB before add_partner_registration runs.
DROP INDEX IF EXISTS "providers_aadhar_number_key";
DROP INDEX IF EXISTS "providers_bank_account_number_key";
DROP INDEX IF EXISTS "providers_pan_number_key";
DROP INDEX IF EXISTS "providers_tax_id_key";
DROP INDEX IF EXISTS "providers_upi_id_key";
DROP INDEX IF EXISTS "users_kyc_document_number_key";

-- AlterTable
ALTER TABLE "location_history" ADD COLUMN     "bearing" DOUBLE PRECISION,
ADD COLUMN     "distance_km" DOUBLE PRECISION,
ADD COLUMN     "eta_minutes" INTEGER,
ADD COLUMN     "has_arrived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "body" TEXT,
ADD COLUMN     "booking_id" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "metadata" TEXT,
ADD COLUMN     "sound" TEXT;

-- Indexes on tables that exist at this migration boundary (init).
CREATE INDEX IF NOT EXISTS "location_history_has_arrived_idx" ON "location_history"("has_arrived");
CREATE INDEX IF NOT EXISTS "notifications_booking_id_idx" ON "notifications"("booking_id");

-- email_logs / partner_background_checks indexes are created in 20260529120000_add_partner_registration
-- after those tables are created.
