-- Service domain: identity/lifecycle columns, immutable config versions, booking snapshots.
-- Hand-scoped and additive. No existing column, trigger, constraint, index, or sequence is dropped.
--
-- Variants and add-ons remain in services.catalog_config (already the pricing source of truth).
-- Extracting them to sibling tables would duplicate resolveSelection. Queryable identity and
-- lifecycle live here; flexible content stays in the validated JSON document.

CREATE TYPE "ServiceLifecycleStatus" AS ENUM (
  'DRAFT',
  'CONFIGURATION_REQUIRED',
  'READY_FOR_REVIEW',
  'PUBLISHED',
  'ACTIVE',
  'PAUSED',
  'DEPRECATED',
  'ARCHIVED'
);

CREATE TYPE "ServiceConfigStatus" AS ENUM (
  'READY',
  'CONFIGURATION_REQUIRED',
  'COMING_SOON',
  'PAUSED',
  'ARCHIVED',
  'INTERNAL'
);

CREATE TYPE "ServiceCapabilityProfile" AS ENUM (
  'GENERAL',
  'HOME_HELP',
  'CLEANING',
  'REPAIR',
  'APPLIANCE',
  'BEAUTY',
  'SENIOR_CARE',
  'PET_CARE',
  'CONCIERGE',
  'VEHICLE'
);

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "service_code" TEXT,
  ADD COLUMN IF NOT EXISTS "display_name" TEXT,
  ADD COLUMN IF NOT EXISTS "capability_profile" "ServiceCapabilityProfile" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS "lifecycle_status" "ServiceLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "config_status" "ServiceConfigStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS "is_customer_visible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "is_bookable" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "owner_team" TEXT,
  ADD COLUMN IF NOT EXISTS "operations_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "last_reviewed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "published_by" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by" TEXT;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "service_config_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "service_config_snapshot" JSONB;

CREATE TABLE IF NOT EXISTS "service_config_versions" (
  "id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "catalog_config" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "published_at" TIMESTAMPTZ,
  CONSTRAINT "service_config_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_config_versions_version_positive" CHECK ("version" > 0),
  CONSTRAINT "service_config_versions_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "service_config_versions_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_config_versions_service_id_version_key"
  ON "service_config_versions" ("service_id", "version");

CREATE INDEX IF NOT EXISTS "service_config_versions_service_id_status_idx"
  ON "service_config_versions" ("service_id", "status");

-- Backfill identity from existing unique slugs. Do not invent names or prices.
UPDATE "services"
SET "service_code" = "slug"
WHERE "service_code" IS NULL;

UPDATE "services"
SET "display_name" = "name"
WHERE "display_name" IS NULL;

UPDATE "services"
SET "capability_profile" = CASE "category"
  WHEN 'cleaning' THEN 'CLEANING'::"ServiceCapabilityProfile"
  WHEN 'beauty' THEN 'BEAUTY'::"ServiceCapabilityProfile"
  WHEN 'repair' THEN 'REPAIR'::"ServiceCapabilityProfile"
  ELSE 'GENERAL'::"ServiceCapabilityProfile"
END;

UPDATE "services"
SET
  "lifecycle_status" = CASE WHEN "is_active" THEN 'ACTIVE'::"ServiceLifecycleStatus" ELSE 'PAUSED'::"ServiceLifecycleStatus" END,
  "is_customer_visible" = "is_active",
  "is_bookable" = "is_active";

-- Coming-soon SKUs stay visible but must not accept bookings.
UPDATE "services"
SET
  "is_bookable" = FALSE,
  "lifecycle_status" = 'PUBLISHED'::"ServiceLifecycleStatus",
  "config_status" = 'COMING_SOON'::"ServiceConfigStatus"
WHERE COALESCE("catalog_config"->>'comingSoon', 'false') = 'true';

UPDATE "services"
SET "config_status" = 'PAUSED'::"ServiceConfigStatus"
WHERE NOT "is_active";

CREATE UNIQUE INDEX IF NOT EXISTS "services_service_code_key" ON "services" ("service_code");
CREATE INDEX IF NOT EXISTS "services_lifecycle_status_idx" ON "services" ("lifecycle_status");
CREATE INDEX IF NOT EXISTS "services_is_bookable_idx" ON "services" ("is_bookable");
CREATE INDEX IF NOT EXISTS "services_is_customer_visible_idx" ON "services" ("is_customer_visible");
CREATE INDEX IF NOT EXISTS "services_capability_profile_idx" ON "services" ("capability_profile");
