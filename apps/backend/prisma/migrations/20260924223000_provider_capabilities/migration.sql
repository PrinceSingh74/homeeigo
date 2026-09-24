-- Phase 11 — typed provider capability: skills, certifications, equipment, insurance, languages,
-- business membership and the provider ↔ service capability join.
--
-- Before: a provider's capability was one free-text `providers.service_categories String[]` that the
-- partner wrote themselves at onboarding (mixed service ids, category words, slugs), matched with a
-- loose OR over hard-coded slug tables; `certifications String[]` was free text; insurance was
-- guessed from a document's free-text type; there was no equipment, language, business or
-- provider-service model at all, and none of the mandated rejection reasons could be emitted.
--
-- Every capability row carries `data_origin` (the provider's user origin at creation) so fixture
-- capability can never be mistaken for production capability, and a status lifecycle
-- DECLARED → VERIFIED | REJECTED | REVOKED with who verified it and when. Expiry is a column, so
-- "expired" is arithmetic, never a claim.
--
-- Nothing existing is altered except `services`, which gains a nullable `business_id`
-- (a business-owned service that only that business's providers may execute).
-- The legacy String[] columns stay in place and are read by the legacy fallback until the owner
-- switches matching to strict capability (feature flag; see docs/phase-10-11-12-final-certification.md).

CREATE TABLE IF NOT EXISTS "skills" (
    "code"        TEXT PRIMARY KEY,
    "category"    TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "skills_code_check" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS "provider_skills" (
    "id"           BIGSERIAL PRIMARY KEY,
    "provider_id"  TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "skill_code"   TEXT NOT NULL REFERENCES "skills"("code"),
    "level"        TEXT,
    "status"       TEXT NOT NULL DEFAULT 'DECLARED',
    "source"       TEXT NOT NULL DEFAULT 'SELF',
    "source_ref"   TEXT,
    "verified_by"  TEXT,
    "verified_at"  TIMESTAMPTZ,
    "expires_at"   TIMESTAMPTZ,
    "data_origin"  "DataOrigin",
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "provider_skills_level_check" CHECK ("level" IS NULL OR "level" IN ('BASIC', 'SKILLED', 'EXPERT')),
    CONSTRAINT "provider_skills_status_check" CHECK ("status" IN ('DECLARED', 'VERIFIED', 'REJECTED', 'REVOKED')),
    CONSTRAINT "provider_skills_source_check" CHECK ("source" IN ('SELF', 'ADMIN', 'DOCUMENT', 'IMPORT', 'LEGACY')),
    CONSTRAINT "provider_skills_verified_check" CHECK (("status" = 'VERIFIED') = ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
    CONSTRAINT "provider_skills_provider_skill_key" UNIQUE ("provider_id", "skill_code")
);
CREATE INDEX IF NOT EXISTS "provider_skills_skill_status_idx" ON "provider_skills" ("skill_code", "status");

CREATE TABLE IF NOT EXISTS "provider_certifications" (
    "id"                  BIGSERIAL PRIMARY KEY,
    "provider_id"         TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "certification_type"  TEXT NOT NULL,
    "issuer"              TEXT,
    "reference_number"    TEXT,
    "issued_at"           TIMESTAMPTZ,
    "expires_at"          TIMESTAMPTZ,
    "status"              TEXT NOT NULL DEFAULT 'DECLARED',
    "verification_source" TEXT,
    "document_id"         TEXT REFERENCES "provider_documents"("id") ON DELETE SET NULL,
    "proof_ref"           TEXT,
    "verified_by"         TEXT,
    "verified_at"         TIMESTAMPTZ,
    "revoked_at"          TIMESTAMPTZ,
    "revoked_reason"      TEXT,
    "data_origin"         "DataOrigin",
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "provider_certifications_type_check" CHECK ("certification_type" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "provider_certifications_status_check" CHECK ("status" IN ('DECLARED', 'VERIFIED', 'REJECTED', 'REVOKED')),
    CONSTRAINT "provider_certifications_verified_check" CHECK (("status" = 'VERIFIED') = ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
    CONSTRAINT "provider_certifications_revoked_check" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)),
    CONSTRAINT "provider_certifications_dates_check" CHECK ("issued_at" IS NULL OR "expires_at" IS NULL OR "expires_at" > "issued_at")
);
CREATE INDEX IF NOT EXISTS "provider_certifications_provider_type_idx" ON "provider_certifications" ("provider_id", "certification_type");
CREATE INDEX IF NOT EXISTS "provider_certifications_expiry_idx" ON "provider_certifications" ("expires_at") WHERE "status" = 'VERIFIED';

CREATE TABLE IF NOT EXISTS "provider_equipment" (
    "id"                 BIGSERIAL PRIMARY KEY,
    "provider_id"        TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "equipment_type"     TEXT NOT NULL,
    "ownership"          TEXT NOT NULL DEFAULT 'OWNED',
    "operational"        TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "status"             TEXT NOT NULL DEFAULT 'DECLARED',
    "verified_by"        TEXT,
    "verified_at"        TIMESTAMPTZ,
    "inspection_due_at"  TIMESTAMPTZ,
    "note"               TEXT,
    "data_origin"        "DataOrigin",
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "provider_equipment_type_check" CHECK ("equipment_type" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "provider_equipment_ownership_check" CHECK ("ownership" IN ('OWNED', 'RENTED', 'EMPLOYER')),
    CONSTRAINT "provider_equipment_operational_check" CHECK ("operational" IN ('OPERATIONAL', 'OUT_OF_SERVICE')),
    CONSTRAINT "provider_equipment_status_check" CHECK ("status" IN ('DECLARED', 'VERIFIED', 'REJECTED', 'REVOKED')),
    CONSTRAINT "provider_equipment_verified_check" CHECK (("status" = 'VERIFIED') = ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
    CONSTRAINT "provider_equipment_provider_type_key" UNIQUE ("provider_id", "equipment_type")
);

CREATE TABLE IF NOT EXISTS "provider_insurance" (
    "id"                BIGSERIAL PRIMARY KEY,
    "provider_id"       TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "insurance_type"    TEXT NOT NULL,
    "insurer"           TEXT,
    "policy_reference"  TEXT,
    "effective_from"    TIMESTAMPTZ,
    "expires_at"        TIMESTAMPTZ NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'DECLARED',
    "document_id"       TEXT REFERENCES "provider_documents"("id") ON DELETE SET NULL,
    "proof_ref"         TEXT,
    "verified_by"       TEXT,
    "verified_at"       TIMESTAMPTZ,
    "revoked_at"        TIMESTAMPTZ,
    "revoked_reason"    TEXT,
    "data_origin"       "DataOrigin",
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "provider_insurance_type_check" CHECK ("insurance_type" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "provider_insurance_status_check" CHECK ("status" IN ('DECLARED', 'VERIFIED', 'REJECTED', 'REVOKED')),
    CONSTRAINT "provider_insurance_verified_check" CHECK (("status" = 'VERIFIED') = ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
    CONSTRAINT "provider_insurance_revoked_check" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)),
    CONSTRAINT "provider_insurance_dates_check" CHECK ("effective_from" IS NULL OR "expires_at" > "effective_from")
);
CREATE INDEX IF NOT EXISTS "provider_insurance_provider_type_idx" ON "provider_insurance" ("provider_id", "insurance_type");

CREATE TABLE IF NOT EXISTS "provider_languages" (
    "id"             BIGSERIAL PRIMARY KEY,
    "provider_id"    TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "language_code"  TEXT NOT NULL,
    "proficiency"    TEXT NOT NULL DEFAULT 'CONVERSATIONAL',
    "source"         TEXT NOT NULL DEFAULT 'SELF',
    "active"         BOOLEAN NOT NULL DEFAULT true,
    "data_origin"    "DataOrigin",
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- ISO 639-1 two-letter codes only; never inferred from a name, a city or a nationality.
    CONSTRAINT "provider_languages_code_check" CHECK ("language_code" ~ '^[a-z]{2}$'),
    CONSTRAINT "provider_languages_proficiency_check" CHECK ("proficiency" IN ('BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE')),
    CONSTRAINT "provider_languages_source_check" CHECK ("source" IN ('SELF', 'ADMIN')),
    CONSTRAINT "provider_languages_provider_code_key" UNIQUE ("provider_id", "language_code")
);

CREATE TABLE IF NOT EXISTS "businesses" (
    "id"                   TEXT PRIMARY KEY,
    "name"                 TEXT NOT NULL,
    "legal_name"           TEXT,
    "registration_number"  TEXT UNIQUE,
    "status"               TEXT NOT NULL DEFAULT 'ACTIVE',
    "data_origin"          "DataOrigin",
    "created_by"           TEXT,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "businesses_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE TABLE IF NOT EXISTS "business_providers" (
    "id"              BIGSERIAL PRIMARY KEY,
    "business_id"     TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
    "provider_id"     TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "role"            TEXT NOT NULL DEFAULT 'MEMBER',
    "active"          BOOLEAN NOT NULL DEFAULT true,
    "effective_from"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "effective_to"    TIMESTAMPTZ,
    "verified_by"     TEXT,
    "verified_at"     TIMESTAMPTZ,
    "data_origin"     "DataOrigin",
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "business_providers_role_check" CHECK ("role" IN ('OWNER', 'MANAGER', 'MEMBER')),
    CONSTRAINT "business_providers_period_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
    CONSTRAINT "business_providers_business_provider_key" UNIQUE ("business_id", "provider_id")
);
CREATE INDEX IF NOT EXISTS "business_providers_provider_idx" ON "business_providers" ("provider_id") WHERE "active";

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "business_id" TEXT REFERENCES "businesses"("id");
CREATE INDEX IF NOT EXISTS "services_business_idx" ON "services" ("business_id") WHERE "business_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "provider_service_capabilities" (
    "id"           BIGSERIAL PRIMARY KEY,
    "provider_id"  TEXT NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
    "service_id"   TEXT NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
    "status"       TEXT NOT NULL DEFAULT 'REQUESTED',
    "source"       TEXT NOT NULL DEFAULT 'SELF',
    "verified_by"  TEXT,
    "verified_at"  TIMESTAMPTZ,
    "suspended_reason" TEXT,
    "data_origin"  "DataOrigin",
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "provider_service_capabilities_status_check" CHECK ("status" IN ('REQUESTED', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
    CONSTRAINT "provider_service_capabilities_source_check" CHECK ("source" IN ('SELF', 'ADMIN', 'LEGACY')),
    CONSTRAINT "provider_service_capabilities_active_check" CHECK ("status" <> 'ACTIVE' OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL)),
    CONSTRAINT "provider_service_capabilities_provider_service_key" UNIQUE ("provider_id", "service_id")
);
CREATE INDEX IF NOT EXISTS "provider_service_capabilities_service_active_idx" ON "provider_service_capabilities" ("service_id") WHERE "status" = 'ACTIVE';

-- Every capability change is recorded: one append-only audit for all seven tables.
CREATE TABLE IF NOT EXISTS "provider_capability_audit" (
    "id"           BIGSERIAL PRIMARY KEY,
    "table_name"   TEXT NOT NULL,
    "row_id"       TEXT NOT NULL,
    "provider_id"  TEXT,
    "action"       TEXT NOT NULL,
    "before"       JSONB,
    "after"        JSONB,
    "actor_type"   TEXT,
    "actor_id"     TEXT,
    "reason"       TEXT,
    "request_id"   TEXT,
    "trace_id"     TEXT,
    "changed_at"   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS "provider_capability_audit_provider_idx" ON "provider_capability_audit" ("provider_id", "changed_at");

CREATE OR REPLACE FUNCTION provider_capability_record_audit() RETURNS trigger AS $$
DECLARE
  v_before JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after  JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_row    RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  IF TG_OP = 'UPDATE' AND v_before - 'updated_at' = v_after - 'updated_at' THEN RETURN NULL; END IF;
  INSERT INTO provider_capability_audit (table_name, row_id, provider_id, action, before, after, actor_type, actor_id, reason, request_id, trace_id)
  VALUES (
    TG_TABLE_NAME, v_row.id::text,
    CASE WHEN TG_TABLE_NAME = 'businesses' THEN NULL ELSE (v_after->>'provider_id') END,
    TG_OP, v_before, v_after,
    NULLIF(current_setting('homigo.actor_type', true), ''),
    NULLIF(current_setting('homigo.actor_id', true), ''),
    NULLIF(left(current_setting('homigo.reason', true), 500), ''),
    NULLIF(current_setting('homigo.request_id', true), ''),
    NULLIF(current_setting('homigo.trace_id', true), '')
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION provider_capability_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION provider_capability_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'provider_capability_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_skills', 'provider_certifications', 'provider_equipment', 'provider_insurance', 'provider_languages', 'businesses', 'business_providers', 'provider_service_capabilities'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_audit_trg', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION provider_capability_record_audit()', t || '_audit_trg', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION provider_capability_touch()', t || '_touch_trg', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS "provider_capability_audit_no_update" ON "provider_capability_audit";
CREATE TRIGGER "provider_capability_audit_no_update"
  BEFORE UPDATE OR DELETE ON "provider_capability_audit"
  FOR EACH ROW EXECUTE FUNCTION provider_capability_audit_append_only();
