-- Phase 10 §5 — the execution state machine, enforced where no writer can skip it.
--
-- The transition table lives in src/lib/booking-state-machine.ts and every application writer
-- consults it. That leaves raw SQL, a future writer that forgets, and a read-then-write race free to
-- rewrite a settled booking: before this change a no-show report racing a completion could turn a
-- COMPLETED job into CUSTOMER_NO_SHOW with a second settlement on top.
--
-- This migration does NOT duplicate the transition table. It enforces the one rule that has no
-- exceptions anywhere in the codebase: a terminal status never changes. The list below must equal
-- TERMINAL_BOOKING_STATUSES; a structural test pins the two together.
--
-- It also records the request's trace id beside its request id in booking_status_history, so a
-- transition can be followed into the logs and events of the request that made it.
--
-- Additive and hand-scoped: one nullable column, one replaced function body (same signature, same
-- trigger), one new function and one new BEFORE UPDATE trigger. No row is read or written.

ALTER TABLE "booking_status_history" ADD COLUMN IF NOT EXISTS "trace_id" TEXT;

CREATE OR REPLACE FUNCTION bookings_record_status_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN
    INSERT INTO booking_status_history (
      booking_id, old_status, new_status, old_provider_id, new_provider_id,
      old_payment_status, new_payment_status, old_scheduled_date, new_scheduled_date,
      actor_type, actor_id, reason, request_id, trace_id
    ) VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status::text END,
      NEW.status::text,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.provider_id END,
      NEW.provider_id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.payment_status::text END,
      NEW.payment_status::text,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.scheduled_date END,
      NEW.scheduled_date,
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

CREATE OR REPLACE FUNCTION bookings_terminal_status_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status::text IN (
       'COMPLETED', 'REJECTED', 'EXPIRED', 'CUSTOMER_NO_SHOW', 'PROVIDER_NO_SHOW',
       'CANCELLED_BY_USER', 'CANCELLED_BY_PROVIDER'
     )
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'BOOKING_TERMINAL_STATUS: booking % is % and cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "bookings_terminal_status_guard_trg" ON "bookings";
CREATE TRIGGER "bookings_terminal_status_guard_trg"
  BEFORE UPDATE OF status ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION bookings_terminal_status_guard();
