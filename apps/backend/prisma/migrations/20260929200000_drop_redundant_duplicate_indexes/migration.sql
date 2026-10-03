-- Drop 14 plain btree indexes that duplicate a UNIQUE btree index on exactly the same column.
--
-- Each pair came from a Prisma model that declared the field `@unique` AND `@@index([field])`
-- (migrations 20260527105812_init, 20260529120000, 20260608240000, 20260609120000, 20260609180000,
-- 20260807120000, 20260831120000, 20260921090000). The unique index already answers every lookup,
-- range scan and ORDER BY the plain one can: same single column, same operator class, same
-- collation, same sort options, no predicate, no INCLUDE; btree unique indexes also store NULLs, so
-- `IS NULL` lookups on the nullable columns (financial_holds.*, users.*_hash, users.referral_code)
-- are served too. Verified on homigo_db 2026-09-29: no pg_depend entry references any of the 14,
-- no constraint uses them (pg_constraint.conindid), idx_scan = 0 on all 14. The unique indexes,
-- every constraint, trigger and exclusion constraint are untouched.
--
-- Not CONCURRENTLY: Prisma applies a migration file as one multi-statement script, and
-- DROP INDEX CONCURRENTLY cannot run inside a transaction block. The largest of these indexes is
-- 120 KB, so the ACCESS EXCLUSIVE lock is held for milliseconds.
--
-- Rollback (recreates exactly what is dropped here):
--   CREATE INDEX "admin_roles_name_idx" ON "admin_roles"("name");
--   CREATE INDEX "bookings_booking_number_idx" ON "bookings"("booking_number");
--   CREATE INDEX "enterprise_audit_log_archives_original_log_id_idx" ON "enterprise_audit_log_archives"("original_log_id");
--   CREATE INDEX "financial_holds_provider_id_idx" ON "financial_holds"("provider_id");
--   CREATE INDEX "financial_holds_user_id_idx" ON "financial_holds"("user_id");
--   CREATE INDEX "ml_feature_staging_event_id_idx" ON "ml_feature_staging"("event_id");
--   CREATE INDEX "partner_background_checks_provider_id_idx" ON "partner_background_checks"("provider_id");
--   CREATE INDEX "partner_referral_codes_code_idx" ON "partner_referral_codes"("code");
--   CREATE INDEX "payments_razorpay_order_id_idx" ON "payments"("razorpay_order_id");
--   CREATE INDEX "services_slug_idx" ON "services"("slug");
--   CREATE INDEX "support_tickets_ticket_number_idx" ON "support_tickets"("ticket_number");
--   CREATE INDEX "users_email_hash_idx" ON "users"("email_hash");
--   CREATE INDEX "users_phone_hash_idx" ON "users"("phone_hash");
--   CREATE INDEX "users_referral_code_idx" ON "users"("referral_code");

DROP INDEX IF EXISTS "admin_roles_name_idx";
DROP INDEX IF EXISTS "bookings_booking_number_idx";
DROP INDEX IF EXISTS "enterprise_audit_log_archives_original_log_id_idx";
DROP INDEX IF EXISTS "financial_holds_provider_id_idx";
DROP INDEX IF EXISTS "financial_holds_user_id_idx";
DROP INDEX IF EXISTS "ml_feature_staging_event_id_idx";
DROP INDEX IF EXISTS "partner_background_checks_provider_id_idx";
DROP INDEX IF EXISTS "partner_referral_codes_code_idx";
DROP INDEX IF EXISTS "payments_razorpay_order_id_idx";
DROP INDEX IF EXISTS "services_slug_idx";
DROP INDEX IF EXISTS "support_tickets_ticket_number_idx";
DROP INDEX IF EXISTS "users_email_hash_idx";
DROP INDEX IF EXISTS "users_phone_hash_idx";
DROP INDEX IF EXISTS "users_referral_code_idx";
