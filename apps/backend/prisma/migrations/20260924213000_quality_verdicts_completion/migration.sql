-- Phase 10 §10 — quality verdicts, and the customer-confirmation axis of completion.
--
-- Before: "quality" at completion was a two-code pre-check (QUALITY_PROOF_REQUIRED /
-- QUALITY_CHECKLIST_REQUIRED) that stored nothing; there was no verdict, no exception path, no
-- rework path, and COMPLETED was silently final for the customer (no confirmation, no issue window).
--
-- booking_quality_verdicts  append-only. One row per evaluation: derived by the server from job
--                           evidence, execution-step state, safety holds and open incidents at the
--                           moment a partner requests completion; or an ADMIN override, which must
--                           carry a reason and points at the verdict it supersedes. Old verdicts are
--                           never edited or deleted.
-- booking_completions       one row per booking: the confirmation axis. Written when completion is
--                           accepted (verdict PASS / PASS_WITH_EXCEPTION), PENDING_CUSTOMER until the
--                           customer confirms, reports an issue, or the window closes (AUTO_CONFIRMED
--                           by the scheduler — recorded, never silent). Booking status stays the
--                           canonical FSM's COMPLETED; this table does not replace it.
-- booking_completion_audit  append-only, trigger-written from the transaction-local actor settings
--                           booking_status_history already uses.
--
-- Additive: three tables, indexes, functions and triggers. Nothing existing is altered.

CREATE TABLE IF NOT EXISTS "booking_quality_verdicts" (
    "id"                      BIGSERIAL PRIMARY KEY,
    "booking_id"              TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "sequence"                INTEGER NOT NULL,
    "verdict"                 TEXT NOT NULL,
    "reason_codes"            TEXT[] NOT NULL DEFAULT '{}',
    -- Evidence references only (job_evidence ids, step codes+states, hold ids, incident ids,
    -- missing checklist items). Never customer or partner prose.
    "evidence"                JSONB NOT NULL DEFAULT '{}'::jsonb,
    "actor_type"              TEXT NOT NULL,
    "actor_id"                TEXT,
    "reason"                  TEXT,
    "policy_version"          TEXT NOT NULL DEFAULT 'quality.v1',
    "service_config_version"  INTEGER,
    "booking_status"          TEXT NOT NULL,
    "supersedes_id"           BIGINT REFERENCES "booking_quality_verdicts"("id"),
    "request_id"              TEXT,
    "trace_id"                TEXT,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "booking_quality_verdicts_verdict_check" CHECK ("verdict" IN ('PASS', 'PASS_WITH_EXCEPTION', 'REWORK_REQUIRED', 'FAILED', 'ESCALATED')),
    CONSTRAINT "booking_quality_verdicts_actor_check" CHECK ("actor_type" IN ('PARTNER', 'ADMIN', 'SYSTEM')),
    -- An admin override always says why, and always names the verdict it replaces.
    CONSTRAINT "booking_quality_verdicts_override_check" CHECK (
      "actor_type" <> 'ADMIN' OR ("reason" IS NOT NULL AND length("reason") >= 3 AND "supersedes_id" IS NOT NULL)
    ),
    CONSTRAINT "booking_quality_verdicts_booking_sequence_key" UNIQUE ("booking_id", "sequence")
);
CREATE INDEX IF NOT EXISTS "booking_quality_verdicts_booking_idx" ON "booking_quality_verdicts" ("booking_id", "id" DESC);

CREATE OR REPLACE FUNCTION booking_quality_verdicts_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_quality_verdicts is append-only: record a new verdict that supersedes the old one';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_quality_verdicts_no_update" ON "booking_quality_verdicts";
CREATE TRIGGER "booking_quality_verdicts_no_update"
  BEFORE UPDATE OR DELETE ON "booking_quality_verdicts"
  FOR EACH ROW EXECUTE FUNCTION booking_quality_verdicts_append_only();

