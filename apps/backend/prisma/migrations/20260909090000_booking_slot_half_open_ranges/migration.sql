-- Back-to-back bookings were impossible.
--
-- The provider/user slot ranges are built by bookings_sync_conflict_slots() as
-- [scheduled_date - 30 minutes, scheduled_date + 30 minutes] and were compared as CLOSED ranges
-- ('[]'). Two bookings exactly 60 minutes apart therefore produce ["16:30","17:30"] and
-- ["17:30","18:30"], which share the single instant 17:30 and so "overlap" under &&.
--
-- Three other definitions of the same rule disagreed with that:
--   * booking-validation.service.ts rejects only a scheduled_date within +/-30 minutes, so it
--     ALLOWS a booking 60 minutes away;
--   * scripts/verify-booking-overlaps.ts defines an overlap with strict inequalities on both
--     sides -- half-open semantics, where a touch is not an overlap;
--   * BOOKING_BUFFER_MINUTES = 30 means 60 minutes apart is the tightest LEGAL back-to-back pair.
--
-- The constraint was the outlier. It surfaced to customers as "Provider is not available at this
-- time. Try 30 minutes earlier or later." -- advice that moves them to a slot the platform also
-- rejects.
--
-- '[)' makes the upper bound exclusive: a zero-width touch is no longer an overlap, while every
-- overlap of positive duration is still rejected exactly as before.
--
-- NOTE FOR THE DEPLOYER: recreating an EXCLUDE constraint rebuilds its GiST index and takes an
-- ACCESS EXCLUSIVE lock on "bookings" for the duration. Schedule accordingly.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_provider_slot_excl";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_user_slot_excl";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_provider_slot_excl"
  EXCLUDE USING gist (
    "provider_id" WITH =,
    tstzrange("provider_slot_start", "provider_slot_end", '[)') WITH &&
  )
  WHERE (
    "provider_id" IS NOT NULL
    AND "provider_slot_start" IS NOT NULL
    AND "provider_slot_end" IS NOT NULL
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_user_slot_excl"
  EXCLUDE USING gist (
    "user_id" WITH =,
    tstzrange("user_slot_start", "user_slot_end", '[)') WITH &&
  )
  WHERE (
    "user_slot_start" IS NOT NULL
    AND "user_slot_end" IS NOT NULL
  );
