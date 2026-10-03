-- Phase 01 — service identity + taxonomy.
-- Hand-scoped and additive. No existing column, trigger, exclusion constraint, sequence or index is
-- dropped. Every CHECK added here was measured to hold on every row of the live database first
-- (0 violations on 2026-09-21); nothing is invented, taxonomy rows are copied from the customer
-- catalogue definitions the web app already ships (apps/web/src/lib/catalog/taxonomy.ts).
--
-- Identity: services.id (immutable), service_code (stable business code, NOT NULL), slug (public
-- URL), internal_service_code (operational, optional, unique when set). These are distinct fields
-- and none is collapsed into another.
-- Taxonomy: service_categories is the customer taxonomy tree (category -> subcategory);
-- services.category_id / subcategory_id reference it. services.category (operational string used by
-- dispatch/matching) is kept as-is and is mapped to a taxonomy category through
-- service_categories.operational_categories.

------------------------------------------------------------------------------------------------
-- 1. service_categories becomes the taxonomy tree
------------------------------------------------------------------------------------------------
ALTER TABLE "service_categories"
  ADD COLUMN IF NOT EXISTS "short_name" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "operational_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_categories_slug_format') THEN
    ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_slug_format"
      CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]*$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "service_categories_parent_id_sort_order_idx"
  ON "service_categories" ("parent_id", "sort_order");

-- The tree is exactly two levels deep: a subcategory parent must itself be top-level.
CREATE OR REPLACE FUNCTION service_categories_depth_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."parent_id" IS NOT NULL THEN
    IF NEW."parent_id" = NEW."id" THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_SELF_PARENT' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "service_categories" p WHERE p."id" = NEW."parent_id" AND p."parent_id" IS NOT NULL) THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_TOO_DEEP' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "service_categories_depth_guard_trg" ON "service_categories";
CREATE TRIGGER "service_categories_depth_guard_trg"
  BEFORE INSERT OR UPDATE OF "parent_id" ON "service_categories"
  FOR EACH ROW EXECUTE FUNCTION service_categories_depth_guard();