CREATE TABLE IF NOT EXISTS "booking_completions" (
    "booking_id"        TEXT PRIMARY KEY REFERENCES "bookings"("id") ON DELETE CASCADE,
    "state"             TEXT NOT NULL DEFAULT 'PENDING_CUSTOMER',
    "verdict_id"        BIGINT REFERENCES "booking_quality_verdicts"("id"),
    "requested_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "confirm_by"        TIMESTAMPTZ NOT NULL,
    "resolved_at"       TIMESTAMPTZ,
    "resolved_by_type"  TEXT,
    "resolved_by_id"    TEXT,
    -- The complaint case opened when the customer reports an issue (constraint added with the
    -- cases migration, which creates that table).
    "case_id"           TEXT,
    "version"           INTEGER NOT NULL DEFAULT 1,
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "booking_completions_state_check" CHECK ("state" IN ('PENDING_CUSTOMER', 'CONFIRMED', 'AUTO_CONFIRMED', 'ISSUE_REPORTED')),
    CONSTRAINT "booking_completions_resolver_check" CHECK ("resolved_by_type" IS NULL OR "resolved_by_type" IN ('CUSTOMER', 'SYSTEM', 'ADMIN')),
    -- Pending rows are unresolved; every other state says who resolved it and when.
    CONSTRAINT "booking_completions_resolution_check" CHECK (
      ("state" = 'PENDING_CUSTOMER' AND "resolved_at" IS NULL AND "resolved_by_type" IS NULL)
      OR ("state" <> 'PENDING_CUSTOMER' AND "resolved_at" IS NOT NULL AND "resolved_by_type" IS NOT NULL)
    ),
    -- An issue report always points at its case; nothing else does.
    CONSTRAINT "booking_completions_case_check" CHECK (("state" = 'ISSUE_REPORTED') = ("case_id" IS NOT NULL))
);
-- The auto-confirm sweep reads only what is still pending and due.
CREATE INDEX IF NOT EXISTS "booking_completions_pending_due_idx" ON "booking_completions" ("confirm_by") WHERE "state" = 'PENDING_CUSTOMER';

CREATE TABLE IF NOT EXISTS "booking_completion_audit" (
    "id"          BIGSERIAL PRIMARY KEY,
    "booking_id"  TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "from_state"  TEXT,
    "to_state"    TEXT NOT NULL,
    "verdict_id"  BIGINT,
    "case_id"     TEXT,
    "actor_type"  TEXT,
    "actor_id"    TEXT,
    "reason"      TEXT,
    "request_id"  TEXT,
    "trace_id"    TEXT,
    "changed_at"  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS "booking_completion_audit_booking_idx" ON "booking_completion_audit" ("booking_id", "changed_at");

CREATE OR REPLACE FUNCTION booking_completions_record_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO booking_completion_audit (booking_id, action, from_state, to_state, verdict_id, case_id, actor_type, actor_id, reason, request_id, trace_id)
    VALUES (
      NEW.booking_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'REQUESTED' ELSE NEW.state END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
      NEW.state, NEW.verdict_id, NEW.case_id,
      NULLIF(current_setting('homigo.actor_type', true), ''),
      NULLIF(current_setting('homigo.actor_id', true), ''),
      NULLIF(left(current_setting('homigo.reason', true), 500), ''),
      NULLIF(current_setting('homigo.request_id', true), ''),
      NULLIF(current_setting('homigo.trace_id', true), '')
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A resolved completion is history: it is never reopened or re-resolved (a new issue goes through a case).
CREATE OR REPLACE FUNCTION booking_completions_resolved_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'PENDING_CUSTOMER' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'booking_completions: a resolved completion (%) cannot change state', OLD.state;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_completion_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_completion_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_completions_audit_trg" ON "booking_completions";
CREATE TRIGGER "booking_completions_audit_trg"
  AFTER INSERT OR UPDATE ON "booking_completions"
  FOR EACH ROW EXECUTE FUNCTION booking_completions_record_audit();

DROP TRIGGER IF EXISTS "booking_completions_immutable_trg" ON "booking_completions";
CREATE TRIGGER "booking_completions_immutable_trg"
  BEFORE UPDATE ON "booking_completions"
  FOR EACH ROW EXECUTE FUNCTION booking_completions_resolved_immutable();

DROP TRIGGER IF EXISTS "booking_completion_audit_no_update" ON "booking_completion_audit";
CREATE TRIGGER "booking_completion_audit_no_update"
  BEFORE UPDATE OR DELETE ON "booking_completion_audit"
  FOR EACH ROW EXECUTE FUNCTION booking_completion_audit_append_only();
