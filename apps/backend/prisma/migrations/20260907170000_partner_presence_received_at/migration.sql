-- Presence location: keep device capture time and server receive time separately.
-- `last_location_at` stays the capture time (freshness is measured against it);
-- `last_location_received_at` records when the server accepted that fix, so
-- transport lag is auditable instead of being folded into one column.
ALTER TABLE "partner_presence"
  ADD COLUMN IF NOT EXISTS "last_location_received_at" TIMESTAMP(3);

-- Backfill: for rows that already carry a fix, the closest known receive time is
-- the row's last write. Never invents a value for rows without a location.
UPDATE "partner_presence"
SET "last_location_received_at" = "updated_at"
WHERE "last_location_at" IS NOT NULL
  AND "last_location_received_at" IS NULL;

CREATE INDEX IF NOT EXISTS "partner_presence_last_location_at_idx"
  ON "partner_presence" ("last_location_at");

CREATE INDEX IF NOT EXISTS "partner_presence_provider_id_updated_at_idx"
  ON "partner_presence" ("provider_id", "updated_at");
