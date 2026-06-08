-- DropIndex
DROP INDEX "providers_aadhar_number_key";

-- DropIndex
DROP INDEX "providers_bank_account_number_key";

-- DropIndex
DROP INDEX "providers_pan_number_key";

-- DropIndex
DROP INDEX "providers_tax_id_key";

-- DropIndex
DROP INDEX "providers_upi_id_key";

-- DropIndex
DROP INDEX "users_kyc_document_number_key";

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

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");

-- CreateIndex
CREATE INDEX "location_history_has_arrived_idx" ON "location_history"("has_arrived");

-- CreateIndex
CREATE INDEX "notifications_booking_id_idx" ON "notifications"("booking_id");

-- CreateIndex
CREATE INDEX "partner_background_checks_provider_id_idx" ON "partner_background_checks"("provider_id");

-- CreateIndex
CREATE INDEX "partner_background_checks_status_idx" ON "partner_background_checks"("status");
