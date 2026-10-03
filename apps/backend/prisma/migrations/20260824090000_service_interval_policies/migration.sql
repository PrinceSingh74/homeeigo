-- Maintenance intelligence needs an interval, and no interval can be derived from this platform's
-- data: 125 completed bookings across 71 days, 61% of repeat gaps under a day, and a quarterly or
-- annual cycle is not observable in a window shorter than two of them. So the interval is a business
-- assertion, and this table is where a named admin makes it.
--
-- No rows are inserted here. A migration that seeded "AC Service every 180 days" would be the code
-- inventing the business rule, which is the one thing this table exists to prevent.

CREATE TYPE "ServiceIntervalUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');
CREATE TYPE "ServiceIntervalSource" AS ENUM ('MANUFACTURER', 'OPERATOR', 'REGULATORY', 'VENDOR_GUIDANCE');
CREATE TYPE "ServiceIntervalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

CREATE TABLE "service_interval_policies" (
    "id"             TEXT NOT NULL,
    "service_id"     TEXT NOT NULL,
    "interval_unit"  "ServiceIntervalUnit" NOT NULL,
    "interval_value" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to"   TIMESTAMP(3),
    "source"         "ServiceIntervalSource" NOT NULL,
    "source_note"    TEXT,
    "status"         "ServiceIntervalStatus" NOT NULL DEFAULT 'DRAFT',
    "version"        INTEGER NOT NULL DEFAULT 1,
    "created_by"     TEXT NOT NULL,
    "updated_by"     TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_interval_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_interval_policies_service_id_version_key"
  ON "service_interval_policies"("service_id", "version");
CREATE INDEX "service_interval_policies_service_id_status_idx"
  ON "service_interval_policies"("service_id", "status");
CREATE INDEX "service_interval_policies_status_effective_from_idx"
  ON "service_interval_policies"("status", "effective_from");

ALTER TABLE "service_interval_policies"
  ADD CONSTRAINT "service_interval_policies_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An interval of zero or a negative count is not a slow cadence, it is a bug that would make every
-- service permanently due.
ALTER TABLE "service_interval_policies"
  ADD CONSTRAINT "service_interval_policies_positive_interval" CHECK ("interval_value" > 0);

-- A window that closes before it opens can never be active, and silently storing one hides the typo.
ALTER TABLE "service_interval_policies"
  ADD CONSTRAINT "service_interval_policies_window_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
