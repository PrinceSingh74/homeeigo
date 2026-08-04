-- Address PII encryption columns (Phase 1b). Rollback: drop columns; restore from backup.

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_line1_encrypted TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_line2_encrypted TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS full_address_encrypted TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS landmark_encrypted TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS special_instructions_encrypted TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address_payload_hash TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS encryption_key_version INTEGER;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS data_encryption_status "data_encryption_status" NOT NULL DEFAULT 'PARTIAL';

-- Allow plaintext columns to be nulled after encryption
ALTER TABLE addresses ALTER COLUMN address_line1 DROP NOT NULL;
ALTER TABLE addresses ALTER COLUMN full_address DROP NOT NULL;
ALTER TABLE addresses ALTER COLUMN full_address DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_addresses_payload_hash ON addresses(address_payload_hash) WHERE address_payload_hash IS NOT NULL;
