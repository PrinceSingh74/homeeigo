-- Sensitive field encryption: blind-index hash columns for uniqueness checks
-- Plaintext unique constraints removed; values stored encrypted at application layer.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_document_number_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_tax_id_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_bank_account_number_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_upi_id_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_pan_number_key";
ALTER TABLE "providers" DROP CONSTRAINT IF EXISTS "providers_aadhar_number_key";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_document_number_hash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_kyc_document_number_hash_key" ON "users"("kyc_document_number_hash");

ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "tax_id_hash" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "bank_account_number_hash" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "upi_id_hash" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "pan_number_hash" TEXT;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "aadhar_number_hash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "providers_tax_id_hash_key" ON "providers"("tax_id_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_bank_account_number_hash_key" ON "providers"("bank_account_number_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_upi_id_hash_key" ON "providers"("upi_id_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_pan_number_hash_key" ON "providers"("pan_number_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "providers_aadhar_number_hash_key" ON "providers"("aadhar_number_hash");
