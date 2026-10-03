-- Phase 10 §6 — requirement gates: booking-scoped requirement STATE, typed and queryable.
--
-- Phase 06 put the demand side in place (service_requirements, the resolver, the immutable
-- requirements.v1 snapshot on every booking). Nothing recorded whether a gated requirement was
-- ever satisfied: REQUIRED_BEFORE_ARRIVAL / REQUIRED_AT_START / PARTNER_CHECK were labels on the
-- partner's preparation brief and nothing else. On 2026-09-24 the live catalogue carried 40
-- REQUIRED_BEFORE_ARRIVAL and 7 REQUIRED_AT_START assignments across 25 services, every one
-- PARTNER_CHECK, and every one unenforced.
--
-- booking_requirement_states holds one row per GATED requirement of a booking (INFORMATIONAL and
-- WARNING items have no state — they are copy). Rows are materialised from the booking's own
-- snapshot, never from the service's current configuration, so a later catalogue edit cannot
-- change what a booking requires (§6.28). The state machine is deliberately small:
--
--   UNRESOLVED  nothing recorded yet, or sent back for re-check
--   SATISFIED   evidence on record (who, how, when, where)
--   FAILED      checked and found missing — blocks execution until re-checked
--
-- "EXPIRED" is derived, not stored: a PARTNER_CHECK is evidence about ONE appointment, so
-- valid_for_scheduled_at records the appointment it was made for and a reschedule invalidates it
-- without touching the row (history stays honest).
--
-- booking_requirement_audit is append-only and written by a trigger, so no code path can transition
-- a requirement without a record. Actor / reason / request / trace ids come from the same
-- transaction-local settings booking_status_history uses (src/lib/booking-audit-context.ts).
--
-- Additive: two tables, three indexes, two functions, three triggers, one partial unique index on
-- notifications (dedup arbiter, same pattern as 20260916100000). No existing object is altered.

CREATE TABLE IF NOT EXISTS "booking_requirement_states" (
    "id"                      BIGSERIAL PRIMARY KEY,
    "booking_id"              TEXT NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "code"                    TEXT NOT NULL,
    "item_code"               TEXT NOT NULL,
    "kind"                    TEXT NOT NULL,
    "enforcement"             TEXT NOT NULL,
    "verification"            TEXT NOT NULL,
    "responsibility"          TEXT NOT NULL,
    "optional"                BOOLEAN NOT NULL DEFAULT false,
    "service_version"         INTEGER NOT NULL,
    "state"                   TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "resolved_by_role"        TEXT,
    "resolved_by_id"          TEXT,
    "evidence_kind"           TEXT,
    "evidence_ref"            TEXT,
    "evidence_lat"            DOUBLE PRECISION,
    "evidence_lng"            DOUBLE PRECISION,
    "note"                    TEXT,
    "valid_for_scheduled_at"  TIMESTAMP(3),
    "resolved_at"             TIMESTAMPTZ,
    "version"                 INTEGER NOT NULL DEFAULT 1,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "booking_requirement_states_enforcement_check"
      CHECK ("enforcement" IN ('REQUIRED_BEFORE_BOOKING', 'REQUIRED_BEFORE_ARRIVAL', 'REQUIRED_AT_START')),
    CONSTRAINT "booking_requirement_states_verification_check"
      CHECK ("verification" IN ('NONE', 'CUSTOMER_ATTESTATION', 'PARTNER_CHECK')),
    CONSTRAINT "booking_requirement_states_responsibility_check"
      CHECK ("responsibility" IN ('CUSTOMER', 'PROFESSIONAL', 'PLATFORM', 'SHARED', 'UNKNOWN')),
    CONSTRAINT "booking_requirement_states_state_check"
      CHECK ("state" IN ('UNRESOLVED', 'SATISFIED', 'FAILED')),
    CONSTRAINT "booking_requirement_states_role_check"
      CHECK ("resolved_by_role" IS NULL OR "resolved_by_role" IN ('CUSTOMER', 'PARTNER', 'ADMIN', 'SYSTEM')),
    CONSTRAINT "booking_requirement_states_evidence_kind_check"
      CHECK ("evidence_kind" IS NULL OR "evidence_kind" IN ('CUSTOMER_ATTESTATION', 'PARTNER_CHECK')),
    -- A resolved row always says who, how and when; an unresolved row never carries stale evidence.
    CONSTRAINT "booking_requirement_states_resolution_shape_check" CHECK (
      ("state" = 'UNRESOLVED' AND "resolved_by_role" IS NULL AND "evidence_kind" IS NULL AND "resolved_at" IS NULL)
      OR ("state" IN ('SATISFIED', 'FAILED') AND "resolved_by_role" IS NOT NULL AND "evidence_kind" IS NOT NULL AND "resolved_at" IS NOT NULL)
    ),
    CONSTRAINT "booking_requirement_states_booking_code_key" UNIQUE ("booking_id", "code")
);
CREATE INDEX IF NOT EXISTS "booking_requirement_states_booking_state_idx" ON "booking_requirement_states" ("booking_id", "state");

