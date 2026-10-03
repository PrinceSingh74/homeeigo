-- Phase 05 — pricing integrity + service provenance.
-- Hand-scoped and additive. Every CHECK was measured to hold on every row of homigo_db and
-- homigo_test before this file was written (0 violations on 2026-09-21).

------------------------------------------------------------------------------------------------
-- 1. Money precision: catalogue prices are whole paise. The quote engine computes in integer paise
--    (lib/pricing-policy.ts); a sub-paise catalogue price would otherwise be silently rounded.
------------------------------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_price_paise_precision') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_price_paise_precision" CHECK (
      "base_price"::numeric = round("base_price"::numeric, 2)
      AND ("min_price" IS NULL OR "min_price"::numeric = round("min_price"::numeric, 2))
      AND ("max_price" IS NULL OR "max_price"::numeric = round("max_price"::numeric, 2))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_currency_format') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_variants_price_paise_precision') THEN
    ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_price_paise_precision"
      CHECK ("price"::numeric = round("price"::numeric, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_addons_price_paise_precision') THEN
    ALTER TABLE "service_addons" ADD CONSTRAINT "service_addons_price_paise_precision"
      CHECK ("price"::numeric = round("price"::numeric, 2));
  END IF;
END $$;

------------------------------------------------------------------------------------------------
-- 2. Service provenance — the same DataOrigin model users / bookings / refund_requests already
--    carry (20260921120000_data_provenance). NULL = UNKNOWN = treated as real.
--    Customer catalogue, customer quotes and partner onboarding exclude every non-real origin.
------------------------------------------------------------------------------------------------
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "data_origin" "DataOrigin";
CREATE INDEX IF NOT EXISTS "services_data_origin_idx" ON "services" ("data_origin");

-- Classification by an explicit, reproducible rule (owner-approved 2026-09-21): slugs produced
-- only by test/certification harnesses. INFERRED_*, never declared — the label says how it
-- was derived. Rows already classified are left alone; no row is deleted or otherwise changed.
UPDATE "services"
SET "data_origin" = 'INFERRED_FIXTURE'::"DataOrigin"
WHERE "data_origin" IS NULL
  AND ("slug" ~ '^(adv-service-|phase2-|eco-svc-)' OR "slug" ~ '^(rc|fm)[0-9]+$');
