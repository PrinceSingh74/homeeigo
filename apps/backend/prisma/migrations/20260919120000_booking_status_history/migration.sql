-- Authoritative, append-only booking history: every change of status, assigned partner, payment
-- status or scheduled time, whoever made it.
--
-- There was no status history: only timestamp columns, outbox events (PUBLISHED rows are purged by
-- retention) and an audit consumer that only runs when consumers are enabled and never saw
-- en-route, arrival, admin reassignment or reschedule. Support and finance could not answer "what
-- happened to this booking, in what order, by whom".
--
-- Written by a trigger, not by application code, so no writer can skip it (raw SQL included).
-- Actor / reason / request id come from transaction-local settings that the app sets with
-- set_config(..., true) (src/lib/booking-audit-context.ts); a write without them is still recorded,
-- with those fields NULL.
--
-- No foreign key on booking_id: history must outlive the booking row. UPDATE is refused
-- (append-only); DELETE stays possible for governed retention.
--
-- Hand-scoped and additive. Does not touch bookings_conflict_slots_trg (BEFORE) or any other
-- existing object; this trigger runs AFTER.
CREATE TABLE IF NOT EXISTS "booking_status_history" (
    "id" BIGSERIAL PRIMARY KEY,
    "booking_id" TEXT NOT NULL,
    "old_status" TEXT,
    "new_status" TEXT NOT NULL,
    "old_provider_id" TEXT,
    "new_provider_id" TEXT,
    "old_payment_status" TEXT,
    "new_payment_status" TEXT,
    "old_scheduled_date" TIMESTAMP(3),
    "new_scheduled_date" TIMESTAMP(3),
    "actor_type" TEXT,
    "actor_id" TEXT,
    "reason" TEXT,
    "request_id" TEXT,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Re-runnable: a database that applied the first draft of this file gains the schedule columns.
ALTER TABLE "booking_status_history" ADD COLUMN IF NOT EXISTS "old_scheduled_date" TIMESTAMP(3);
ALTER TABLE "booking_status_history" ADD COLUMN IF NOT EXISTS "new_scheduled_date" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "booking_status_history_booking_idx" ON "booking_status_history" ("booking_id", "changed_at");
CREATE INDEX IF NOT EXISTS "booking_status_history_changed_at_idx" ON "booking_status_history" ("changed_at");

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
      actor_type, actor_id, reason, request_id
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
      NULLIF(current_setting('homigo.request_id', true), '')
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "bookings_status_history_trg" ON "bookings";
CREATE TRIGGER "bookings_status_history_trg"
  AFTER INSERT OR UPDATE OF status, provider_id, payment_status, scheduled_date ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION bookings_record_status_history();

CREATE OR REPLACE FUNCTION booking_status_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_status_history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "booking_status_history_no_update" ON "booking_status_history";
CREATE TRIGGER "booking_status_history_no_update"
  BEFORE UPDATE ON "booking_status_history"
  FOR EACH ROW EXECUTE FUNCTION booking_status_history_append_only();
