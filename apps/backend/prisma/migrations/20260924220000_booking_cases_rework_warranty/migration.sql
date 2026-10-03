-- Phase 10 §11 — warranty frozen per booking, complaint cases, and rework / revisit bookings.
--
-- Before: warranty existed only as `quality.warrantyDays` in the catalogue and as a JSON patch the
-- completion path wrote INTO the booking's "immutable" snapshot; complaints were generic support
-- tickets with four states and no eligibility, evidence or financial linkage; a booking had no
-- parent, so a rework or revisit could not be told from a fresh booking, and nothing stopped a case
-- from being compensated twice.
--
-- booking_warranties     one row per booking, written at completion from the booking's own frozen
--                        snapshot (never re-read from the catalogue later). The snapshot itself is no
--                        longer mutated.
-- booking_cases          the complaint / warranty-claim / rework case. `open_key` is unique while the
--                        case is open and NULL once closed, so one booking has at most one open case
--                        (the partner_safety_incidents pattern). Terminal cases are immutable.
-- booking_case_events    append-only lifecycle, written by the service in the same transaction.
-- booking_case_evidence  append-only references to job evidence / customer media / notes.
-- bookings               + parent_booking_id, booking_kind (STANDARD | REWORK | REVISIT), case_id
--                        (unique when set: a case can spawn at most ONE follow-up booking, which is
--                        what makes repeated rework creation idempotent at the database).
-- refund_requests        + case_id so a refund can be traced to the case that caused it, and the
--                        service can refuse a second refund for the same case.
--
-- Additive only: new tables, nullable columns with defaults, partial unique indexes, triggers.

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "parent_booking_id" TEXT REFERENCES "bookings"("id");
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "booking_kind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "case_id" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_kind_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_kind_check" CHECK ("booking_kind" IN ('STANDARD', 'REWORK', 'REVISIT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_follow_up_check') THEN
    -- A follow-up always knows its parent; a standard booking never has one.
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_follow_up_check" CHECK (("booking_kind" = 'STANDARD') = ("parent_booking_id" IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_case_id_key" ON "bookings" ("case_id") WHERE "case_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "bookings_parent_booking_idx" ON "bookings" ("parent_booking_id") WHERE "parent_booking_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "booking_warranties" (
    "booking_id"              TEXT PRIMARY KEY REFERENCES "bookings"("id") ON DELETE CASCADE,
    "state"                   TEXT NOT NULL DEFAULT 'ACTIVE',
    -- The frozen policy (duration, start event, eligible issue types, exclusions, proof, rework /
    -- refund behaviour) exactly as the booking's snapshot carried it.
    "policy"                  JSONB NOT NULL,
    "policy_version"          TEXT NOT NULL DEFAULT 'warranty.v1',
    "service_config_version"  INTEGER,
    "starts_at"               TIMESTAMPTZ NOT NULL,
    "expires_at"              TIMESTAMPTZ NOT NULL,
    "void_reason"             TEXT,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "booking_warranties_state_check" CHECK ("state" IN ('ACTIVE', 'EXPIRED', 'VOID')),
    CONSTRAINT "booking_warranties_window_check" CHECK ("expires_at" > "starts_at"),
    CONSTRAINT "booking_warranties_void_check" CHECK (("state" = 'VOID') = ("void_reason" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "booking_cases" (
    "id"                      TEXT PRIMARY KEY,
    "case_number"             TEXT NOT NULL UNIQUE,
    "booking_id"              TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "customer_id"             TEXT NOT NULL,
    "provider_id"             TEXT,
    "type"                    TEXT NOT NULL,
    "category"                TEXT NOT NULL,
    "state"                   TEXT NOT NULL DEFAULT 'CASE_CREATED',
    "description"             TEXT,
    -- Decided facts: complaint window, warranty state at the time, proof present, decided_at.
    "eligibility"             JSONB,
    -- The action taken: {action: REWORK|REFUND|REJECT|INSPECTION|NONE, refundPaise, refundRequestId,
    -- followUpBookingId, note}. Money moves only through the refund orchestrator with a case-scoped key.
    "resolution"              JSONB,
    "warranty_snapshot"       JSONB,
    "service_config_version"  INTEGER,
    "sla_due_at"              TIMESTAMPTZ,
    "owner_admin_id"          TEXT,
    "open_key"                TEXT,
    "data_origin"             "DataOrigin",
    "version"                 INTEGER NOT NULL DEFAULT 1,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "closed_at"               TIMESTAMPTZ,
    CONSTRAINT "booking_cases_type_check" CHECK ("type" IN ('COMPLAINT', 'WARRANTY_CLAIM', 'REWORK')),
    CONSTRAINT "booking_cases_category_check" CHECK ("category" IN ('QUALITY', 'INCOMPLETE', 'DAMAGE', 'BEHAVIOUR', 'NO_SHOW', 'BILLING', 'OTHER')),
    CONSTRAINT "booking_cases_state_check" CHECK ("state" IN ('CASE_CREATED', 'TRIAGE', 'ELIGIBILITY', 'INVESTIGATION', 'ACTION', 'RESOLVED', 'REJECTED', 'ESCALATED')),
    -- Open cases hold the key; closed cases release it and carry closed_at.
    CONSTRAINT "booking_cases_open_key_check" CHECK (
      ("state" IN ('RESOLVED', 'REJECTED') AND "open_key" IS NULL AND "closed_at" IS NOT NULL)
      OR ("state" NOT IN ('RESOLVED', 'REJECTED') AND "open_key" IS NOT NULL AND "closed_at" IS NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_cases_open_key_key" ON "booking_cases" ("open_key") WHERE "open_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "booking_cases_booking_idx" ON "booking_cases" ("booking_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_cases_customer_idx" ON "booking_cases" ("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "booking_cases_state_sla_idx" ON "booking_cases" ("state", "sla_due_at");

CREATE TABLE IF NOT EXISTS "booking_case_events" (
    "id"          BIGSERIAL PRIMARY KEY,
    "case_id"     TEXT NOT NULL REFERENCES "booking_cases"("id") ON DELETE CASCADE,
    "action"      TEXT NOT NULL,
    "from_state"  TEXT,
    "to_state"    TEXT NOT NULL,
    "actor_type"  TEXT NOT NULL,
    "actor_id"    TEXT,
    "reason"      TEXT,
    "details"     JSONB,
    "request_id"  TEXT,
    "trace_id"    TEXT,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "booking_case_events_actor_check" CHECK ("actor_type" IN ('CUSTOMER', 'PARTNER', 'ADMIN', 'SYSTEM'))
);
CREATE INDEX IF NOT EXISTS "booking_case_events_case_idx" ON "booking_case_events" ("case_id", "id");

CREATE TABLE IF NOT EXISTS "booking_case_evidence" (
    "id"                 BIGSERIAL PRIMARY KEY,
    "case_id"            TEXT NOT NULL REFERENCES "booking_cases"("id") ON DELETE CASCADE,
    "kind"               TEXT NOT NULL,
    "job_evidence_id"    TEXT,
    "media_storage_key"  TEXT,
    "media_url"          TEXT,
    "note"               TEXT,
    "actor_type"         TEXT NOT NULL,
    "actor_id"           TEXT,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "booking_case_evidence_kind_check" CHECK ("kind" IN ('JOB_EVIDENCE', 'CUSTOMER_MEDIA', 'NOTE')),
    CONSTRAINT "booking_case_evidence_actor_check" CHECK ("actor_type" IN ('CUSTOMER', 'PARTNER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "booking_case_evidence_ref_check" CHECK (
      ("kind" = 'JOB_EVIDENCE' AND "job_evidence_id" IS NOT NULL)
      OR ("kind" = 'CUSTOMER_MEDIA' AND ("media_storage_key" IS NOT NULL OR "media_url" IS NOT NULL))
      OR ("kind" = 'NOTE' AND "note" IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS "booking_case_evidence_case_idx" ON "booking_case_evidence" ("case_id", "id");

ALTER TABLE "refund_requests" ADD COLUMN IF NOT EXISTS "case_id" TEXT;
CREATE INDEX IF NOT EXISTS "refund_requests_case_idx" ON "refund_requests" ("case_id") WHERE "case_id" IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_completions_case_id_fkey') THEN
    ALTER TABLE "booking_completions" ADD CONSTRAINT "booking_completions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "booking_cases"("id");
  END IF;
END $$;

-- Terminal cases are immutable; every other update bumps the version and the timestamp.
CREATE OR REPLACE FUNCTION booking_cases_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('RESOLVED', 'REJECTED') THEN
    RAISE EXCEPTION 'booking_cases: case % is % and immutable', OLD.id, OLD.state;
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_case_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_cases_guard_trg" ON "booking_cases";
CREATE TRIGGER "booking_cases_guard_trg"
  BEFORE UPDATE ON "booking_cases"
  FOR EACH ROW EXECUTE FUNCTION booking_cases_guard();

DROP TRIGGER IF EXISTS "booking_case_events_no_update" ON "booking_case_events";
CREATE TRIGGER "booking_case_events_no_update"
  BEFORE UPDATE OR DELETE ON "booking_case_events"
  FOR EACH ROW EXECUTE FUNCTION booking_case_history_append_only();

DROP TRIGGER IF EXISTS "booking_case_evidence_no_update" ON "booking_case_evidence";
CREATE TRIGGER "booking_case_evidence_no_update"
  BEFORE UPDATE OR DELETE ON "booking_case_evidence"
  FOR EACH ROW EXECUTE FUNCTION booking_case_history_append_only();
