-- Booking buffer-window exclusion (30 min) enforced at database layer.
-- Trigger-maintained slot bounds (generated columns are not immutable on timestamptz).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "provider_slot_start" TIMESTAMPTZ;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "provider_slot_end" TIMESTAMPTZ;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "user_slot_start" TIMESTAMPTZ;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "user_slot_end" TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION bookings_sync_conflict_slots()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS') THEN
    NEW.user_slot_start := NEW.scheduled_date - interval '30 minutes';
    NEW.user_slot_end := NEW.scheduled_date + interval '30 minutes';
    IF NEW.provider_id IS NOT NULL THEN
      NEW.provider_slot_start := NEW.scheduled_date - interval '30 minutes';
      NEW.provider_slot_end := NEW.scheduled_date + interval '30 minutes';
    ELSE
      NEW.provider_slot_start := NULL;
      NEW.provider_slot_end := NULL;
    END IF;
  ELSE
    NEW.user_slot_start := NULL;
    NEW.user_slot_end := NULL;
    NEW.provider_slot_start := NULL;
    NEW.provider_slot_end := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_conflict_slots_trg ON "bookings";
CREATE TRIGGER bookings_conflict_slots_trg
  BEFORE INSERT OR UPDATE OF scheduled_date, status, provider_id
  ON "bookings"
  FOR EACH ROW
  EXECUTE FUNCTION bookings_sync_conflict_slots();

-- Backfill existing active rows
UPDATE "bookings"
SET scheduled_date = scheduled_date
WHERE status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_provider_slot_excl'
  ) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_slot_excl"
      EXCLUDE USING gist (
        "provider_id" WITH =,
        tstzrange("provider_slot_start", "provider_slot_end", '[]') WITH &&
      )
      WHERE (
        "provider_id" IS NOT NULL
        AND "provider_slot_start" IS NOT NULL
        AND "provider_slot_end" IS NOT NULL
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_user_slot_excl'
  ) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_slot_excl"
      EXCLUDE USING gist (
        "user_id" WITH =,
        tstzrange("user_slot_start", "user_slot_end", '[]') WITH &&
      )
      WHERE (
        "user_slot_start" IS NOT NULL
        AND "user_slot_end" IS NOT NULL
      );
  END IF;
END $$;
