-- Phase 10 §7/§8 — execution plan (typed, versioned with the service) and per-booking step state.
--
-- Before: no execution model existed. On 2026-09-24 none of the 48 active services on homigo_db had
-- a quality, safety or step configuration, and nothing recorded what a professional actually did
-- between start and completion.
--
-- service_execution_steps  typed mirror of catalog_config.execution.steps, synced in the service write
--                          transaction (the same contract as service_requirements). The plan version IS
--                          the service version — no second versioning engine.
-- booking_execution_steps  one row per step that applies to a booking, materialised from the booking's
--                          own `execution.v1` snapshot in the create transaction; never from the live
--                          catalogue, so admin edits cannot reach an active or historical booking.
-- booking_execution_audit  append-only, written by trigger (actor/reason/request/trace from the same
--                          transaction-local settings booking_status_history uses).
--
-- Additive: three tables, indexes, three functions, four triggers. No existing object is altered.

CREATE TABLE IF NOT EXISTS "service_execution_steps" (
    "id"                  TEXT PRIMARY KEY,
    "service_id"          TEXT NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
    "code"                TEXT NOT NULL,
    "title"               TEXT NOT NULL,
    "description"         TEXT,
    "kind"                TEXT NOT NULL,
    "is_mandatory"        BOOLEAN NOT NULL DEFAULT true,
    "skip_policy"         TEXT NOT NULL DEFAULT 'NOT_SKIPPABLE',
    "evidence"            TEXT NOT NULL DEFAULT 'NONE',
    "estimated_minutes"   INTEGER,
    "depends_on"          TEXT[] NOT NULL DEFAULT '{}',
    "safety_requirement"  TEXT,
    "ppe"                 TEXT[] NOT NULL DEFAULT '{}',
    "warnings"            TEXT[] NOT NULL DEFAULT '{}',
    "when_variant_codes"  TEXT[] NOT NULL DEFAULT '{}',
    "when_addon_codes"    TEXT[] NOT NULL DEFAULT '{}',
    "when_min_quantity"   INTEGER,
    "sort_order"          INTEGER NOT NULL DEFAULT 0,
    "is_active"           BOOLEAN NOT NULL DEFAULT true,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "service_execution_steps_service_code_key" UNIQUE ("service_id", "code"),
    CONSTRAINT "service_execution_steps_code_check" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "service_execution_steps_kind_check" CHECK ("kind" IN ('PREPARATION', 'WORK', 'SAFETY_CHECK', 'QUALITY_CHECK', 'CLOSEOUT')),
    CONSTRAINT "service_execution_steps_skip_check" CHECK ("skip_policy" IN ('NOT_SKIPPABLE', 'SKIP_WITH_REASON')),
    CONSTRAINT "service_execution_steps_evidence_check" CHECK ("evidence" IN ('NONE', 'NOTE', 'PHOTO', 'BEFORE_AFTER_PHOTOS')),
    -- P10.4, below the application too: a mandatory step cannot be skippable.
    CONSTRAINT "service_execution_steps_mandatory_skip_check" CHECK (NOT "is_mandatory" OR "skip_policy" = 'NOT_SKIPPABLE')
);
CREATE INDEX IF NOT EXISTS "service_execution_steps_service_active_idx" ON "service_execution_steps" ("service_id", "is_active");

