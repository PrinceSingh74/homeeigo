-- Owner decision D1 (2026-09-21), option B: a booking reserves the partner (and the customer) for
--   [scheduled_date − 30 min, scheduled_date + slot_duration_minutes + 30 min)
-- instead of the fixed [−30, +30) window. Services whose stored duration is a TURNAROUND time,
-- not partner on-site time (laundry: 24–72 h), keep the fixed 60-minute block — also an owner
-- decision, recorded as data (services.partner_slot_policy = 'FIXED'), not as code.
--
-- EXISTING BOOKINGS ARE NOT RE-SLOTTED (owner decision): the reserved minutes are frozen on the
-- booking in slot_duration_minutes when it is created. Every existing row has NULL, which the
-- trigger treats as 0 → exactly today's [−30, +30) window, now and on any later update.
--
-- Protected objects: the trigger bookings_conflict_slots_trg and both GiST EXCLUDE constraints
-- are NOT dropped or recreated. Only the trigger FUNCTION body is replaced (CREATE OR REPLACE),
-- so the exclusion constraints remain the authority over the (now wider) ranges.

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "partner_slot_policy" TEXT NOT NULL DEFAULT 'DURATION';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_partner_slot_policy_check') THEN
    ALTER TABLE "services" ADD CONSTRAINT "services_partner_slot_policy_check"
      CHECK ("partner_slot_policy" IN ('DURATION', 'FIXED'));
  END IF;
END $$;

-- Laundry & fabric services (taxonomy category, or the operational 'laundry' subcategory, which
-- also covers Complete Wardrobe Cleaning listed under Home Cleaning).
UPDATE "services" s
SET "partner_slot_policy" = 'FIXED'
WHERE s."partner_slot_policy" = 'DURATION'
  AND (s."subcategory" = 'laundry'
       OR s."category_id" IN (SELECT c."id" FROM "service_categories" c WHERE c."slug" = 'laundry-fabric'));

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "slot_duration_minutes" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_slot_duration_minutes_range') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_duration_minutes_range"
      CHECK ("slot_duration_minutes" IS NULL OR "slot_duration_minutes" BETWEEN 0 AND 10080);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bookings_sync_conflict_slots() RETURNS trigger AS $$
DECLARE
  occupancy interval := make_interval(mins => COALESCE(NEW.slot_duration_minutes, 0));
BEGIN
  IF NEW.status IN ('PENDING', 'ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS') THEN
    NEW.user_slot_start := NEW.scheduled_date - interval '30 minutes';
    NEW.user_slot_end := NEW.scheduled_date + occupancy + interval '30 minutes';
    IF NEW.provider_id IS NOT NULL THEN
      NEW.provider_slot_start := NEW.scheduled_date - interval '30 minutes';
      NEW.provider_slot_end := NEW.scheduled_date + occupancy + interval '30 minutes';
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
