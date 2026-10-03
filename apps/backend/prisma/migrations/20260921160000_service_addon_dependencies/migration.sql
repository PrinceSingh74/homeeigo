-- Phase 03 — add-on quantities and dependencies on the relational option rows.
-- Hand-scoped and additive. The JSON catalog_config already carries these fields (validated by
-- serviceCatalogConfigSchema); the rows must carry them too, because hydrateCatalogConfig lets the
-- rows win over the JSON — a field the table cannot hold would be silently dropped at quote time.
-- No row is rewritten: every existing add-on gets NULL / empty arrays, which is today's behaviour.

ALTER TABLE "service_addons"
  ADD COLUMN IF NOT EXISTS "max_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "requires_addon_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "conflicts_with_addon_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_addons_max_quantity_range') THEN
    ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_max_quantity_range"
      CHECK ("max_quantity" IS NULL OR ("max_quantity" BETWEEN 1 AND 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_addons_no_self_dependency') THEN
    ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_no_self_dependency"
      CHECK (NOT ("code" = ANY ("requires_addon_codes")) AND NOT ("code" = ANY ("conflicts_with_addon_codes")));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_variants_duration_positive') THEN
    ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_duration_positive"
      CHECK ("duration_min" IS NULL OR "duration_min" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_addons_duration_positive') THEN
    ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_duration_positive"
      CHECK ("duration_min" IS NULL OR "duration_min" > 0);
  END IF;
END $$;