CREATE TABLE IF NOT EXISTS "booking_requirement_audit" (
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
    "evidence_kind"    TEXT,
    "evidence_ref"     TEXT,
    "idempotency_key"  TEXT,
    "changed_at"       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS "booking_requirement_audit_booking_idx" ON "booking_requirement_audit" ("booking_id", "changed_at");
CREATE INDEX IF NOT EXISTS "booking_requirement_audit_changed_at_idx" ON "booking_requirement_audit" ("changed_at");

CREATE OR REPLACE FUNCTION booking_requirement_states_record_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO booking_requirement_audit (
      booking_id, code, service_version, action, from_state, to_state,
      actor_type, actor_id, reason, request_id, trace_id, evidence_kind, evidence_ref, idempotency_key
    ) VALUES (
      NEW.booking_id,
      NEW.code,
      NEW.service_version,
      CASE WHEN TG_OP = 'INSERT' THEN 'MATERIALIZED'
           ELSE COALESCE(NULLIF(current_setting('homigo.requirement_action', true), ''), 'TRANSITION') END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
      NEW.state,
      NULLIF(current_setting('homigo.actor_type', true), ''),
      NULLIF(current_setting('homigo.actor_id', true), ''),
      NULLIF(left(current_setting('homigo.reason', true), 500), ''),
      NULLIF(current_setting('homigo.request_id', true), ''),
      NULLIF(current_setting('homigo.trace_id', true), ''),
      NEW.evidence_kind,
      NEW.evidence_ref,
      NULLIF(current_setting('homigo.idempotency_key', true), '')
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION booking_requirement_states_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER, not BEFORE: a BEFORE INSERT trigger also fires for a row that ON CONFLICT DO NOTHING then
-- skips, which would record a phantom MATERIALIZED audit row on every idempotent re-materialise.
DROP TRIGGER IF EXISTS "booking_requirement_states_audit_trg" ON "booking_requirement_states";
CREATE TRIGGER "booking_requirement_states_audit_trg"
  AFTER INSERT OR UPDATE ON "booking_requirement_states"
  FOR EACH ROW EXECUTE FUNCTION booking_requirement_states_record_audit();

DROP TRIGGER IF EXISTS "booking_requirement_states_touch_trg" ON "booking_requirement_states";
CREATE TRIGGER "booking_requirement_states_touch_trg"
  BEFORE UPDATE ON "booking_requirement_states"
  FOR EACH ROW EXECUTE FUNCTION booking_requirement_states_touch();

CREATE OR REPLACE FUNCTION booking_requirement_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_requirement_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_requirement_audit_no_update" ON "booking_requirement_audit";
CREATE TRIGGER "booking_requirement_audit_no_update"
  BEFORE UPDATE ON "booking_requirement_audit"
  FOR EACH ROW EXECUTE FUNCTION booking_requirement_audit_append_only();

-- Notification dedup arbiter: one "precondition missing" / "please re-check" per (user, requirement).
-- reference_id is "<bookingId>:<code>", reference_type 'booking_requirement'.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_booking_requirement_dedup_key"
  ON "notifications" ("user_id", "type", "reference_id")
  WHERE "type" IN ('booking_requirement_missing', 'booking_requirement_recheck', 'booking_requirement_blocked');