CREATE TABLE IF NOT EXISTS "booking_execution_steps" (
    "id"                  BIGSERIAL PRIMARY KEY,
    "booking_id"          TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "code"                TEXT NOT NULL,
    "step_number"         INTEGER NOT NULL,
    "kind"                TEXT NOT NULL,
    "is_mandatory"        BOOLEAN NOT NULL,
    "skip_policy"         TEXT NOT NULL,
    "evidence"            TEXT NOT NULL,
    "depends_on"          TEXT[] NOT NULL DEFAULT '{}',
    "safety_requirement"  TEXT,
    "service_version"     INTEGER NOT NULL,
    "state"               TEXT NOT NULL DEFAULT 'PENDING',
    "actor_role"          TEXT,
    "actor_id"            TEXT,
    "evidence_ref"        TEXT,
    "note"                TEXT,
    "reason"              TEXT,
    "started_at"          TIMESTAMPTZ,
    "finished_at"         TIMESTAMPTZ,
    "version"             INTEGER NOT NULL DEFAULT 1,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "booking_execution_steps_booking_code_key" UNIQUE ("booking_id", "code"),
    CONSTRAINT "booking_execution_steps_state_check"
      CHECK ("state" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED_WITH_REASON', 'FAILED', 'ESCALATED')),
    CONSTRAINT "booking_execution_steps_role_check" CHECK ("actor_role" IS NULL OR "actor_role" IN ('PARTNER', 'ADMIN', 'SYSTEM')),
    -- A mandatory step can never be recorded as skipped, whoever writes the row.
    CONSTRAINT "booking_execution_steps_mandatory_skip_check" CHECK (NOT ("is_mandatory" AND "state" = 'SKIPPED_WITH_REASON')),
    -- Exception states always carry a reason; a finished step always says who and when.
    CONSTRAINT "booking_execution_steps_reason_check"
      CHECK ("state" NOT IN ('SKIPPED_WITH_REASON', 'FAILED', 'ESCALATED') OR ("reason" IS NOT NULL AND length("reason") >= 3)),
    CONSTRAINT "booking_execution_steps_finished_check"
      CHECK ("state" NOT IN ('COMPLETED', 'SKIPPED_WITH_REASON', 'FAILED', 'ESCALATED') OR ("actor_role" IS NOT NULL AND "finished_at" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "booking_execution_steps_booking_state_idx" ON "booking_execution_steps" ("booking_id", "state");

CREATE TABLE IF NOT EXISTS "booking_execution_audit" (
    "id"               BIGSERIAL PRIMARY KEY,
    "booking_id"       TEXT NOT NULL,
    "code"             TEXT NOT NULL,
    "service_version"  INTEGER,
    "action"           TEXT NOT NULL,
    "from_state"       TEXT,
    "to_state"         TEXT NOT NULL,
    "actor_type"       TEXT,
    "actor_id"         TEXT,
    "reason"           TEXT,
    "request_id"       TEXT,
    "trace_id"         TEXT,
    "evidence_ref"     TEXT,
    "idempotency_key"  TEXT,
    "changed_at"       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS "booking_execution_audit_booking_idx" ON "booking_execution_audit" ("booking_id", "changed_at");

CREATE OR REPLACE FUNCTION booking_execution_steps_record_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO booking_execution_audit (
      booking_id, code, service_version, action, from_state, to_state,
      actor_type, actor_id, reason, request_id, trace_id, evidence_ref, idempotency_key
    ) VALUES (
      NEW.booking_id, NEW.code, NEW.service_version,
      CASE WHEN TG_OP = 'INSERT' THEN 'MATERIALIZED'
           ELSE COALESCE(NULLIF(current_setting('homigo.execution_action', true), ''), 'TRANSITION') END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
      NEW.state,
      NULLIF(current_setting('homigo.actor_type', true), ''),
      NULLIF(current_setting('homigo.actor_id', true), ''),
      NULLIF(left(current_setting('homigo.reason', true), 500), ''),
      NULLIF(current_setting('homigo.request_id', true), ''),
      NULLIF(current_setting('homigo.trace_id', true), ''),
      NEW.evidence_ref,
      NULLIF(current_setting('homigo.idempotency_key', true), '')
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_execution_steps_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_execution_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_execution_audit is append-only';
END;
$$ LANGUAGE plpgsql;

-- AFTER: a BEFORE INSERT trigger would also fire for rows ON CONFLICT DO NOTHING skips (lesson from §6).
DROP TRIGGER IF EXISTS "booking_execution_steps_audit_trg" ON "booking_execution_steps";
CREATE TRIGGER "booking_execution_steps_audit_trg"
  AFTER INSERT OR UPDATE ON "booking_execution_steps"
  FOR EACH ROW EXECUTE FUNCTION booking_execution_steps_record_audit();

DROP TRIGGER IF EXISTS "booking_execution_steps_touch_trg" ON "booking_execution_steps";
CREATE TRIGGER "booking_execution_steps_touch_trg"
  BEFORE UPDATE ON "booking_execution_steps"
  FOR EACH ROW EXECUTE FUNCTION booking_execution_steps_touch();

DROP TRIGGER IF EXISTS "booking_execution_audit_no_update" ON "booking_execution_audit";
CREATE TRIGGER "booking_execution_audit_no_update"
  BEFORE UPDATE ON "booking_execution_audit"
  FOR EACH ROW EXECUTE FUNCTION booking_execution_audit_append_only();

DROP TRIGGER IF EXISTS "service_execution_steps_touch_trg" ON "service_execution_steps";
CREATE TRIGGER "service_execution_steps_touch_trg"
  BEFORE UPDATE ON "service_execution_steps"
  FOR EACH ROW EXECUTE FUNCTION booking_execution_steps_touch();
