-- Services Phase 2: admin-managed catalogue configuration + priced selection snapshot.
-- Hand-scoped (see memory: generated diffs drop the booking slot-exclusion columns).
-- Both columns are nullable JSONB; no existing row or constraint is touched.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "catalog_config" JSONB;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "service_selection" JSONB;
