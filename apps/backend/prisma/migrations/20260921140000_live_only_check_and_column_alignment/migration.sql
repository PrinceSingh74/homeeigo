-- Migration authority, second sweep.
--
-- WHY THIS EXISTS
-- ---------------
-- After 20260921090000_schema_drift_repair was applied, a catalog-level diff between a database
-- built ONLY from `prisma/migrations` and the running database (scripts/diff-schema-catalogs.ts)
-- still reported differences that no migration explains. The earlier repair compared a named list
-- of protected objects; the catalog diff compares everything, and found four more. Each is closed
-- here. Every statement is idempotent, so the file is a no-op wherever the object already has the
-- right shape, and is safe on the live database and on an empty one.
--
--   1. `booking_completed_requires_timestamp` existed ONLY on the live database. It is the CHECK
--      that a COMPLETED booking carries a completion time — the invariant that earnings, payout and
--      settlement code read `completed_at` under. It was added by hand during the August
--      certification (docs/enterprise/homigo-enterprise-elite-certification.md) and never written
--      as a migration, so a production database built from migrations would not have had it. Two
--      test fixtures even describe it as "present in every database"; the test database they run
--      in did not have it either. Live has 0 violating rows.
--
--   2. `users_phone_number_idx`: 20260527105812_init creates it, the live database no longer has
--      it, and schema.prisma declares no index on the plaintext column — lookups go through
--      `phone_hash`, and the unique `users_phone_number_key` was retired for the same reason in
--      20260921090000. The rebuild is the side out of line with the datamodel, so the index is
--      dropped rather than recreated. (`user-pii.service` still falls back to a plaintext
--      `phone_number` equality for the 180 users whose hash was never backfilled; on live that has
--      been a sequential scan for as long as the index has been absent, and at 882 users it does
--      not register. The backfill is the fix for that, not an index on a column being retired.)
--
--   3. `geofences.service_categories` was created NULLABLE, but schema.prisma declares
--      `String[] @default([])` — a Prisma list is never null — and the live column is already
--      NOT NULL with 0 NULL rows. Aligned to the datamodel.
--
--   4. Column defaults that only one side had. `automation_shadow_executions.intended_fallback`
--      has its migration's DEFAULT on a rebuild and none on live; `city_coverage_overrides.updated_at`
--      and `geofences.updated_at` have a DEFAULT on live that no migration defines. Prisma supplies
--      all three values on every write, so none of this changes behaviour. The default is ADDED on
--      the side lacking it: additive, cannot break an insert, and both catalogs converge.
--
-- Hand-written. `prisma migrate diff` output must NOT be used here — see 20260921090000 for the
-- destructive statements it proposes against this repository.

-- ── 1. The completed-booking CHECK, now owned by migrations ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_completed_requires_timestamp') THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "booking_completed_requires_timestamp"
      CHECK ((status)::text <> 'COMPLETED' OR completed_at IS NOT NULL);
  END IF;
END $$;

-- ── 2. Plaintext-phone index: absent on live, absent from the datamodel ─────────────────────────
DROP INDEX IF EXISTS "users_phone_number_idx";

-- ── 3. geofences.service_categories: NOT NULL, as the datamodel declares ────────────────────────
UPDATE "geofences" SET "service_categories" = ARRAY[]::TEXT[] WHERE "service_categories" IS NULL;
ALTER TABLE "geofences" ALTER COLUMN "service_categories" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "geofences" ALTER COLUMN "service_categories" SET NOT NULL;

-- ── 4. Defaults present on only one side ────────────────────────────────────────────────────────
ALTER TABLE "automation_shadow_executions" ALTER COLUMN "intended_fallback" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "city_coverage_overrides" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "geofences" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
