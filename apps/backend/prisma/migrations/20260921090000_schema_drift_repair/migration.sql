-- Schema-drift repair: make a migrations-built database match the running one.
--
-- WHY THIS EXISTS
-- ---------------
-- `prisma migrate status` reports "up to date" against the live database, yet rebuilding from
-- migrations into an empty database produced a DIFFERENT schema. Drift ran in both directions:
--
--   A. A fresh build carried FOUR unique indexes on plaintext PII columns that the live database
--      does not have. `20260527105812_init` created them with `CREATE UNIQUE INDEX`, and the
--      migrations that meant to remove them used
--        ALTER TABLE ... DROP CONSTRAINT IF EXISTS "<name>"
--      In PostgreSQL a bare `CREATE UNIQUE INDEX` produces an INDEX, not a table CONSTRAINT, so
--      `DROP CONSTRAINT` never matches it — and `IF EXISTS` swallows the mismatch silently. The
--      statement could not have worked and could not have reported that it did not work. The same
--      wrong-verb pattern appears in `20260609180000_p4_encryption_audit` (users) and
--      `20260529140000_sensitive_field_lookup_hashes` (providers).
--
--      Leaving them is not cosmetic: these columns are superseded by the `*_hash` lookup columns
--      under PII encryption, and a uniqueness rule on a column the application no longer writes
--      meaningfully is a latent insert failure on a fresh deployment.
--
--   B. A fresh build LACKED fifteen indexes the live database has. These are declared in
--      `schema.prisma` but no migration ever created them — they reached the live database through
--      `prisma db push` (see `20260609130000_baseline_repair_db_push_drift`). Most are
--      foreign-key/query support indexes. One is not: `booking_unique_active_slot` is the guard
--      that stops a customer holding two non-cancelled bookings for the same service at the same
--      scheduled time. A production database built from migrations would have had no such guard.
--
--   C. The live database is MISSING three indexes that `20260610120000_enterprise_db_hardening`
--      creates. That migration is recorded as applied, so it will never run again there; the
--      `IF NOT EXISTS` statements below heal it without touching migration history.
--
-- Every statement is idempotent, so this migration is a no-op for objects that already exist and is
-- safe to apply to the live database and to a fresh one. It is hand-written: `prisma migrate diff`
-- output must NOT be used here, because that diff additionally proposes dropping
-- `bookings.provider_slot_start/end`, `bookings.user_slot_start/end` and
-- `knowledge_chunks.search_vector` — raw-SQL-managed objects that are deliberately absent from the
-- Prisma datamodel and whose loss would remove the booking slot-exclusion constraints outright.

-- ── A. Remove the stale plaintext-PII unique indexes, with the verb that actually works ──────────
--
-- ALLOW_DESTRUCTIVE: These four indexes enforce uniqueness on plaintext `users.email`,
-- `users.phone_number`, `providers.aadhar_number` and `providers.pan_number`. Those columns were
-- superseded by encrypted storage plus `*_hash` lookup columns, and the replacement uniqueness is
-- already in place and is NOT touched here: `users_email_hash_key`, `users_phone_hash_key`
-- (20260609180000_p4_encryption_audit) and `providers_pan_number_hash_key`,
-- `providers_aadhar_number_hash_key` (20260529140000_sensitive_field_lookup_hashes). The running
-- database has not had these four indexes for months and enforces identity through the hash
-- indexes, so this drop removes no rule that is actually in force anywhere — it only stops a fresh
-- deployment from resurrecting one. Nothing is dropped that lacks a live replacement.
DROP INDEX IF EXISTS "users_email_key";
DROP INDEX IF EXISTS "users_phone_number_key";
DROP INDEX IF EXISTS "providers_aadhar_number_key";
DROP INDEX IF EXISTS "providers_pan_number_key";

-- ── B. Create the indexes that only ever existed via `db push` ───────────────────────────────────
-- Foreign-key and query support.
CREATE INDEX IF NOT EXISTS "activity_logs_booking_id_idx" ON "activity_logs"("booking_id");
CREATE INDEX IF NOT EXISTS "bookings_address_id_idx" ON "bookings"("address_id");
CREATE INDEX IF NOT EXISTS "bookings_service_id_idx" ON "bookings"("service_id");
CREATE INDEX IF NOT EXISTS "compliance_request_audits_actor_id_idx" ON "compliance_request_audits"("actor_id");
CREATE INDEX IF NOT EXISTS "coupon_usages_booking_id_idx" ON "coupon_usages"("booking_id");
CREATE INDEX IF NOT EXISTS "earnings_provider_id_created_at_idx" ON "earnings"("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "fraud_alerts_commission_id_idx" ON "fraud_alerts"("commission_id");
CREATE INDEX IF NOT EXISTS "fraud_alerts_referral_transaction_id_idx" ON "fraud_alerts"("referral_transaction_id");
CREATE INDEX IF NOT EXISTS "gift_card_redemption_attempts_gift_card_id_idx" ON "gift_card_redemption_attempts"("gift_card_id");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "otps_user_id_idx" ON "otps"("user_id");
CREATE INDEX IF NOT EXISTS "payment_settlements_settlement_batch_id_idx" ON "payment_settlements"("settlement_batch_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_parent_token_id_idx" ON "refresh_tokens"("parent_token_id");
CREATE INDEX IF NOT EXISTS "support_tickets_booking_id_idx" ON "support_tickets"("booking_id");

-- Declared in `schema.prisma`, never created by any migration, and absent from the live database
-- too. Added here so datamodel and migrations finally agree on them.
CREATE INDEX IF NOT EXISTS "addresses_address_payload_hash_idx" ON "addresses"("address_payload_hash");
CREATE INDEX IF NOT EXISTS "enterprise_audit_log_archives_original_log_id_idx" ON "enterprise_audit_log_archives"("original_log_id");

-- The duplicate-booking guard. A customer may not hold two live bookings for the same service at
-- the same scheduled time; cancelled and rejected rows are excluded so a customer can rebook after
-- cancelling. REJECTED is included in the exclusion list because historical rows carry it, even
-- though no current writer sets it.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_unique_active_slot"
  ON "bookings" ("user_id", "service_id", "scheduled_date")
  WHERE "status" <> ALL (ARRAY[
    'CANCELLED_BY_USER'::"BookingStatus",
    'CANCELLED_BY_PROVIDER'::"BookingStatus",
    'REJECTED'::"BookingStatus"
  ]);

-- ── C. Heal the live database's missing performance indexes ──────────────────────────────────────
-- Column order and the trailing DESC match `20260610120000_enterprise_db_hardening` exactly. A
-- differently-ordered index under the same name would satisfy `IF NOT EXISTS` on a fresh build
-- while giving the live database an index that does not serve the same queries.
CREATE INDEX IF NOT EXISTS "idx_bookings_status_created" ON "bookings"("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_bookings_user_scheduled" ON "bookings"("user_id", "scheduled_date" DESC);
CREATE INDEX IF NOT EXISTS "idx_payments_user_status_created" ON "payments"("user_id", "status", "created_at" DESC);
