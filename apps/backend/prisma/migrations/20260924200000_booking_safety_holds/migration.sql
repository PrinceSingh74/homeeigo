-- Phase 10 §9 — safety holds: a prohibited condition found on site stops the job until safety
-- operations release it.
--
-- Before: catalog_config.safety (prohibitedConditions, warnings, PPE-style provider requirements,
-- medicalDisclaimer, emergencyProtocol) was display-only — no runtime reader at all — and an OPEN
-- partner safety incident on a booking did not stop START or COMPLETE. On 2026-09-24 no live service
-- had safety content and three SOS incidents had been OPEN since August.
--
-- booking_safety_holds  one row per condition raised on a booking. ACTIVE holds (together with
--                       open partner_safety_incidents on the booking — the existing escalation
--                       queue, not duplicated) block START, execution-step START/COMPLETE and
--                       COMPLETE. Only an administrator releases a hold, with a reason.
-- booking_safety_audit  append-only, written by trigger (actor/reason/request/trace from the
--                       transaction-local settings booking_status_history uses).
--
-- Additive: two tables, three indexes, three functions, three triggers. Nothing existing is altered.

CREATE TABLE IF NOT EXISTS "booking_safety_holds" (
    "id"               BIGSERIAL PRIMARY KEY,
    "booking_id"       TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "source"           TEXT NOT NULL,
    "condition"        TEXT NOT NULL,
    "note"             TEXT,
    "state"            TEXT NOT NULL DEFAULT 'ACTIVE',
    "raised_by_role"   TEXT NOT NULL,
    "raised_by_id"     TEXT NOT NULL,
    "incident_id"      TEXT,
    "released_by_id"   TEXT,
    "release_reason"   TEXT,
    "raised_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "released_at"      TIMESTAMPTZ,
    "version"          INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "booking_safety_holds_source_check" CHECK ("source" IN ('PROHIBITED_CONDITION', 'ADMIN')),
    CONSTRAINT "booking_safety_holds_state_check" CHECK ("state" IN ('ACTIVE', 'RELEASED')),
    CONSTRAINT "booking_safety_holds_role_check" CHECK ("raised_by_role" IN ('PARTNER', 'ADMIN')),
    -- A released hold always says who released it, when and why; an active one never does.
    CONSTRAINT "booking_safety_holds_release_check" CHECK (
      ("state" = 'ACTIVE' AND "released_by_id" IS NULL AND "released_at" IS NULL)
      OR ("state" = 'RELEASED' AND "released_by_id" IS NOT NULL AND "released_at" IS NOT NULL AND "release_reason" IS NOT NULL AND length("release_reason") >= 3)
    )
);
-- One ACTIVE hold per (booking, condition): raising the same condition twice is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_safety_holds_active_key" ON "booking_safety_holds" ("booking_id", "condition") WHERE "state" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "booking_safety_holds_booking_state_idx" ON "booking_safety_holds" ("booking_id", "state");

CREATE TABLE IF NOT EXISTS "booking_safety_audit" (
    "id"          BIGSERIAL PRIMARY KEY,
    "hold_id"     BIGINT NOT NULL,
    "booking_id"  TEXT NOT NULL,
    "condition"   TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "from_state"  TEXT,
    "to_state"    TEXT NOT NULL,
    "actor_type"  TEXT,
    "actor_id"    TEXT,
    "reason"      TEXT,
    "request_id"  TEXT,
    "trace_id"    TEXT,
    "incident_id" TEXT,
    "changed_at"  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS "booking_safety_audit_booking_idx" ON "booking_safety_audit" ("booking_id", "changed_at");

CREATE OR REPLACE FUNCTION booking_safety_holds_record_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO booking_safety_audit (hold_id, booking_id, condition, action, from_state, to_state, actor_type, actor_id, reason, request_id, trace_id, incident_id)
    VALUES (
      NEW.id, NEW.booking_id, NEW.condition,
      CASE WHEN TG_OP = 'INSERT' THEN 'RAISED' ELSE 'RELEASED' END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
      NEW.state,
      NULLIF(current_setting('homigo.actor_type', true), ''),
      NULLIF(current_setting('homigo.actor_id', true), ''),
      NULLIF(left(current_setting('homigo.reason', true), 500), ''),
      NULLIF(current_setting('homigo.request_id', true), ''),
      NULLIF(current_setting('homigo.trace_id', true), ''),
      NEW.incident_id
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A released hold is history: it cannot be reactivated or edited (raise a new one instead).
CREATE OR REPLACE FUNCTION booking_safety_holds_released_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'RELEASED' THEN
    RAISE EXCEPTION 'booking_safety_holds: a released hold is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_safety_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_safety_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_safety_holds_audit_trg" ON "booking_safety_holds";
CREATE TRIGGER "booking_safety_holds_audit_trg"
  AFTER INSERT OR UPDATE ON "booking_safety_holds"
  FOR EACH ROW EXECUTE FUNCTION booking_safety_holds_record_audit();

DROP TRIGGER IF EXISTS "booking_safety_holds_immutable_trg" ON "booking_safety_holds";
CREATE TRIGGER "booking_safety_holds_immutable_trg"
  BEFORE UPDATE ON "booking_safety_holds"
  FOR EACH ROW EXECUTE FUNCTION booking_safety_holds_released_immutable();

DROP TRIGGER IF EXISTS "booking_safety_audit_no_update" ON "booking_safety_audit";
CREATE TRIGGER "booking_safety_audit_no_update"
  BEFORE UPDATE ON "booking_safety_audit"
  FOR EACH ROW EXECUTE FUNCTION booking_safety_audit_append_only();
