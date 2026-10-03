-- Relational variants, add-ons, and category lookup.
-- Hand-scoped and additive. Does not drop catalog_config, triggers, or booking objects.
-- Backfill copies existing catalog_config JSON; unknown facts are not invented.
-- resolveSelection remains the only price calculator — rows hydrate into that schema.

CREATE TABLE IF NOT EXISTS "service_variants" (
  "id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "duration_min" INTEGER,
  "audiences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "inclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "exclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "quantity_override" JSONB,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "service_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_variants_price_nonneg" CHECK ("price" >= 0),
  CONSTRAINT "service_variants_code_format" CHECK ("code" ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT "service_variants_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_variants_service_id_code_key"
  ON "service_variants" ("service_id", "code");
CREATE INDEX IF NOT EXISTS "service_variants_service_id_is_active_idx"
  ON "service_variants" ("service_id", "is_active");

CREATE TABLE IF NOT EXISTS "service_addons" (
  "id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "duration_min" INTEGER,
  "quantity_allowed" BOOLEAN NOT NULL DEFAULT TRUE,
  "compatible_variant_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "service_addons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_addons_price_nonneg" CHECK ("price" >= 0),
  CONSTRAINT "service_addons_code_format" CHECK ("code" ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT "service_addons_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_addons_service_id_code_key"
  ON "service_addons" ("service_id", "code");
CREATE INDEX IF NOT EXISTS "service_addons_service_id_is_active_idx"
  ON "service_addons" ("service_id", "is_active");

CREATE TABLE IF NOT EXISTS "service_categories" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_categories_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_categories_slug_key" ON "service_categories" ("slug");
CREATE INDEX IF NOT EXISTS "service_categories_parent_id_idx" ON "service_categories" ("parent_id");

INSERT INTO "service_categories" ("id", "slug", "name")
SELECT
  'sc_' || md5(category),
  category,
  initcap(replace(category, '-', ' '))
FROM (SELECT DISTINCT category FROM "services") d
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "service_variants" (
  "id", "service_id", "code", "name", "description", "price", "duration_min",
  "audiences", "inclusions", "exclusions", "requirements", "quantity_override",
  "sort_order", "is_active"
)
SELECT
  'sv_' || substr(md5(s.id || ':' || (v->>'id')), 1, 22),
  s.id,
  v->>'id',
  COALESCE(v->>'name', v->>'id'),
  NULLIF(v->>'description', ''),
  COALESCE((v->>'price')::double precision, 0),
  NULLIF(v->>'durationMin', '')::integer,
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(v->'audiences')), ARRAY[]::text[]),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(v->'inclusions')), ARRAY[]::text[]),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(v->'exclusions')), ARRAY[]::text[]),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(v->'requirements')), ARRAY[]::text[]),
  v->'quantity',
  COALESCE((v->>'sortOrder')::integer, 0),
  COALESCE((v->>'active')::boolean, TRUE)
FROM "services" s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.catalog_config->'variants', '[]'::jsonb)) v
WHERE jsonb_typeof(s.catalog_config->'variants') = 'array'
  AND COALESCE(v->>'id', '') ~ '^[a-z0-9][a-z0-9-]*$'
ON CONFLICT ("service_id", "code") DO NOTHING;

INSERT INTO "service_addons" (
  "id", "service_id", "code", "name", "description", "price", "duration_min",
  "quantity_allowed", "compatible_variant_codes", "sort_order", "is_active"
)
SELECT
  'sa_' || substr(md5(s.id || ':' || (a->>'id')), 1, 22),
  s.id,
  a->>'id',
  COALESCE(a->>'name', a->>'id'),
  NULLIF(a->>'description', ''),
  COALESCE((a->>'price')::double precision, 0),
  NULLIF(a->>'durationMin', '')::integer,
  COALESCE((a->>'quantityAllowed')::boolean, TRUE),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(a->'compatibleVariantIds')), ARRAY[]::text[]),
  COALESCE((a->>'sortOrder')::integer, 0),
  COALESCE((a->>'active')::boolean, TRUE)
FROM "services" s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.catalog_config->'addons', '[]'::jsonb)) a
WHERE jsonb_typeof(s.catalog_config->'addons') = 'array'
  AND COALESCE(a->>'id', '') ~ '^[a-z0-9][a-z0-9-]*$'
ON CONFLICT ("service_id", "code") DO NOTHING;
