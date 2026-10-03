-- Phase 06 — materials, equipment and customer requirements.
--
-- Additive only: two new tables, no change to any existing table, trigger, index or row.
-- NO DATA IS SEEDED. Not one live service has configured materials, equipment or preparation
-- (audit 2026-09-22: 0 of 31), and which party supplies what is business data — nothing here
-- invents it. Services without assignments keep behaving exactly as before.
--
--   service_requirement_items  reusable catalogue: a thing (material / equipment) or a customer
--                              precondition, named once and assigned to many services.
--   service_requirements       per-service assignment. Mirrors catalog_config.requirements and is
--                              rewritten in the same transaction as the service row (the same
--                              contract as service_variants / service_addons), so it is versioned
--                              with the service by service_config_versions.
--
-- Three questions are kept apart on purpose — they are different facts:
--   responsibility  who has it on the day          (CUSTOMER / PROFESSIONAL / PLATFORM / SHARED / UNKNOWN)
--   procurement     who buys it when it is missing (CUSTOMER / PROFESSIONAL / PLATFORM, NULL = the provider)
--   charge          how the customer pays for it   (INCLUDED / CHARGEABLE via an add-on / SEPARATE_QUOTE / NOT_APPLICABLE)

CREATE TABLE IF NOT EXISTS "service_requirement_items" (
  "id"             TEXT PRIMARY KEY,
  "code"           TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "customer_label" TEXT,
  "description"    TEXT,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "created_by"     TEXT,
  "updated_by"     TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "service_requirement_items_code_key" UNIQUE ("code"),
  CONSTRAINT "service_requirement_items_code_check" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("code") <= 60),
  CONSTRAINT "service_requirement_items_kind_check" CHECK ("kind" IN ('MATERIAL', 'EQUIPMENT', 'CUSTOMER_PRECONDITION')),
  CONSTRAINT "service_requirement_items_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "service_requirement_items_label_check" CHECK ("customer_label" IS NULL OR length(btrim("customer_label")) BETWEEN 1 AND 160),
  CONSTRAINT "service_requirement_items_description_check" CHECK ("description" IS NULL OR length("description") <= 1000),
  CONSTRAINT "service_requirement_items_version_check" CHECK ("version" >= 1)
);
CREATE INDEX IF NOT EXISTS "service_requirement_items_kind_active_idx" ON "service_requirement_items" ("kind", "is_active");

CREATE TABLE IF NOT EXISTS "service_requirements" (
  "id"                   TEXT PRIMARY KEY,
  "service_id"           TEXT NOT NULL REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code"                 TEXT NOT NULL,
  "item_id"              TEXT NOT NULL REFERENCES "service_requirement_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "responsibility"       TEXT NOT NULL,
  "procurement"          TEXT,
  "charge"               TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  "is_optional"          BOOLEAN NOT NULL DEFAULT FALSE,
  "enforcement"          TEXT NOT NULL DEFAULT 'INFORMATIONAL',
  "verification"         TEXT NOT NULL DEFAULT 'NONE',
  "quantity"             NUMERIC(12, 3),
  "unit"                 TEXT,
  "quantity_basis"       TEXT,
  "when_variant_codes"   TEXT[] NOT NULL DEFAULT '{}',
  "when_addon_codes"     TEXT[] NOT NULL DEFAULT '{}',
  "when_min_quantity"    INTEGER,
  "customer_note"        TEXT,
  "customer_warning"     TEXT,
  "partner_instructions" TEXT,
  "handling_note"        TEXT,
  "internal_note"        TEXT,
  "sort_order"           INTEGER NOT NULL DEFAULT 0,
  "is_active"            BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "service_requirements_service_code_key" UNIQUE ("service_id", "code"),
  CONSTRAINT "service_requirements_code_check" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("code") <= 60),
  CONSTRAINT "service_requirements_responsibility_check" CHECK ("responsibility" IN ('CUSTOMER', 'PROFESSIONAL', 'PLATFORM', 'SHARED', 'UNKNOWN')),
  CONSTRAINT "service_requirements_procurement_check" CHECK ("procurement" IS NULL OR "procurement" IN ('CUSTOMER', 'PROFESSIONAL', 'PLATFORM')),
  CONSTRAINT "service_requirements_charge_check" CHECK ("charge" IN ('INCLUDED', 'CHARGEABLE', 'SEPARATE_QUOTE', 'NOT_APPLICABLE')),
  CONSTRAINT "service_requirements_enforcement_check" CHECK ("enforcement" IN ('INFORMATIONAL', 'WARNING', 'REQUIRED_BEFORE_BOOKING', 'REQUIRED_BEFORE_ARRIVAL', 'REQUIRED_AT_START')),
  CONSTRAINT "service_requirements_verification_check" CHECK ("verification" IN ('NONE', 'CUSTOMER_ATTESTATION', 'PARTNER_CHECK')),
  -- A quantity is a number AND a unit AND a basis, or none of them — never a fake "1".
  CONSTRAINT "service_requirements_quantity_check" CHECK ("quantity" IS NULL OR ("quantity" > 0 AND "quantity" <= 10000)),
  CONSTRAINT "service_requirements_quantity_shape_check" CHECK (
    ("quantity" IS NULL) = ("unit" IS NULL) AND ("quantity" IS NULL) = ("quantity_basis" IS NULL)
  ),
  CONSTRAINT "service_requirements_unit_check" CHECK ("unit" IS NULL OR length(btrim("unit")) BETWEEN 1 AND 20),
  CONSTRAINT "service_requirements_basis_check" CHECK ("quantity_basis" IS NULL OR "quantity_basis" IN ('PER_BOOKING', 'PER_SELECTED_UNIT')),
  CONSTRAINT "service_requirements_min_quantity_check" CHECK ("when_min_quantity" IS NULL OR "when_min_quantity" >= 1),
  -- The customer's own item cannot be "included" in, or charged by, the platform.
  CONSTRAINT "service_requirements_customer_charge_check" CHECK ("responsibility" <> 'CUSTOMER' OR "charge" = 'NOT_APPLICABLE'),
  -- A chargeable item is priced by an add-on (Phase 05 quote) — never by a second pricing path.
  CONSTRAINT "service_requirements_chargeable_check" CHECK ("charge" <> 'CHARGEABLE' OR cardinality("when_addon_codes") > 0),
  -- Blocking-before-booking needs something the backend can check: the customer's confirmation.
  CONSTRAINT "service_requirements_blocking_check" CHECK ("enforcement" <> 'REQUIRED_BEFORE_BOOKING' OR "verification" = 'CUSTOMER_ATTESTATION'),
  CONSTRAINT "service_requirements_text_check" CHECK (
    ("customer_note" IS NULL OR length("customer_note") <= 500)
    AND ("customer_warning" IS NULL OR length("customer_warning") <= 500)
    AND ("partner_instructions" IS NULL OR length("partner_instructions") <= 1000)
    AND ("handling_note" IS NULL OR length("handling_note") <= 500)
    AND ("internal_note" IS NULL OR length("internal_note") <= 1000)
  )
);
CREATE INDEX IF NOT EXISTS "service_requirements_service_active_idx" ON "service_requirements" ("service_id", "is_active");
CREATE INDEX IF NOT EXISTS "service_requirements_item_idx" ON "service_requirements" ("item_id");

COMMENT ON TABLE "service_requirement_items" IS 'Phase 06: reusable materials, equipment and customer preconditions. Business data; nothing seeded.';
COMMENT ON TABLE "service_requirements" IS 'Phase 06: per-service requirement assignments, synced from catalog_config.requirements in the service write transaction.';