-- Categories (customer taxonomy). Copied from apps/web/src/lib/catalog/taxonomy.ts on 2026-09-21; nothing invented.
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "operational_categories", "created_at", "updated_at") VALUES
  ('sc_home_help', 'home-help', 'Home Help', 'Home Help', 0, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_home_cleaning', 'home-cleaning', 'Home Cleaning', 'Cleaning', 1, TRUE, ARRAY['cleaning']::TEXT[], NOW(), NOW()),
  ('sc_event_occasion', 'event-occasion', 'Event & Occasion', 'Events', 2, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_home_maintenance', 'home-maintenance', 'Home Maintenance', 'Maintenance', 3, TRUE, ARRAY['repair','home']::TEXT[], NOW(), NOW()),
  ('sc_appliance_care', 'appliance-care', 'Appliance & Utility Care', 'Appliances', 4, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_specialized_care', 'specialized-care', 'Specialized Care', 'Specialized', 5, TRUE, ARRAY['apartments']::TEXT[], NOW(), NOW()),
  ('sc_laundry_fabric', 'laundry-fabric', 'Laundry & Fabric Care', 'Laundry', 6, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_vehicle_care', 'vehicle-care', 'Vehicle Care', 'Vehicle', 7, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_beauty', 'beauty', 'Beauty & Grooming', 'Beauty', 8, TRUE, ARRAY['beauty']::TEXT[], NOW(), NOW()),
  ('sc_senior_care', 'senior-care', 'Senior Care', 'Senior Care', 9, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_pet_care', 'pet-care', 'Pet Care', 'Pet Care', 10, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_executive_concierge', 'executive-concierge', 'Executive & Concierge', 'Concierge', 11, TRUE, ARRAY[]::TEXT[], NOW(), NOW()),
  ('sc_special_services', 'special-services', 'Special & Future Services', 'Special', 12, TRUE, ARRAY[]::TEXT[], NOW(), NOW())
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "short_name" = EXCLUDED."short_name",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = TRUE,
  "operational_categories" = EXCLUDED."operational_categories",
  "parent_id" = NULL,
  "updated_at" = NOW();

-- Subcategories (one level below their category).
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_help__hourly', 'hourly', 'Hourly help', 'Hourly help', 0, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-help' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_help__daily', 'daily', 'Daily chores', 'Daily chores', 1, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-help' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_help__clothes', 'clothes', 'Clothes care', 'Clothes care', 2, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-help' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_help__organise', 'organise', 'Organise & move', 'Organise & move', 3, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-help' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_cleaning__rooms', 'rooms', 'Rooms & whole home', 'Rooms & whole home', 0, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-cleaning' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_cleaning__furnishings', 'furnishings', 'Furnishings', 'Furnishings', 1, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-cleaning' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_cleaning__fixtures', 'fixtures', 'Fixtures & appliances', 'Fixtures & appliances', 2, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-cleaning' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_maintenance__repairs', 'repairs', 'Repairs', 'Repairs', 0, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-maintenance' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_maintenance__installs', 'installs', 'Installation & assembly', 'Installation & assembly', 1, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-maintenance' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_home_maintenance__painting', 'painting', 'Painting', 'Painting', 2, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'home-maintenance' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_appliance_care__cooling', 'cooling', 'Air conditioning', 'Air conditioning', 0, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'appliance-care' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_appliance_care__kitchen', 'kitchen', 'Kitchen appliances', 'Kitchen appliances', 1, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'appliance-care' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();
INSERT INTO "service_categories" ("id", "slug", "name", "short_name", "sort_order", "is_active", "parent_id", "created_at", "updated_at")
SELECT 'sc_appliance_care__utility', 'utility', 'Utility & install', 'Utility & install', 2, TRUE, c."id", NOW(), NOW()
FROM "service_categories" c WHERE c."slug" = 'appliance-care' AND c."parent_id" IS NULL
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "sort_order" = EXCLUDED."sort_order", "parent_id" = EXCLUDED."parent_id", "is_active" = TRUE, "updated_at" = NOW();




-- Rows created by 20260920130000 from the distinct operational strings are not customer
-- categories. They stay (no history is deleted) but leave the customer tree.
UPDATE "service_categories" SET "is_active" = FALSE, "updated_at" = NOW()
WHERE "parent_id" IS NULL AND "slug" IN ('cleaning', 'repair', 'home', 'apartments');

------------------------------------------------------------------------------------------------
-- 2. services identity columns, taxonomy references, invariants
------------------------------------------------------------------------------------------------
ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "category_id" TEXT,
  ADD COLUMN IF NOT EXISTS "subcategory_id" TEXT,
  ADD COLUMN IF NOT EXISTS "internal_service_code" TEXT,
  ADD COLUMN IF NOT EXISTS "short_name" TEXT,
  ADD COLUMN IF NOT EXISTS "parent_service_id" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_category_id_fkey') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey"
      FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_subcategory_id_fkey') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_subcategory_id_fkey"
      FOREIGN KEY ("subcategory_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_parent_service_id_fkey') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_parent_service_id_fkey"
      FOREIGN KEY ("parent_service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "services_category_id_idx" ON "services" ("category_id");
CREATE INDEX IF NOT EXISTS "services_subcategory_id_idx" ON "services" ("subcategory_id");
CREATE INDEX IF NOT EXISTS "services_parent_service_id_idx" ON "services" ("parent_service_id");
CREATE UNIQUE INDEX IF NOT EXISTS "services_internal_service_code_key" ON "services" ("internal_service_code");

-- service_code was backfilled from slug by 20260920120000 on migrated databases; databases built
-- by db push never ran that backfill, so it is repeated here before the column becomes NOT NULL.
UPDATE "services" SET "service_code" = "slug" WHERE "service_code" IS NULL;
ALTER TABLE "services" ALTER COLUMN "service_code" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_slug_format') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_slug_format" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_service_code_format') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_service_code_format" CHECK ("service_code" ~ '^[a-z0-9][a-z0-9-]*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_internal_service_code_format') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_internal_service_code_format"
      CHECK ("internal_service_code" IS NULL OR "internal_service_code" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_base_price_nonneg') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_base_price_nonneg" CHECK ("base_price" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_price_range') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_price_range"
      CHECK (("min_price" IS NULL OR "min_price" <= "base_price") AND ("max_price" IS NULL OR "max_price" >= "base_price"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_estimated_duration_positive') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_estimated_duration_positive" CHECK ("estimated_duration" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_version_positive') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_version_positive" CHECK ("version" > 0);
  END IF;
END $$;

------------------------------------------------------------------------------------------------
-- 3. Taxonomy resolution: an unset category_id is derived from the operational category through
--    service_categories.operational_categories (the same fallback the web adapter applied); a
--    subcategory must belong to the service category; a category must be top-level.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION services_resolve_taxonomy() RETURNS trigger AS $$
DECLARE
  cat_parent TEXT;
  sub_parent TEXT;
BEGIN
  IF NEW."category_id" IS NULL THEN
    SELECT c."id" INTO NEW."category_id"
    FROM "service_categories" c
    WHERE c."parent_id" IS NULL AND c."is_active" AND NEW."category" = ANY (c."operational_categories")
    ORDER BY c."sort_order" ASC, c."slug" ASC
    LIMIT 1;
  END IF;
  IF NEW."category_id" IS NOT NULL THEN
    SELECT c."parent_id" INTO cat_parent FROM "service_categories" c WHERE c."id" = NEW."category_id";
    IF cat_parent IS NOT NULL THEN
      RAISE EXCEPTION 'SERVICE_CATEGORY_NOT_TOP_LEVEL' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."subcategory_id" IS NOT NULL THEN
    SELECT c."parent_id" INTO sub_parent FROM "service_categories" c WHERE c."id" = NEW."subcategory_id";
    IF sub_parent IS NULL OR NEW."category_id" IS NULL OR sub_parent <> NEW."category_id" THEN
      RAISE EXCEPTION 'SERVICE_SUBCATEGORY_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "services_resolve_taxonomy_trg" ON "services";
CREATE TRIGGER "services_resolve_taxonomy_trg"
  BEFORE INSERT OR UPDATE OF "category", "category_id", "subcategory_id" ON "services"
  FOR EACH ROW EXECUTE FUNCTION services_resolve_taxonomy();


------------------------------------------------------------------------------------------------
-- 4. Taxonomy backfill: explicit bindings first (from ServiceDef.bind), then the operational fallback.
------------------------------------------------------------------------------------------------
-- Bindings: backend service slug -> taxonomy (from ServiceDef.bind in taxonomy.ts). Only rows that exist are touched.
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'hourly') WHERE "slug" IN ('hourly-bookings') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'daily') WHERE "slug" IN ('dusting-wiping') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'daily') WHERE "slug" IN ('sweeping-mopping') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'daily') WHERE "slug" IN ('utensil-washing') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'daily') WHERE "slug" IN ('kitchen-prep') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'laundry-fabric' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('ironing-folding') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-help' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-help' AND s."slug" = 'organise') WHERE "slug" IN ('packing-unpacking') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'rooms') WHERE "slug" IN ('bathroom-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'rooms') WHERE "slug" IN ('kitchen-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'rooms') WHERE "slug" IN ('deep-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'furnishings') WHERE "slug" IN ('wardrobe-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'fixtures') WHERE "slug" IN ('kitchen-cabinet-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'rooms') WHERE "slug" IN ('window-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'rooms') WHERE "slug" IN ('balcony-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'fixtures') WHERE "slug" IN ('fan-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'fixtures') WHERE "slug" IN ('fridge-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'furnishings') WHERE "slug" IN ('sofa-deep-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'furnishings') WHERE "slug" IN ('mattress-sanitization') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-cleaning' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-cleaning' AND s."slug" = 'furnishings') WHERE "slug" IN ('carpet-shampooing') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'event-occasion' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('pre-party-express-clean') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'event-occasion' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('after-party-express-clean') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-maintenance' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-maintenance' AND s."slug" = 'repairs') WHERE "slug" IN ('plumbing') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-maintenance' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-maintenance' AND s."slug" = 'repairs') WHERE "slug" IN ('electrician') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'home-maintenance' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'home-maintenance' AND s."slug" = 'painting') WHERE "slug" IN ('home-painting') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'appliance-care' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'appliance-care' AND s."slug" = 'cooling') WHERE "slug" IN ('ac-service') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'specialized-care' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('pest-control') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'specialized-care' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('plant-care') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'specialized-care' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('fasade-cleaning', 'facade-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'laundry-fabric' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('laundry') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'vehicle-care' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('car-surface-cleaning') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = NULL WHERE "slug" IN ('salon-at-home') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'hair') WHERE "slug" IN ('beauty-haircut-styling') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'hair') WHERE "slug" IN ('beauty-hair-styling') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'hair') WHERE "slug" IN ('beauty-occasion-styling') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'hair') WHERE "slug" IN ('beauty-hair-colour') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'hair') WHERE "slug" IN ('beauty-hair-treatments') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'skin') WHERE "slug" IN ('beauty-facial-skin') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'skin') WHERE "slug" IN ('beauty-cleanup') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'skin') WHERE "slug" IN ('beauty-bleach-detan') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'waxing') WHERE "slug" IN ('beauty-threading') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'waxing') WHERE "slug" IN ('beauty-waxing') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'nails') WHERE "slug" IN ('beauty-manicure-pedicure') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'nails') WHERE "slug" IN ('beauty-nails') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'makeup') WHERE "slug" IN ('beauty-makeup') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'makeup') WHERE "slug" IN ('beauty-draping') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'bridal') WHERE "slug" IN ('beauty-bridal-wedding') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'spa') WHERE "slug" IN ('beauty-spa-massage') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'grooming') WHERE "slug" IN ('beauty-beard-shaving') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'spa') WHERE "slug" IN ('beauty-head-massage') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'grooming') WHERE "slug" IN ('beauty-grooming-packages') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'grooming') WHERE "slug" IN ('beauty-gentle-grooming') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'skin') WHERE "slug" IN ('beauty-gentle-skin-care') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'spa') WHERE "slug" IN ('beauty-head-foot-care') AND "category_id" IS NULL;
UPDATE "services" SET "category_id" = (SELECT "id" FROM "service_categories" WHERE "slug" = 'beauty' AND "parent_id" IS NULL), "subcategory_id" = (SELECT s."id" FROM "service_categories" s JOIN "service_categories" c ON c."id" = s."parent_id" WHERE c."slug" = 'beauty' AND s."slug" = 'spa') WHERE "slug" IN ('beauty-relaxation') AND "category_id" IS NULL;

-- Backfill every remaining row through the same rule the trigger applies.
UPDATE "services" s
SET "category_id" = (
  SELECT c."id" FROM "service_categories" c
  WHERE c."parent_id" IS NULL AND c."is_active" AND s."category" = ANY (c."operational_categories")
  ORDER BY c."sort_order" ASC, c."slug" ASC
  LIMIT 1
)
WHERE s."category_id" IS NULL;

------------------------------------------------------------------------------------------------
-- 5. service_code defaults to slug on insert (the rule catalog.service.create already applied).
--    Existing writers that never sent a code keep working; NOT NULL is checked after this
--    BEFORE trigger. An explicit code is never overwritten, and UPDATEs are not touched, so a
--    later slug change never rewrites the business code.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION services_default_service_code() RETURNS trigger AS $$
BEGIN
  IF NEW."service_code" IS NULL OR btrim(NEW."service_code") = '' THEN
    NEW."service_code" := NEW."slug";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "services_default_service_code_trg" ON "services";
CREATE TRIGGER "services_default_service_code_trg"
  BEFORE INSERT ON "services"
  FOR EACH ROW EXECUTE FUNCTION services_default_service_code();
