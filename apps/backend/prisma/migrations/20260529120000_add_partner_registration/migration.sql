-- CreateEnum
CREATE TYPE "PartnerRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "registration_status" "PartnerRegistrationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "partner_approved_at" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "experience_years" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "pan_number" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "aadhar_number" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "admin_approved_by" TEXT;

-- AlterTable provider_documents
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "document_name" TEXT;
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "file_size" INTEGER;
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "file_format" TEXT;
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "upload_status" TEXT NOT NULL DEFAULT 'uploaded';
ALTER TABLE "provider_documents" ADD COLUMN IF NOT EXISTS "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_documents" ALTER COLUMN "document_number" SET DEFAULT '';

-- CreateTable
CREATE TABLE IF NOT EXISTS "partner_background_checks" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approval_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_background_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "email_type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'logged',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_background_checks_provider_id_key" ON "partner_background_checks"("provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_pan_number_key" ON "providers"("pan_number");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_aadhar_number_key" ON "providers"("aadhar_number");
CREATE INDEX IF NOT EXISTS "providers_registration_status_idx" ON "providers"("registration_status");
CREATE INDEX IF NOT EXISTS "email_logs_email_type_idx" ON "email_logs"("email_type");
CREATE INDEX IF NOT EXISTS "email_logs_created_at_idx" ON "email_logs"("created_at");
CREATE INDEX IF NOT EXISTS "partner_background_checks_provider_id_idx" ON "partner_background_checks"("provider_id");
CREATE INDEX IF NOT EXISTS "partner_background_checks_status_idx" ON "partner_background_checks"("status");

ALTER TABLE "partner_background_checks" ADD CONSTRAINT "partner_background_checks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
